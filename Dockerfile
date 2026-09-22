FROM node:20-bookworm-slim
WORKDIR /app
COPY stockwise-server/package*.json ./stockwise-server/
RUN cd stockwise-server && npm install --omit=dev
COPY . .
WORKDIR /app/stockwise-server
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_CLIENT=sqlite
ENV SQLITE_FILE=/data/stockwise.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
