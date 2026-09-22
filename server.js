require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const knexFactory = require('knex');

const isPostgres = process.env.DB_CLIENT === 'postgres';
const sqliteFile = process.env.SQLITE_FILE || path.join(__dirname, 'data', 'stockwise.db');
if (!isPostgres) fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
const db = knexFactory(isPostgres ? {
  client: 'pg', connection: { connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false }
} : { client: 'sqlite3', connection: { filename: sqliteFile }, useNullAsDefault: true });

async function initDatabase() {
  if (!await db.schema.hasTable('suppliers')) await db.schema.createTable('suppliers', t => { t.increments('id').primary(); t.string('name').notNullable().unique(); t.string('email'); t.string('phone'); t.timestamps(true, true); });
  if (!await db.schema.hasTable('products')) await db.schema.createTable('products', t => { t.increments('id').primary(); t.string('name').notNullable(); t.string('sku').notNullable().unique(); t.string('barcode').unique(); t.string('category'); t.decimal('unit_cost', 12, 2).notNullable().defaultTo(0); t.integer('quantity').notNullable().defaultTo(0); t.integer('reorder_point').notNullable().defaultTo(0); t.integer('supplier_id').references('id').inTable('suppliers'); t.timestamps(true, true); });
  if (!await db.schema.hasTable('stock_movements')) await db.schema.createTable('stock_movements', t => { t.increments('id').primary(); t.integer('product_id').notNullable().references('id').inTable('products'); t.string('type').notNullable(); t.integer('quantity').notNullable(); t.string('reason'); t.timestamps(true, true); });
  if (!await db.schema.hasTable('sales')) await db.schema.createTable('sales', t => { t.increments('id').primary(); t.string('reference').notNullable().unique(); t.string('customer').defaultTo('Walk-in customer'); t.decimal('subtotal', 12, 2).notNullable(); t.decimal('discount', 12, 2).notNullable().defaultTo(0); t.decimal('gst', 12, 2).notNullable().defaultTo(0); t.decimal('total', 12, 2).notNullable(); t.timestamps(true, true); });
  if (!await db.schema.hasTable('sale_items')) await db.schema.createTable('sale_items', t => { t.increments('id').primary(); t.integer('sale_id').notNullable().references('id').inTable('sales'); t.integer('product_id').notNullable().references('id').inTable('products'); t.integer('quantity').notNullable(); t.decimal('unit_price', 12, 2).notNullable(); });
}

function status(product) { return product.quantity === 0 ? 'Out of stock' : product.quantity <= product.reorder_point ? 'Low stock' : 'In stock'; }
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true, database: isPostgres ? 'postgres' : 'sqlite' }));
app.get('/api/products', async (_, res, next) => { try { const rows = await db('products').leftJoin('suppliers', 'products.supplier_id', 'suppliers.id').select('products.*', 'suppliers.name as supplier').orderBy('products.name'); res.json(rows.map(p => ({ ...p, status: status(p) }))); } catch (e) { next(e); } });
app.post('/api/products', async (req, res, next) => { try { const { name, sku, barcode, category, unit_cost = 0, quantity = 0, reorder_point = 0, supplier_id = null } = req.body; if (!name || !sku) return res.status(400).json({ error: 'name and sku are required' }); const [id] = await db('products').insert({ name, sku, barcode: barcode || null, category, unit_cost, quantity, reorder_point, supplier_id }); const p = await db('products').where({ id }).first(); res.status(201).json({ ...p, status: status(p) }); } catch (e) { if (String(e.message).match(/unique|duplicate/i)) return res.status(409).json({ error: 'SKU or barcode already exists' }); next(e); } });
app.patch('/api/products/:id', async (req, res, next) => { try { const { name, sku, barcode, category, unit_cost, reorder_point, supplier_id } = req.body; await db('products').where({ id: req.params.id }).update({ name, sku, barcode: barcode || null, category, unit_cost, reorder_point, supplier_id, updated_at: db.fn.now() }); const p = await db('products').where({ id: req.params.id }).first(); if (!p) return res.status(404).json({ error: 'Product not found' }); res.json({ ...p, status: status(p) }); } catch (e) { if (String(e.message).match(/unique|duplicate/i)) return res.status(409).json({ error: 'SKU or barcode already exists' }); next(e); } });
app.post('/api/products/:id/adjustments', async (req, res, next) => { try { const { type, quantity, reason = 'Manual adjustment' } = req.body; const amount = Number(quantity); const product = await db('products').where({ id: req.params.id }).first(); if (!product) return res.status(404).json({ error: 'Product not found' }); const nextQty = type === 'set' ? amount : type === 'remove' ? product.quantity - amount : product.quantity + amount; if (!Number.isInteger(amount) || amount < 0 || nextQty < 0) return res.status(400).json({ error: 'Adjustment would create invalid or negative stock' }); await db.transaction(async trx => { await trx('products').where({ id: product.id }).update({ quantity: nextQty, updated_at: trx.fn.now() }); await trx('stock_movements').insert({ product_id: product.id, type, quantity: type === 'remove' ? -amount : type === 'set' ? nextQty - product.quantity : amount, reason }); }); const updated = await db('products').where({ id: product.id }).first(); res.json({ ...updated, status: status(updated) }); } catch (e) { next(e); } });
app.get('/api/sales', async (_, res, next) => { try { res.json(await db('sales').orderBy('created_at', 'desc')); } catch (e) { next(e); } });
app.post('/api/sales', async (req, res, next) => { try { const { product_id, quantity, customer = 'Walk-in customer', discount = 0, gst_rate = 0 } = req.body; const qty = Number(quantity); const sale = await db.transaction(async trx => { const product = await trx('products').where({ id: product_id }).first(); if (!product) throw Object.assign(new Error('Product not found'), { status: 404 }); if (!Number.isInteger(qty) || qty < 1 || qty > product.quantity) throw Object.assign(new Error('Insufficient stock'), { status: 400 }); const subtotal = Number(product.unit_cost) * qty, discountValue = Math.min(Number(discount) || 0, subtotal), gst = (subtotal - discountValue) * (Number(gst_rate) || 0) / 100, total = subtotal - discountValue + gst; const reference = `SO-${Date.now().toString().slice(-8)}`; const [saleId] = await trx('sales').insert({ reference, customer, subtotal, discount: discountValue, gst, total }); await trx('sale_items').insert({ sale_id: saleId, product_id, quantity: qty, unit_price: product.unit_cost }); await trx('products').where({ id: product.id }).update({ quantity: product.quantity - qty, updated_at: trx.fn.now() }); await trx('stock_movements').insert({ product_id: product.id, type: 'sale', quantity: -qty, reason: reference }); return trx('sales').where({ id: saleId }).first(); }); res.status(201).json(sale); } catch (e) { res.status(e.status || 500).json({ error: e.message || 'Unable to record sale' }); } });
app.use(express.static(path.join(__dirname, '..')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'inventory-app.html')));
app.use((err, _, res, __) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

initDatabase().then(() => app.listen(process.env.PORT || 3000, () => console.log(`Stockwise running on port ${process.env.PORT || 3000}`))).catch(err => { console.error('Database startup failed:', err); process.exit(1); });
