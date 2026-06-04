"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { appendLedgerEvent } = require("./ledger");

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sellers (
      seller_id TEXT PRIMARY KEY,
      brand_name TEXT NOT NULL,
      owner_contact TEXT NOT NULL,
      profile_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES sellers(seller_id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      contact TEXT NOT NULL,
      images_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      report_score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(product_id),
      seller_id TEXT NOT NULL REFERENCES sellers(seller_id),
      buyer_contact TEXT NOT NULL,
      buyer_message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'contact_requested',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_reports (
      report_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(product_id),
      reporter_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(product_id, reporter_key)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      review_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES sellers(seller_id),
      product_id TEXT REFERENCES products(product_id),
      order_id TEXT REFERENCES orders(order_id),
      reviewer_key TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complaints (
      complaint_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES sellers(seller_id),
      product_id TEXT REFERENCES products(product_id),
      complainant_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_sessions (
      seller_id TEXT PRIMARY KEY REFERENCES sellers(seller_id),
      room_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'live',
      endpoint_json TEXT NOT NULL DEFAULT '{}',
      candidates_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signal_messages (
      message_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      from_peer TEXT NOT NULL,
      to_peer TEXT,
      message_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signal_room_created
      ON signal_messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS ledger_events (
      id INTEGER PRIMARY KEY,
      prev_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL UNIQUE,
      signature TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      subject_seller_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "products", "category", "TEXT NOT NULL DEFAULT 'general'");
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function seedDatabase(db, ledgerSecret) {
  const now = new Date().toISOString();
  const sellers = [
    {
      sellerId: "weekend-roaster",
      brandName: "双休咖啡烘焙",
      ownerContact: "wechat:weekend-roaster",
      profile: {
        city: "Shanghai",
        bio: "Small-batch beans from a weekends-first team.",
        laborPolicy: "双休不加班",
        noOvertimePledge: true
      }
    },
    {
      sellerId: "two-day-prints",
      brandName: "双休印社",
      ownerContact: "email:prints@example.test",
      profile: {
        city: "Hangzhou",
        bio: "Risograph posters and zines from a no-overtime studio.",
        laborPolicy: "双休不加班",
        noOvertimePledge: true
      }
    }
  ];

  const insertSeller = db.prepare(
    `INSERT OR IGNORE INTO sellers
      (seller_id, brand_name, owner_contact, profile_json, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  );

  const sellerExists = db.prepare(
    "SELECT seller_id FROM sellers WHERE seller_id = ?"
  );

  for (const seller of sellers) {
    const before = sellerExists.get(seller.sellerId);
    insertSeller.run(
      seller.sellerId,
      seller.brandName,
      seller.ownerContact,
      JSON.stringify(seller.profile),
      now
    );
    if (!before) {
      appendLedgerEvent(db, ledgerSecret, {
        eventType: "SELLER_REGISTERED",
        actorId: seller.ownerContact,
        subjectSellerId: seller.sellerId,
        payload: {
          sellerId: seller.sellerId,
          brandName: seller.brandName,
          source: "seed"
        },
        createdAt: now
      });
    }
  }

  const insertProduct = db.prepare(
    `INSERT OR IGNORE INTO products
      (product_id, seller_id, title, description, category, price_cents, currency, contact, images_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  );

  insertProduct.run(
    "prod-weekend-roaster-001",
    "weekend-roaster",
    "双休拼配咖啡豆 250g",
    "双休不加班团队烘焙的中度烘焙咖啡豆，带可可与柑橘调性。",
    "food",
    6800,
    "CNY",
    "wechat:weekend-roaster",
    JSON.stringify([]),
    now,
    now
  );

  insertProduct.run(
    "prod-two-day-prints-001",
    "two-day-prints",
    "双休理念海报套装",
    "由不加班工作室制作的三张 A3 孔版印刷海报。",
    "art",
    12800,
    "CNY",
    "email:prints@example.test",
    JSON.stringify([]),
    now,
    now
  );

  return {
    sellers: db.prepare("SELECT COUNT(*) AS count FROM sellers").get().count,
    products: db.prepare("SELECT COUNT(*) AS count FROM products").get().count,
    ledgerEvents: db.prepare("SELECT COUNT(*) AS count FROM ledger_events").get()
      .count
  };
}

module.exports = { openDatabase, seedDatabase };
