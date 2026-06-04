"use strict";

const crypto = require("node:crypto");

const GENESIS_HASH = "0".repeat(64);

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signHash(eventHash, secret) {
  return crypto.createHmac("sha256", secret).update(eventHash).digest("hex");
}

function computeEventHash(event) {
  return sha256(
    canonicalize({
      id: event.id,
      prevHash: event.prevHash,
      eventType: event.eventType,
      actorId: event.actorId || null,
      subjectSellerId: event.subjectSellerId || null,
      payload: event.payload || {},
      createdAt: event.createdAt
    })
  );
}

function appendLedgerEvent(db, secret, input) {
  const last = db
    .prepare("SELECT id, event_hash FROM ledger_events ORDER BY id DESC LIMIT 1")
    .get();
  const id = last ? last.id + 1 : 1;
  const prevHash = last ? last.event_hash : GENESIS_HASH;
  const createdAt = input.createdAt || new Date().toISOString();
  const payload = input.payload || {};
  const event = {
    id,
    prevHash,
    eventType: input.eventType,
    actorId: input.actorId || null,
    subjectSellerId: input.subjectSellerId || null,
    payload,
    createdAt
  };
  const eventHash = computeEventHash(event);
  const signature = signHash(eventHash, secret);

  db.prepare(
    `INSERT INTO ledger_events
      (id, prev_hash, event_hash, signature, event_type, actor_id, subject_seller_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    prevHash,
    eventHash,
    signature,
    event.eventType,
    event.actorId,
    event.subjectSellerId,
    JSON.stringify(payload),
    createdAt
  );

  return { ...event, eventHash, signature };
}

function verifyLedger(db, secret) {
  const rows = db
    .prepare("SELECT * FROM ledger_events ORDER BY id ASC")
    .all();
  let prevHash = GENESIS_HASH;
  const failures = [];

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json || "{}");
    } catch (error) {
      failures.push({ id: row.id, reason: "payload_json is not valid JSON" });
      payload = {};
    }

    if (row.prev_hash !== prevHash) {
      failures.push({
        id: row.id,
        reason: "prev_hash does not match previous event_hash"
      });
    }

    const expectedHash = computeEventHash({
      id: row.id,
      prevHash: row.prev_hash,
      eventType: row.event_type,
      actorId: row.actor_id,
      subjectSellerId: row.subject_seller_id,
      payload,
      createdAt: row.created_at
    });
    const expectedSignature = signHash(expectedHash, secret);

    if (row.event_hash !== expectedHash) {
      failures.push({ id: row.id, reason: "event_hash mismatch" });
    }
    if (row.signature !== expectedSignature) {
      failures.push({ id: row.id, reason: "signature mismatch" });
    }

    prevHash = row.event_hash;
  }

  return {
    ok: failures.length === 0,
    eventCount: rows.length,
    headHash: rows.length ? rows[rows.length - 1].event_hash : GENESIS_HASH,
    failures
  };
}

module.exports = {
  GENESIS_HASH,
  appendLedgerEvent,
  canonicalize,
  computeEventHash,
  verifyLedger
};
