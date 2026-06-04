"use strict";

const path = require("node:path");

const BASE_PATH = normalizeBasePath(
  process.env.BASE_PATH || "/shc-20260520-a1faaf/weekend-marketplace/"
);

const SERVER_URL =
  process.env.SERVER_URL ||
  "http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/";

const ROOT_DIR = path.resolve(__dirname, "..");

function normalizeBasePath(value) {
  let basePath = String(value || "/").trim();
  if (!basePath.startsWith("/")) basePath = `/${basePath}`;
  if (!basePath.endsWith("/")) basePath = `${basePath}/`;
  return basePath;
}

function loadConfig(overrides = {}) {
  return {
    basePath: overrides.basePath || BASE_PATH,
    serverUrl: overrides.serverUrl || SERVER_URL,
    port: Number(overrides.port || process.env.PORT || 3000),
    host: overrides.host || process.env.HOST || "::",
    dbPath:
      overrides.dbPath ||
      process.env.DB_PATH ||
      path.join(ROOT_DIR, "data", "marketplace.sqlite"),
    ledgerSecret:
      overrides.ledgerSecret ||
      process.env.LEDGER_SECRET ||
      "development-ledger-secret-change-me",
    adminToken:
      overrides.adminToken || process.env.ADMIN_TOKEN || "dev-admin-token",
    reportThreshold: Number(
      overrides.reportThreshold || process.env.REPORT_THRESHOLD || 3
    ),
    apkPath:
      overrides.apkPath ||
      process.env.APK_PATH ||
      path.join(ROOT_DIR, "public", "download", "two-day-weekend-marketplace.apk"),
    webDir:
      overrides.webDir ||
      process.env.WEB_DIR ||
      path.resolve(ROOT_DIR, "..", "web", "dist")
  };
}

module.exports = { loadConfig, normalizeBasePath };
