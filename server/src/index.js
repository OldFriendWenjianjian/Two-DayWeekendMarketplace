"use strict";

const { createApp } = require("./app");
const { loadConfig } = require("./config");

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  const bound = typeof address === "string" ? address : `${address.address}:${address.port}`;
  console.log(`Marketplace server listening on ${bound}`);
  console.log(`Base URL: ${config.serverUrl}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
