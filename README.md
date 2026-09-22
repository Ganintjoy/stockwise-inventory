# Stockwise deployment package

This folder adds a production-ready Express API around the Stockwise web pages in its parent `outputs` directory. It provides products, adjustments, sales, stock-movement, and database APIs. The current browser prototype remains available at `/inventory-app.html`.

## Database choices

| Use case | Set `DB_CLIENT` | Required setting |
| --- | --- | --- |
| Single server, demo, small business | `sqlite` | `SQLITE_FILE=./data/stockwise.db` |
| Multiple users or cloud deployment | `postgres` | `DATABASE_URL=postgresql://...` |

SQLite is the default and creates its database file automatically. For production teams, use managed PostgreSQL and daily backups.

## Run locally

1. Install Node.js 20 or later.
2. From this folder, copy `.env.example` to `.env` and edit it if needed.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000/inventory-app.html`.

Check the server with `http://localhost:3000/api/health`.

## Docker deployment

Run these commands from the parent `outputs` folder so Docker includes the web pages:

```sh
docker build -f stockwise-server/Dockerfile -t stockwise .
docker run -d --name stockwise -p 3000:3000 -v stockwise-data:/data stockwise
```

Open `http://YOUR_SERVER_IP:3000/inventory-app.html`. The named volume preserves the SQLite database across container restarts. Place the service behind HTTPS (Nginx, Caddy, or your cloud load balancer) before production use.

## PostgreSQL deployment

Provision a PostgreSQL database, then configure these environment variables in the server or hosting provider:

```sh
DB_CLIENT=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/stockwise
DATABASE_SSL=true
```

Start the same Docker image. Tables are created on first startup. Back up PostgreSQL through the provider's scheduled backup feature.

For a self-hosted PostgreSQL stack, run this from the parent `outputs` folder:

```sh
docker compose -f docker-compose.postgres.yml up -d --build
```

Change the example password in `docker-compose.postgres.yml` before using it outside a local/private server.

## Hosting checklist

1. Build and push the Docker image to your registry, or upload the `outputs` folder to a Node-compatible host.
2. Set `NODE_ENV=production`, `PORT`, and the database variables.
3. Attach persistent storage for SQLite, or use PostgreSQL.
4. Map a domain and enforce HTTPS.
5. Restrict database network access to the application only; never expose PostgreSQL publicly.
6. Add authentication before allowing Internet-facing use; the prototype UI currently has no sign-in enforcement.

## API examples

`GET /api/products` lists products.

`POST /api/products` creates a product and rejects duplicate SKU or barcode.

`POST /api/products/:id/adjustments` accepts `{ "type": "add|remove|set", "quantity": 5, "reason": "Cycle count" }` and rejects negative stock.

`POST /api/sales` accepts `{ "product_id": 1, "quantity": 2, "discount": 10, "gst_rate": 18 }`; it atomically rejects insufficient stock and records the stock movement.
