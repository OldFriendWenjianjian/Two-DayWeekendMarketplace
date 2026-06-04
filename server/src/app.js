"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { openDatabase, seedDatabase } = require("./db");
const { appendLedgerEvent, verifyLedger } = require("./ledger");
const { loadConfig } = require("./config");

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = overrides.db || openDatabase(config.dbPath);
  const app = express();
  const router = express.Router();

  app.locals.config = config;
  app.locals.db = db;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Admin-Token"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  });

  app.get("/", (req, res) => res.redirect(config.basePath));

  if (config.webDir && fs.existsSync(config.webDir)) {
    router.use(
      express.static(config.webDir, {
        index: false,
        maxAge: "5m"
      })
    );
  }

  router.get("/", (req, res) => sendWebIndexOrHome(res, config));

  router.get("/health", (req, res) => {
    const ledger = verifyLedger(db, config.ledgerSecret);
    res.json({
      ok: true,
      service: "shuangxiu-supermarket-server",
      basePath: config.basePath,
      ledger
    });
  });

  router.get("/api/docs", (req, res) => {
    res.json(buildDocs(config));
  });

  router.get("/api/marketplace", (req, res) => {
    res.json(buildMarketplacePayload(db));
  });

  router.get("/api/seed", requireAdmin(config), (req, res) => {
    res.json(seedDatabase(db, config.ledgerSecret));
  });

  router.post("/api/seed", requireAdmin(config), (req, res) => {
    res.status(201).json(seedDatabase(db, config.ledgerSecret));
  });

  router.post("/api/sellers/apply", (req, res) => {
    const body = req.body || {};
    const sellerId = normalizeSellerId(body.sellerId);
    const brandName = requiredString(body.brandName, "brandName");
    const ownerContact = requiredString(body.ownerContact, "ownerContact");
    const profile = objectOrDefault(body.profile, {});
    const now = new Date().toISOString();

    if (!sellerId) {
      throw badRequest("sellerId must be 3-40 lowercase letters, numbers, or dashes");
    }

    try {
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO sellers
            (seller_id, brand_name, owner_contact, profile_json, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)`
        ).run(sellerId, brandName, ownerContact, JSON.stringify(profile), now);
        appendLedgerEvent(db, config.ledgerSecret, {
          eventType: "SELLER_REGISTERED",
          actorId: ownerContact,
          subjectSellerId: sellerId,
          payload: { sellerId, brandName, profile },
          createdAt: now
        });
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        throw conflict("sellerId is already registered and cannot be reused");
      }
      throw error;
    }

    res.status(201).json(getSeller(db, sellerId));
  });

  router.get("/api/sellers", (req, res) => {
    const rows = db
      .prepare(
        `SELECT seller_id, brand_name, owner_contact, profile_json, status, created_at
         FROM sellers ORDER BY created_at DESC`
      )
      .all();
    res.json({ sellers: rows.map(mapSeller) });
  });

  router.get("/api/sellers/:sellerId", (req, res) => {
    const seller = getSeller(db, req.params.sellerId);
    if (!seller) throw notFound("seller not found");
    res.json(seller);
  });

  router.post("/api/sellers/:sellerId/reviews", (req, res) => {
    const sellerId = req.params.sellerId;
    ensureSeller(db, sellerId);
    const body = req.body || {};
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw badRequest("rating must be an integer from 1 to 5");
    }
    const reviewId = id("rev");
    const now = new Date().toISOString();
    const productId = optionalString(body.productId);
    const orderId = optionalString(body.orderId);
    const reviewerKey = requiredString(body.reviewerKey, "reviewerKey");
    const comment = optionalString(body.comment) || "";

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO reviews
          (review_id, seller_id, product_id, order_id, reviewer_key, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(reviewId, sellerId, productId, orderId, reviewerKey, rating, comment, now);
      appendLedgerEvent(db, config.ledgerSecret, {
        eventType: "REVIEW_CREATED",
        actorId: reviewerKey,
        subjectSellerId: sellerId,
        payload: { reviewId, productId, orderId, rating, comment },
        createdAt: now
      });
    });

    res.status(201).json({ reviewId, sellerId, productId, orderId, rating, comment, createdAt: now });
  });

  router.post("/api/sellers/:sellerId/complaints", (req, res) => {
    const sellerId = req.params.sellerId;
    ensureSeller(db, sellerId);
    const body = req.body || {};
    const complaintId = id("cmp");
    const now = new Date().toISOString();
    const productId = optionalString(body.productId);
    const complainantKey = requiredString(body.complainantKey, "complainantKey");
    const reason = requiredString(body.reason, "reason");

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO complaints
          (complaint_id, seller_id, product_id, complainant_key, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(complaintId, sellerId, productId, complainantKey, reason, now);
      appendLedgerEvent(db, config.ledgerSecret, {
        eventType: "COMPLAINT_FILED",
        actorId: complainantKey,
        subjectSellerId: sellerId,
        payload: { complaintId, productId, reason },
        createdAt: now
      });
    });

    res.status(201).json({ complaintId, sellerId, productId, reason, createdAt: now });
  });

  router.post("/api/products", (req, res) => {
    const body = req.body || {};
    const sellerId = requiredString(body.sellerId, "sellerId");
    ensureSeller(db, sellerId);
    const productId = id("prod");
    const now = new Date().toISOString();
    const title = requiredString(body.title, "title");
    const description = optionalString(body.description) || "";
    const category = normalizeCategory(body.category);
    const priceCents = Number(body.priceCents);
    const currency = optionalString(body.currency) || "CNY";
    const contact = requiredString(body.contact, "contact");
    const images = normalizeProductImages(body.images);

    if (!Number.isInteger(priceCents) || priceCents < 0) {
      throw badRequest("priceCents must be a non-negative integer");
    }

    db.prepare(
      `INSERT INTO products
        (product_id, seller_id, title, description, category, price_cents, currency, contact, images_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(
      productId,
      sellerId,
      title,
      description,
      category,
      priceCents,
      currency,
      contact,
      JSON.stringify(images),
      now,
      now
    );

    res.status(201).json(getProduct(db, productId, true));
  });

  router.get("/api/products", (req, res) => {
    const includeHidden = req.query.includeHidden === "true";
    const filters = [];
    const params = [];
    if (!includeHidden) filters.push("p.status = 'active'");
    const category = optionalString(req.query.category);
    if (category && category !== "all") {
      filters.push("p.category = ?");
      params.push(normalizeCategory(category));
    }
    const search = optionalString(req.query.q);
    if (search) {
      filters.push("(p.title LIKE ? OR p.description LIKE ? OR s.brand_name LIKE ?)");
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
    const statusFilter = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT p.*, s.brand_name
         FROM products p JOIN sellers s ON s.seller_id = p.seller_id
         ${statusFilter}
         ORDER BY p.created_at DESC`
      )
      .all(...params);
    res.json({ products: rows.map(mapProduct) });
  });

  router.get("/api/products/:productId", (req, res) => {
    const product = getProduct(db, req.params.productId, req.query.includeHidden === "true");
    if (!product) throw notFound("product not found");
    res.json(product);
  });

  router.post("/api/products/:productId/reports", (req, res) => {
    const product = getProduct(db, req.params.productId, true);
    if (!product) throw notFound("product not found");
    const body = req.body || {};
    const reporterKey = requiredString(body.reporterKey, "reporterKey");
    const reason = requiredString(body.reason, "reason");
    const reportId = id("rpt");
    const now = new Date().toISOString();
    let autoHidden = false;

    try {
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO product_reports
            (report_id, product_id, reporter_key, reason, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(reportId, product.productId, reporterKey, reason, now);

        const score = db
          .prepare("SELECT COUNT(*) AS count FROM product_reports WHERE product_id = ?")
          .get(product.productId).count;
        db.prepare("UPDATE products SET report_score = ?, updated_at = ? WHERE product_id = ?")
          .run(score, now, product.productId);

        appendLedgerEvent(db, config.ledgerSecret, {
          eventType: "PRODUCT_REPORT",
          actorId: reporterKey,
          subjectSellerId: product.sellerId,
          payload: { reportId, productId: product.productId, reason, score },
          createdAt: now
        });

        if (score >= config.reportThreshold && product.status === "active") {
          autoHidden = true;
          db.prepare("UPDATE products SET status = 'hidden', updated_at = ? WHERE product_id = ?")
            .run(now, product.productId);
          appendLedgerEvent(db, config.ledgerSecret, {
            eventType: "GOVERNANCE_AUTO_HIDE",
            actorId: "system",
            subjectSellerId: product.sellerId,
            payload: {
              productId: product.productId,
              reportScore: score,
              threshold: config.reportThreshold
            },
            createdAt: now
          });
        }
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        throw conflict("reporterKey has already reported this product");
      }
      throw error;
    }

    res.status(201).json({
      reportId,
      productId: product.productId,
      autoHidden,
      product: getProduct(db, product.productId, true)
    });
  });

  router.post("/api/orders", (req, res) => {
    const body = req.body || {};
    const product = getProduct(db, requiredString(body.productId, "productId"), false);
    if (!product) throw notFound("active product not found");
    const orderId = id("ord");
    const now = new Date().toISOString();
    const buyerContact = requiredString(body.buyerContact, "buyerContact");
    const buyerMessage = optionalString(body.buyerMessage) || "";

    db.prepare(
      `INSERT INTO orders
        (order_id, product_id, seller_id, buyer_contact, buyer_message, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'contact_requested', ?)`
    ).run(orderId, product.productId, product.sellerId, buyerContact, buyerMessage, now);

    res.status(201).json({
      orderId,
      productId: product.productId,
      sellerId: product.sellerId,
      buyerContact,
      sellerContact: product.contact,
      status: "contact_requested",
      note: "No real payment is processed. Buyer and seller should contact each other directly.",
      createdAt: now
    });
  });

  router.get("/api/orders/:orderId", (req, res) => {
    const row = db.prepare("SELECT * FROM orders WHERE order_id = ?").get(req.params.orderId);
    if (!row) throw notFound("order not found");
    res.json(mapOrder(row));
  });

  router.post("/api/admin/products/:productId/force-hide", requireAdmin(config), (req, res) => {
    const product = getProduct(db, req.params.productId, true);
    if (!product) throw notFound("product not found");
    const body = req.body || {};
    const reason = requiredString(body.reason, "reason");
    const now = new Date().toISOString();

    withTransaction(db, () => {
      db.prepare("UPDATE products SET status = 'admin_removed', updated_at = ? WHERE product_id = ?")
        .run(now, product.productId);
      appendLedgerEvent(db, config.ledgerSecret, {
        eventType: "GOVERNANCE_ADMIN_HIDE",
        actorId: "admin",
        subjectSellerId: product.sellerId,
        payload: { productId: product.productId, reason },
        createdAt: now
      });
    });

    res.json(getProduct(db, product.productId, true));
  });

  router.put("/api/live/sessions/:sellerId", (req, res) => {
    const sellerId = req.params.sellerId;
    ensureSeller(db, sellerId);
    const body = req.body || {};
    const roomId = optionalString(body.roomId) || `room-${sellerId}`;
    const endpoint = objectOrDefault(body.endpoint, {});
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const metadata = objectOrDefault(body.metadata, {});
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO live_sessions
        (seller_id, room_id, status, endpoint_json, candidates_json, metadata_json, updated_at)
       VALUES (?, ?, 'live', ?, ?, ?, ?)
       ON CONFLICT(seller_id) DO UPDATE SET
        room_id = excluded.room_id,
        status = 'live',
        endpoint_json = excluded.endpoint_json,
        candidates_json = excluded.candidates_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`
    ).run(
      sellerId,
      roomId,
      JSON.stringify(endpoint),
      JSON.stringify(candidates),
      JSON.stringify(metadata),
      now
    );

    res.json(getLiveSession(db, sellerId));
  });

  router.get("/api/live/sessions", (req, res) => {
    const rows = db
      .prepare(
        `SELECT l.*, s.brand_name
         FROM live_sessions l JOIN sellers s ON s.seller_id = l.seller_id
         WHERE l.status = 'live'
         ORDER BY l.updated_at DESC`
      )
      .all();
    res.json({ sessions: rows.map(mapLiveSession) });
  });

  router.get("/api/live/sessions/:sellerId", (req, res) => {
    const session = getLiveSession(db, req.params.sellerId);
    if (!session || session.status !== "live") throw notFound("live session not found");
    res.json(session);
  });

  router.delete("/api/live/sessions/:sellerId", (req, res) => {
    ensureSeller(db, req.params.sellerId);
    db.prepare("UPDATE live_sessions SET status = 'ended', updated_at = ? WHERE seller_id = ?")
      .run(new Date().toISOString(), req.params.sellerId);
    res.status(204).send();
  });

  router.post("/api/signaling/rooms", (req, res) => {
    const body = req.body || {};
    const roomId = optionalString(body.roomId) || id("room");
    res.status(201).json({ roomId });
  });

  router.post("/api/signaling/rooms/:roomId/messages", (req, res) => {
    const body = req.body || {};
    const messageId = id("sig");
    const now = new Date().toISOString();
    const fromPeer = requiredString(body.fromPeer, "fromPeer");
    const toPeer = optionalString(body.toPeer);
    const messageType = requiredString(body.type, "type");
    const payload = objectOrDefault(body.payload, {});

    db.prepare(
      `INSERT INTO signal_messages
        (message_id, room_id, from_peer, to_peer, message_type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(messageId, req.params.roomId, fromPeer, toPeer, messageType, JSON.stringify(payload), now);

    res.status(201).json({ messageId, roomId: req.params.roomId, createdAt: now });
  });

  router.get("/api/signaling/rooms/:roomId/messages", (req, res) => {
    const peer = optionalString(req.query.peer);
    const since = optionalString(req.query.since);
    const params = [req.params.roomId];
    let filter = "WHERE room_id = ?";
    if (peer) {
      filter += " AND (to_peer IS NULL OR to_peer = ? OR from_peer = ?)";
      params.push(peer, peer);
    }
    if (since) {
      filter += " AND created_at > ?";
      params.push(since);
    }
    const rows = db
      .prepare(
        `SELECT * FROM signal_messages ${filter} ORDER BY created_at ASC LIMIT 100`
      )
      .all(...params);
    res.json({ messages: rows.map(mapSignalMessage) });
  });

  router.get("/api/download", (req, res) => {
    res.json(downloadInfo(config));
  });

  router.get("/download", (req, res) => {
    res.type("html").send(renderDownloadPage(config));
  });

  router.get("/promo", (req, res) => {
    res.type("html").send(renderDownloadPage(config));
  });

  router.get("/download/two-day-weekend-marketplace.apk", (req, res) => {
    if (!fs.existsSync(config.apkPath)) {
      return res.status(404).json({
        error: "APK file is not available yet",
        expectedPath: config.apkPath,
        uploadHint: "Place the APK at APK_PATH or server/public/download/two-day-weekend-marketplace.apk."
      });
    }
    return res.download(config.apkPath, "two-day-weekend-marketplace.apk");
  });

  router.get("/api/ledger/verify", (req, res) => {
    res.json(verifyLedger(db, config.ledgerSecret));
  });

  router.get("/api/ledger/events", (req, res) => {
    const afterId = Number(req.query.afterId || 0);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const rows = db
      .prepare("SELECT * FROM ledger_events WHERE id > ? ORDER BY id ASC LIMIT ?")
      .all(Number.isFinite(afterId) ? afterId : 0, limit);
    res.json({
      events: rows.map(mapLedgerEvent),
      verify: verifyLedger(db, config.ledgerSecret)
    });
  });

  router.get("/api/sellers/:sellerId/reputation", (req, res) => {
    const seller = getSeller(db, req.params.sellerId);
    if (!seller) throw notFound("seller not found");
    const reviews = db
      .prepare("SELECT * FROM reviews WHERE seller_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(seller.sellerId)
      .map(mapReview);
    const complaints = db
      .prepare("SELECT * FROM complaints WHERE seller_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(seller.sellerId)
      .map(mapComplaint);
    const ledgerEvents = db
      .prepare("SELECT * FROM ledger_events WHERE subject_seller_id = ? ORDER BY id ASC")
      .all(seller.sellerId)
      .map(mapLedgerEvent);
    const averageRating = reviews.length
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : null;
    res.json({
      seller,
      metrics: {
        reviewCount: reviews.length,
        complaintCount: complaints.length,
        averageRating
      },
      reviews,
      complaints,
      ledgerEvents,
      ledgerVerify: verifyLedger(db, config.ledgerSecret)
    });
  });

  router.get("/api/admin/ledger/events", requireAdmin(config), (req, res) => {
    const rows = db
      .prepare("SELECT * FROM ledger_events ORDER BY id ASC")
      .all();
    res.json({ events: rows.map(mapLedgerEvent) });
  });

  app.use(config.basePath, router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function requireAdmin(config) {
  return (req, res, next) => {
    if (req.get("X-Admin-Token") !== config.adminToken) {
      return res.status(401).json({ error: "admin token required" });
    }
    return next();
  };
}

function withTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureSeller(db, sellerId) {
  const seller = getSeller(db, sellerId);
  if (!seller) throw notFound("seller not found");
  if (seller.status !== "active") throw badRequest("seller is not active");
  return seller;
}

function getSeller(db, sellerId) {
  const row = db
    .prepare(
      `SELECT seller_id, brand_name, owner_contact, profile_json, status, created_at
       FROM sellers WHERE seller_id = ?`
    )
    .get(sellerId);
  return row ? mapSeller(row) : null;
}

function getProduct(db, productId, includeHidden) {
  const row = db
    .prepare(
      `SELECT p.*, s.brand_name
       FROM products p JOIN sellers s ON s.seller_id = p.seller_id
       WHERE p.product_id = ? ${includeHidden ? "" : "AND p.status = 'active'"}`
    )
    .get(productId);
  return row ? mapProduct(row) : null;
}

function getLiveSession(db, sellerId) {
  const row = db
    .prepare(
      `SELECT l.*, s.brand_name
       FROM live_sessions l JOIN sellers s ON s.seller_id = l.seller_id
       WHERE l.seller_id = ?`
    )
    .get(sellerId);
  return row ? mapLiveSession(row) : null;
}

function mapSeller(row) {
  return {
    sellerId: row.seller_id,
    brandName: row.brand_name,
    ownerContact: row.owner_contact,
    profile: parseJson(row.profile_json, {}),
    status: row.status,
    createdAt: row.created_at
  };
}

function mapProduct(row) {
  return {
    productId: row.product_id,
    sellerId: row.seller_id,
    sellerBrandName: row.brand_name,
    title: row.title,
    description: row.description,
    category: row.category || "general",
    priceCents: row.price_cents,
    currency: row.currency,
    contact: row.contact,
    images: parseJson(row.images_json, []),
    status: row.status,
    reportScore: row.report_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapReview(row) {
  return {
    reviewId: row.review_id,
    sellerId: row.seller_id,
    productId: row.product_id,
    orderId: row.order_id,
    reviewerKey: row.reviewer_key,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at
  };
}

function mapComplaint(row) {
  return {
    complaintId: row.complaint_id,
    sellerId: row.seller_id,
    productId: row.product_id,
    complainantKey: row.complainant_key,
    reason: row.reason,
    createdAt: row.created_at
  };
}

function mapOrder(row) {
  return {
    orderId: row.order_id,
    productId: row.product_id,
    sellerId: row.seller_id,
    buyerContact: row.buyer_contact,
    buyerMessage: row.buyer_message,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapLiveSession(row) {
  return {
    sellerId: row.seller_id,
    sellerBrandName: row.brand_name,
    roomId: row.room_id,
    status: row.status,
    endpoint: parseJson(row.endpoint_json, {}),
    candidates: parseJson(row.candidates_json, []),
    metadata: parseJson(row.metadata_json, {}),
    updatedAt: row.updated_at
  };
}

function mapSignalMessage(row) {
  return {
    messageId: row.message_id,
    roomId: row.room_id,
    fromPeer: row.from_peer,
    toPeer: row.to_peer,
    type: row.message_type,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function mapLedgerEvent(row) {
  return {
    id: row.id,
    prevHash: row.prev_hash,
    eventHash: row.event_hash,
    signature: row.signature,
    eventType: row.event_type,
    actorId: row.actor_id,
    subjectSellerId: row.subject_seller_id,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function buildMarketplacePayload(db) {
  const products = db
    .prepare(
      `SELECT p.*, s.brand_name
       FROM products p JOIN sellers s ON s.seller_id = p.seller_id
       WHERE p.status = 'active'
       ORDER BY p.created_at DESC`
    )
    .all();
  const sellers = db
    .prepare(
      `SELECT seller_id, brand_name, owner_contact, profile_json, status, created_at
       FROM sellers ORDER BY created_at DESC`
    )
    .all();
  const ledgerRows = db
    .prepare("SELECT * FROM ledger_events ORDER BY id DESC LIMIT 100")
    .all();
  const reviewRows = db
    .prepare("SELECT * FROM reviews ORDER BY created_at DESC LIMIT 100")
    .all();
  const orderRows = db
    .prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")
    .all();
  const liveRows = db
    .prepare(
      `SELECT l.*, s.brand_name
       FROM live_sessions l JOIN sellers s ON s.seller_id = l.seller_id
       WHERE l.status = 'live'
       ORDER BY l.updated_at DESC`
    )
    .all();

  return {
    categories: [
      { id: "fresh", label: "双休鲜食", accent: "#2f8f83" },
      { id: "craft", label: "手作好物", accent: "#d5684e" },
      { id: "digital", label: "数码轻装", accent: "#4f7fcf" },
      { id: "home", label: "家居日用", accent: "#b3862f" },
      { id: "fashion", label: "穿搭配饰", accent: "#b5527e" },
      { id: "service", label: "本地服务", accent: "#4e8f9b" }
    ],
    products: products.map(toFrontendProduct),
    stores: sellers.map((seller) => toFrontendStore(db, seller)),
    ledgerEvents: ledgerRows.map(toFrontendLedgerEvent).reverse(),
    reviews: reviewRows.map(toFrontendReview),
    orders: orderRows.map(toFrontendOrder),
    liveRooms: liveRows.map(toFrontendLiveRoom)
  };
}

function toFrontendProduct(row) {
  const images = parseJson(row.images_json, []).filter((image) => typeof image === "string");
  const fallbackImage = gradientFor(row.product_id);
  return {
    id: row.product_id,
    storeId: row.seller_id,
    title: row.title,
    category: toFrontendCategory(row.category),
    price: Math.round(row.price_cents) / 100,
    stock: 99,
    rating: 4.8,
    sold: Math.max(0, row.report_score || 0),
    image: images[0] || fallbackImage,
    images,
    tags: ["双休承诺", row.currency || "CNY", row.brand_name || "店铺"],
    description:
      row.description ||
      "仅收录承诺双休、不加班公司的产品；普通商品信息不进入信誉账本。",
    specs: {
      联系: row.contact,
      类目: toFrontendCategory(row.category),
      状态: row.status,
      入驻规则: "双休不加班"
    }
  };
}

function toFrontendStore(db, row) {
  const profile = parseJson(row.profile_json, {});
  const reviews = db
    .prepare("SELECT AVG(rating) AS rating, COUNT(*) AS count FROM reviews WHERE seller_id = ?")
    .get(row.seller_id);
  const complaints = db
    .prepare("SELECT COUNT(*) AS count FROM complaints WHERE seller_id = ?")
    .get(row.seller_id);
  const score = Math.max(
    0,
    Math.min(100, Math.round(88 + (reviews.rating || 0) * 2 - complaints.count * 4))
  );
  return {
    id: row.seller_id,
    name: row.brand_name,
    owner: row.owner_contact,
    uniqueChainId: row.seller_id,
    avatar: String(row.brand_name || row.seller_id).slice(0, 1).toUpperCase(),
    banner: gradientFor(row.seller_id),
    reputation: score,
    followers: 0,
    status: row.status === "active" ? "verified" : "restricted",
    joinedAt: row.created_at,
    laborPolicy: profile.laborPolicy || "双休不加班",
    noOvertimePledge: profile.noOvertimePledge !== false
  };
}

function toFrontendLedgerEvent(row) {
  const payload = parseJson(row.payload_json, {});
  const eventType = String(row.event_type || "");
  return {
    id: String(row.id),
    storeId: row.subject_seller_id || payload.sellerId || "",
    type: toFrontendLedgerType(eventType),
    title: titleForLedgerEvent(eventType),
    detail: detailForLedgerEvent(eventType, payload),
    scoreDelta: scoreDeltaForLedgerEvent(eventType),
    txHash: row.event_hash,
    blockHeight: row.id,
    createdAt: row.created_at
  };
}

function toFrontendReview(row) {
  return {
    id: row.review_id,
    productId: row.product_id || "",
    storeId: row.seller_id,
    user: row.reviewer_key,
    rating: row.rating,
    content: row.comment,
    createdAt: row.created_at,
    txHash: row.review_id
  };
}

function toFrontendOrder(row) {
  return {
    id: row.order_id,
    status: "待发货",
    items: [{ productId: row.product_id, quantity: 1 }],
    total: 0,
    createdAt: row.created_at
  };
}

function toFrontendLiveRoom(row) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.room_id,
    storeId: row.seller_id,
    title: metadata.title || `${row.brand_name} 正在直播`,
    cover: gradientFor(row.room_id),
    status: "live",
    startedAt: row.updated_at,
    viewers: Number(metadata.viewers || 1),
    signalingChannel: `/api/signaling/rooms/${row.room_id}`,
    hostPeerId: `merchant-${row.seller_id}`
  };
}

function toFrontendCategory(category) {
  const value = String(category || "general").toLowerCase();
  if (["fresh", "food", "tea", "coffee"].includes(value)) return "fresh";
  if (["craft", "art", "beauty", "handmade"].includes(value)) return "craft";
  if (["digital", "electronics"].includes(value)) return "digital";
  if (["home", "household"].includes(value)) return "home";
  if (["fashion", "clothing"].includes(value)) return "fashion";
  if (["service", "local"].includes(value)) return "service";
  return "craft";
}

function toFrontendLedgerType(eventType) {
  if (eventType.includes("REVIEW")) return "review";
  if (eventType.includes("COMPLAINT")) return "complaint";
  if (eventType.includes("REPORT")) return "governance_downvote";
  if (eventType.includes("HIDE")) return "governance_removed";
  return "store_verified";
}

function titleForLedgerEvent(eventType) {
  if (eventType.includes("SELLER")) return "店家 ID 已登记";
  if (eventType.includes("REVIEW")) return "买家评价已上链";
  if (eventType.includes("COMPLAINT")) return "投诉记录已上链";
  if (eventType.includes("REPORT")) return "下架投票已记录";
  if (eventType.includes("AUTO_HIDE")) return "投票阈值触发下架";
  if (eventType.includes("ADMIN_HIDE")) return "管理员强制下架";
  return "信誉事件已上链";
}

function detailForLedgerEvent(eventType, payload) {
  if (eventType.includes("SELLER")) {
    return `${payload.sellerId || "店家"} 全局唯一，登记后不可重复、不可删除。`;
  }
  if (eventType.includes("REVIEW")) {
    return `评分 ${payload.rating || "-"}，评价内容已进入私有签名账本。`;
  }
  if (eventType.includes("COMPLAINT")) {
    return payload.reason || "投诉记录已进入私有签名账本。";
  }
  if (eventType.includes("REPORT")) {
    return `商品 ${payload.productId || ""} 收到下架投票，当前票数 ${payload.score || 1}。`;
  }
  if (eventType.includes("HIDE")) {
    return `商品 ${payload.productId || ""} 已由治理规则或管理员处理。`;
  }
  return "事件 hash 与签名可公开同步校验。";
}

function scoreDeltaForLedgerEvent(eventType) {
  if (eventType.includes("SELLER")) return 10;
  if (eventType.includes("REVIEW")) return 3;
  if (eventType.includes("COMPLAINT") || eventType.includes("REPORT")) return -2;
  if (eventType.includes("HIDE")) return -5;
  return 0;
}

function gradientFor(seed) {
  const palettes = [
    ["#2f8f83", "#f8d36b"],
    ["#d5684e", "#7fb6f0"],
    ["#4f7fcf", "#2f8f83"],
    ["#b5527e", "#ffddeb"],
    ["#4e8f9b", "#d6f5fa"],
    ["#b3862f", "#eef8c8"]
  ];
  const index = Math.abs(
    String(seed || "")
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0)
  ) % palettes.length;
  const [a, b] = palettes[index];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function objectOrDefault(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function requiredString(value, name) {
  const normalized = optionalString(value);
  if (!normalized) throw badRequest(`${name} is required`);
  if (normalized.length > 2000) throw badRequest(`${name} is too long`);
  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeSellerId(value) {
  const sellerId = optionalString(value);
  if (!sellerId) return null;
  const normalized = sellerId.toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(normalized)) return null;
  return normalized;
}

function normalizeCategory(value) {
  const category = optionalString(value);
  if (!category) return "general";
  return category.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "general";
}

function normalizeProductImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("images must be an array");
  if (value.length > 8) throw badRequest("images cannot contain more than 8 items");

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw badRequest(`images[${index}] must be a string`);
    }
    const image = item.trim();
    if (!image) throw badRequest(`images[${index}] cannot be empty`);
    if (image.length > 4 * 1024 * 1024) {
      throw badRequest(`images[${index}] is too large`);
    }
    if (!isAllowedProductImage(image)) {
      throw badRequest(`images[${index}] must be an http(s) URL or image data URL`);
    }
    return image;
  });
}

function isAllowedProductImage(value) {
  return /^https?:\/\/\S+$/i.test(value) ||
    /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function badRequest(message) {
  return httpError(400, message);
}

function conflict(message) {
  return httpError(409, message);
}

function notFound(message) {
  return httpError(404, message);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: "route not found" });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  res.status(status).json({
    error: status >= 500 ? "internal server error" : error.message
  });
}

function downloadInfo(config) {
  const available = fs.existsSync(config.apkPath);
  const stats = available ? fs.statSync(config.apkPath) : null;
  return {
    appName: "双休超市",
    available,
    fileName: "two-day-weekend-marketplace.apk",
    fileSizeBytes: stats ? stats.size : 0,
    downloadUrl: `${config.basePath}download/two-day-weekend-marketplace.apk`,
    absoluteDownloadUrl: new URL(
      "download/two-day-weekend-marketplace.apk",
      config.serverUrl
    ).toString(),
    promoUrl: new URL("download", config.serverUrl).toString(),
    policy:
      "双休超市只上架双休、不加班公司的产品。我们支持认真工作，也支持按时下班。",
    expectedPath: config.apkPath
  };
}

function renderHome(config) {
  const info = downloadInfo(config);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>双休超市</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.6; background: #f7fbf8; color: #1f352f; }
    a { color: #137a70; font-weight: 800; }
    code { background: #e9f4f1; padding: .15rem .35rem; border-radius: .25rem; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>双休超市</h1>
  <p>${escapeHtml(info.policy)}</p>
  <p>IPv6 下载链接：<code>${escapeHtml(info.absoluteDownloadUrl)}</code></p>
  <p><a href="download">打开宣传下载页</a> · <a href="api/docs">API docs</a> · <a href="health">Health</a></p>
</body>
</html>`;
}

function sendWebIndexOrHome(res, config) {
  const indexPath = path.join(config.webDir || "", "index.html");
  if (config.webDir && fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.type("html").send(renderHome(config));
}

function renderDownloadPage(config) {
  const info = downloadInfo(config);
  const directUrl = escapeHtml(info.absoluteDownloadUrl);
  const appUrl = escapeHtml(config.basePath);
  const apkUrl = escapeHtml(info.downloadUrl);
  const iconUrl = escapeHtml(`${config.basePath}icon-512.png`);
  const fileSize = info.fileSizeBytes
    ? `${Math.round(info.fileSizeBytes / 1024)} KB`
    : "等待上传";
  const statusText = info.available ? `APK 已就绪，大小 ${fileSize}` : "APK 尚未上传";
  const statusClass = info.available ? "ready" : "pending";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#173b38">
  <meta name="description" content="双休超市 Android APK 下载。只上架双休不加班公司的产品，人人都能参与商城治理。">
  <title>双休超市 APK 下载</title>
  <style>
    :root {
      color: #163330;
      background: #f6faf8;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      background: #f6faf8;
      color: #163330;
    }
    main {
      width: min(100%, 1180px);
      margin: 0 auto;
      padding: 18px 18px 44px;
    }
    a { color: inherit; }
    .topbar {
      min-height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      color: #173b38;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 950;
    }
    .brand img {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      box-shadow: 0 8px 18px rgba(22, 51, 48, .14);
    }
    .topbar nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      color: #587069;
      font-size: 13px;
      font-weight: 850;
    }
    .topbar nav a {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      border-radius: 8px;
      text-decoration: none;
      background: rgba(255, 255, 255, .78);
      border: 1px solid rgba(22, 51, 48, .08);
    }
    .hero {
      min-height: min(650px, calc(100vh - 86px));
      display: grid;
      align-content: center;
      gap: 26px;
      margin-top: 8px;
      padding: clamp(32px, 7vw, 78px);
      overflow: hidden;
      border-radius: 8px;
      color: white;
      background:
        linear-gradient(115deg, rgba(19, 77, 69, .96) 0%, rgba(25, 95, 84, .92) 52%, rgba(25, 95, 84, .52) 100%),
        url("${iconUrl}") right clamp(18px, 7vw, 86px) center / min(42vw, 430px) no-repeat,
        #173b38;
      box-shadow: 0 22px 54px rgba(22, 51, 48, .18);
      position: relative;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto 0 0;
      height: 9px;
      background: linear-gradient(90deg, #f8d36b, #d5684e, #4f7fcf, #2f8f83);
    }
    .hero-content {
      width: min(100%, 760px);
      position: relative;
      z-index: 1;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      margin-bottom: 12px;
      border-radius: 99px;
      background: rgba(255, 255, 255, .14);
      color: #f8d36b;
      font-size: 14px;
      font-weight: 900;
    }
    h1 {
      margin: 0;
      max-width: 700px;
      font-size: clamp(42px, 9vw, 96px);
      line-height: .96;
      letter-spacing: 0;
    }
    .lead {
      margin: 20px 0 0;
      max-width: 620px;
      color: rgba(255, 255, 255, .9);
      font-size: clamp(18px, 3vw, 27px);
      line-height: 1.42;
      font-weight: 780;
    }
    .governance-line {
      margin: 16px 0 0;
      max-width: 640px;
      color: rgba(255, 255, 255, .82);
      font-size: 15px;
      line-height: 1.7;
    }
    .download-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-top: 28px;
    }
    .primary-link,
    .secondary-link {
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 22px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 900;
    }
    .primary-link { background: #f8d36b; color: #173b38; box-shadow: 0 14px 34px rgba(0, 0, 0, .2); }
    .secondary-link { background: rgba(255, 255, 255, .12); color: white; border: 1px solid rgba(255, 255, 255, .24); }
    .status {
      width: fit-content;
      max-width: 100%;
      margin-top: 14px;
      padding: 8px 11px;
      border-radius: 8px;
      background: rgba(255, 255, 255, .12);
      color: white;
      font-weight: 850;
    }
    .status.ready::before { content: "已发布"; color: #f8d36b; margin-right: 8px; }
    .status.pending::before { content: "等待"; color: #ffd6c8; margin-right: 8px; }
    .url-box {
      margin-top: 18px;
      display: grid;
      gap: 8px;
      padding: 14px;
      border-radius: 8px;
      background: rgba(0, 0, 0, .22);
      color: white;
      border: 1px solid rgba(255, 255, 255, .14);
    }
    .url-box code {
      overflow-wrap: anywhere;
      color: #d7fff8;
      font-size: 13px;
    }
    .download-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 18px;
      align-items: stretch;
      margin-top: 18px;
    }
    .panel,
    .phone {
      border-radius: 8px;
      background: white;
      border: 1px solid rgba(22, 51, 48, .08);
      box-shadow: 0 14px 34px rgba(22, 51, 48, .08);
    }
    .panel {
      padding: 22px;
    }
    .panel h2,
    .governance h2 {
      margin: 0;
      font-size: clamp(24px, 4vw, 38px);
      line-height: 1.18;
    }
    .panel p,
    .governance p,
    .card p,
    footer {
      color: #587069;
      line-height: 1.68;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 18px;
    }
    .metric {
      min-height: 96px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 14px;
      border-radius: 8px;
      background: #f4f8f6;
      border: 1px solid rgba(22, 51, 48, .06);
    }
    .metric strong {
      color: #173b38;
      font-size: 22px;
    }
    .metric span {
      color: #617671;
      font-size: 13px;
      font-weight: 750;
    }
    .phone {
      padding: 16px;
      background: #162326;
    }
    .screen {
      min-height: 500px;
      display: grid;
      gap: 12px;
      align-content: start;
      padding: 22px 18px;
      border-radius: 8px;
      background: #f8fcfa;
    }
    .app-card {
      min-height: 156px;
      display: grid;
      gap: 10px;
      align-content: end;
      padding: 18px;
      border-radius: 8px;
      color: white;
      background: linear-gradient(135deg, #2f8f83 0%, #4f7fcf 100%);
    }
    .app-card strong { font-size: 32px; }
    .app-card span { color: rgba(255,255,255,.88); line-height: 1.55; }
    .tile-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .tile {
      min-height: 92px;
      display: grid;
      gap: 8px;
      align-content: center;
      padding: 14px;
      border-radius: 8px;
      background: white;
      border: 1px solid rgba(22, 51, 48, .08);
    }
    .tile strong { font-size: 19px; }
    .tile span { color: #60746e; font-size: 13px; line-height: 1.45; }
    .governance {
      margin-top: 18px;
      padding: clamp(22px, 5vw, 40px);
      border-radius: 8px;
      background: #fff8ec;
      border: 1px solid rgba(213, 104, 78, .14);
    }
    .governance-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(230px, .44fr);
      gap: 18px;
      align-items: end;
    }
    .governance-badge {
      min-height: 88px;
      display: grid;
      align-content: center;
      gap: 4px;
      padding: 16px;
      border-radius: 8px;
      color: white;
      background: #d5684e;
    }
    .governance-badge strong {
      font-size: 26px;
      line-height: 1.1;
    }
    .cards {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .card {
      min-height: 150px;
      padding: 18px;
      border-radius: 8px;
      background: white;
      border: 1px solid rgba(22, 51, 48, .08);
    }
    .card strong {
      color: #173b38;
      font-size: 20px;
    }
    .card p {
      margin: 10px 0 0;
    }
    footer {
      margin-top: 24px;
      font-size: 13px;
    }
    @media (max-width: 860px) {
      main { padding: 12px 12px 34px; }
      .topbar { align-items: flex-start; }
      .topbar nav { display: none; }
      .hero {
        min-height: auto;
        padding: 28px 18px 34px;
        background:
          linear-gradient(180deg, rgba(19, 77, 69, .98) 0%, rgba(25, 95, 84, .9) 100%),
          url("${iconUrl}") right 18px top 18px / 120px no-repeat,
          #173b38;
      }
      h1 { font-size: clamp(44px, 17vw, 68px); }
      .lead { font-size: 19px; }
      .download-row { display: grid; grid-template-columns: 1fr; }
      .primary-link,
      .secondary-link { width: 100%; }
      .download-grid,
      .governance-head,
      .cards { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
      .phone { order: -1; }
      .screen { min-height: 430px; }
      .tile-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 420px) {
      .tile-grid,
      .cards { grid-template-columns: 1fr; }
      .screen { min-height: auto; }
      .app-card strong { font-size: 28px; }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <a class="brand" href="${appUrl}" aria-label="打开双休超市网页版">
        <img src="${iconUrl}" alt="">
        <span>双休超市</span>
      </a>
      <nav aria-label="下载页导航">
        <a href="#download">APK 下载</a>
        <a href="#governance">人人治理</a>
        <a href="${appUrl}">网页版商城</a>
      </nav>
    </header>
    <section class="hero">
      <div class="hero-content">
        <span class="eyebrow">双休不加班公司的产品，才配上架</span>
        <h1>双休超市</h1>
        <p class="lead">一个由用户共同治理的区块链商城。只收录承诺双休、不强制加班公司的产品。</p>
        <p class="governance-line">在这里，人人都能作为商城的管理者：发现不符合理念的商品，可以投诉、评价、投票下架，让好公司和好产品被更多人看见。</p>
        <div class="download-row">
          <a class="primary-link" href="${apkUrl}">下载 Android APK</a>
          <a class="secondary-link" href="${appUrl}">打开网页版商城</a>
        </div>
        <p class="status ${statusClass}">${escapeHtml(statusText)}</p>
        <div class="url-box">
          <strong>IPv6 APK 下载直链</strong>
          <code>${directUrl}</code>
        </div>
      </div>
    </section>
    <section id="download" class="download-grid">
      <div class="panel">
        <h2>下载双休超市 APK，参与一个尊重休息的市场</h2>
        <p>手机版适合直接浏览商品、申请店家、上架商品图片、联系交易、看直播和参与投票治理。电脑版下载页保留完整直链，方便复制给朋友或部署到更多设备。</p>
        <div class="metrics" aria-label="下载信息">
          <div class="metric"><strong>${escapeHtml(fileSize)}</strong><span>APK 文件大小</span></div>
          <div class="metric"><strong>IPv6</strong><span>发现服务器与下载入口</span></div>
          <div class="metric"><strong>中文名</strong><span>安装后显示“双休超市”</span></div>
        </div>
      </div>
      <div class="phone" aria-label="双休超市手机预览">
        <div class="screen">
          <div class="app-card">
            <strong>双休超市</strong>
            <span>商品来自双休、不加班公司；店家 ID、评价、投诉与治理记录进入私有签名账本。</span>
          </div>
          <div class="tile-grid">
            <div class="tile"><strong>入驻承诺</strong><span>店家声明双休、不强制加班。</span></div>
            <div class="tile"><strong>产品上架</strong><span>只展示符合理念的公司产品。</span></div>
            <div class="tile"><strong>链上信誉</strong><span>评价投诉不可篡改，人人可同步。</span></div>
            <div class="tile"><strong>投票治理</strong><span>不符合理念或违规商品可被下架。</span></div>
          </div>
        </div>
      </div>
    </section>
    <section id="governance" class="governance">
      <div class="governance-head">
        <div>
          <h2>人人都能作为商城的管理者</h2>
          <p>双休超市不是只靠后台管理员维护秩序。每个用户都可以用评价、投诉和投票参与治理，让商城长期围绕“双休不加班”的理念运行。</p>
        </div>
        <div class="governance-badge">
          <strong>共治商城</strong>
          <span>用户监督，账本留痕，社区下架</span>
        </div>
      </div>
      <div class="cards">
        <article class="card">
          <strong>自由上架，但有理念边界</strong>
          <p>顾客可以申请成为店家，自由上架商品；前提是所属公司承诺双休、不强制加班。</p>
        </article>
        <article class="card">
          <strong>评价投诉进入信誉账本</strong>
          <p>店家 ID 全局唯一不可删除，相关评价、投诉和治理记录进入私有签名账本，减少作假和洗白。</p>
        </article>
        <article class="card">
          <strong>投票推动商品下架</strong>
          <p>发现虚假宣传、违规商品，或公司不符合双休不加班理念，用户可以投票推动下架。</p>
        </article>
      </div>
    </section>
    <section class="cards" aria-label="商城理念">
      <article class="card">
        <strong>我的理念</strong>
        <p>市场不应该只奖励低价和速度，也应该奖励尊重休息、拒绝无意义加班的公司。</p>
      </article>
      <article class="card">
        <strong>上架边界</strong>
        <p>双休超市默认只接纳双休、不加班公司的产品。用户可以通过投诉和投票推动不符合理念的商品下架。</p>
      </article>
      <article class="card">
        <strong>可信记录</strong>
        <p>店家身份全局唯一，评价、投诉、治理下架记录进入私有签名账本，尽量减少作假和洗白。</p>
      </article>
    </section>
    <footer>
      APK 文件名保持为 two-day-weekend-marketplace.apk，方便旧链接继续工作；安装后应用显示名称为“双休超市”。
    </footer>
  </main>
</body>
</html>`;
}

function buildDocs(config) {
  return {
    service: "双休超市 discovery server",
    basePath: config.basePath,
    serverUrl: config.serverUrl,
    adminAuth: "Send X-Admin-Token for admin-only APIs.",
    endpoints: [
      "GET /health",
      "GET /api/docs",
      "GET /api/marketplace",
      "POST /api/seed",
      "POST /api/sellers/apply",
      "GET /api/sellers",
      "POST /api/sellers/{sellerId}/reviews",
      "POST /api/sellers/{sellerId}/complaints",
      "POST /api/products",
      "GET /api/products?q={search}&category={category}",
      "POST /api/products/{productId}/reports",
      "POST /api/orders",
      "POST /api/admin/products/{productId}/force-hide",
      "PUT /api/live/sessions/{sellerId}",
      "GET /api/live/sessions",
      "POST /api/signaling/rooms",
      "POST /api/signaling/rooms/{roomId}/messages",
      "GET /api/signaling/rooms/{roomId}/messages",
      "GET /api/download",
      "GET /promo",
      "GET /download/two-day-weekend-marketplace.apk",
      "GET /api/ledger/verify",
      "GET /api/ledger/events",
      "GET /api/sellers/{sellerId}/reputation",
      "GET /api/admin/ledger/events"
    ],
    ledgerScope:
      "Seller registrations, reviews, complaints, product reports, and governance actions are recorded in a signed hash chain. Product catalog rows are stored only in SQLite.",
    listingPolicy:
      "双休超市只上架双休、不加班公司的产品。入驻店家需要声明劳动友好承诺。"
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { createApp };
