"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../src/app");

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tdwm-server-"));
  const apkPath = path.join(tempDir, "two-day-weekend-marketplace.apk");
  fs.writeFileSync(apkPath, Buffer.from("selftest apk bytes"));
  const adminToken = "selftest-admin-token";
  const basePath = "/shc-20260520-a1faaf/weekend-marketplace/";
  const app = createApp({
    dbPath: path.join(tempDir, "marketplace.sqlite"),
    basePath,
    serverUrl: `http://127.0.0.1:0${basePath}`,
    adminToken,
    ledgerSecret: "selftest-ledger-secret",
    reportThreshold: 2,
    apkPath
  });

  const server = http.createServer(app);
  await listen(server);
  const port = server.address().port;
  const root = `http://127.0.0.1:${port}${basePath}`;

  try {
    let response = await request(root + "health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.ledger.ok, true);

    response = await request(root + "api/seed", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken }
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.ledgerEvents, 2);

    response = await request(root + "api/marketplace");
    assert.equal(response.status, 200);
    assert.ok(response.body.products.length >= 2);
    assert.ok(response.body.stores.length >= 2);

    response = await request(root + "api/sellers/apply", {
      method: "POST",
      body: {
        sellerId: "artisan-lab",
        brandName: "Artisan Lab",
        ownerContact: "wechat:artisan-lab",
        profile: { city: "Suzhou" }
      }
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.sellerId, "artisan-lab");

    response = await request(root + "api/sellers/apply", {
      method: "POST",
      body: {
        sellerId: "artisan-lab",
        brandName: "Duplicate",
        ownerContact: "wechat:duplicate"
      }
    });
    assert.equal(response.status, 409);

    const productImages = [
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "https://example.test/weekend-soap.png"
    ];

    response = await request(root + "api/products", {
      method: "POST",
      body: {
        sellerId: "artisan-lab",
        title: "Weekend Handmade Soap",
        description: "Small batch soap.",
        category: "beauty",
        priceCents: 3900,
        contact: "wechat:artisan-lab",
        images: productImages
      }
    });
    assert.equal(response.status, 201);
    const productId = response.body.productId;
    assert.equal(response.body.category, "beauty");
    assert.deepEqual(response.body.images, productImages);

    response = await request(root + "api/products?q=soap&category=beauty");
    assert.equal(response.status, 200);
    assert.equal(response.body.products.length, 1);
    assert.deepEqual(response.body.products[0].images, productImages);

    response = await request(root + "api/marketplace");
    assert.equal(response.status, 200);
    const frontendProduct = response.body.products.find((product) => product.id === productId);
    assert.ok(frontendProduct);
    assert.equal(frontendProduct.image, productImages[0]);
    assert.deepEqual(frontendProduct.images, productImages);

    response = await request(root + "api/orders", {
      method: "POST",
      body: {
        productId,
        buyerContact: "wechat:buyer-001",
        buyerMessage: "Please reserve one."
      }
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.sellerContact, "wechat:artisan-lab");

    for (const reporterKey of ["buyer-a", "buyer-b"]) {
      response = await request(root + `api/products/${productId}/reports`, {
        method: "POST",
        body: { reporterKey, reason: "suspected counterfeit listing" }
      });
      assert.equal(response.status, 201);
    }
    assert.equal(response.body.autoHidden, true);
    assert.equal(response.body.product.status, "hidden");

    response = await request(root + "api/products");
    assert.equal(response.status, 200);
    assert.equal(
      response.body.products.some((product) => product.productId === productId),
      false
    );

    response = await request(root + "api/sellers/artisan-lab/reviews", {
      method: "POST",
      body: {
        reviewerKey: "buyer-001",
        productId,
        rating: 5,
        comment: "Fast contact."
      }
    });
    assert.equal(response.status, 201);

    response = await request(root + "api/sellers/artisan-lab/complaints", {
      method: "POST",
      body: {
        complainantKey: "buyer-002",
        productId,
        reason: "Contact was unavailable."
      }
    });
    assert.equal(response.status, 201);

    response = await request(root + "api/live/sessions/artisan-lab", {
      method: "PUT",
      body: {
        roomId: "artisan-room",
        endpoint: { ip: "203.0.113.12", port: 3478 },
        candidates: [{ candidate: "candidate:example" }],
        metadata: { title: "Weekend live" }
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.roomId, "artisan-room");

    response = await request(root + "api/signaling/rooms/artisan-room/messages", {
      method: "POST",
      body: {
        fromPeer: "viewer-1",
        toPeer: "seller",
        type: "offer",
        payload: { sdp: "fake-sdp" }
      }
    });
    assert.equal(response.status, 201);

    response = await request(root + "api/signaling/rooms/artisan-room/messages?peer=seller");
    assert.equal(response.status, 200);
    assert.equal(response.body.messages.length, 1);

    response = await request(root + "api/admin/products/prod-weekend-roaster-001/force-hide", {
      method: "POST",
      headers: { "X-Admin-Token": adminToken },
      body: { reason: "seed admin smoke test" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "admin_removed");

    response = await request(root + "api/ledger/verify");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.ok(response.body.eventCount >= 8);

    response = await request(root + "api/ledger/events?afterId=0&limit=3");
    assert.equal(response.status, 200);
    assert.equal(response.body.verify.ok, true);
    assert.equal(response.body.events.length, 3);

    response = await request(root + "api/sellers/artisan-lab/reputation");
    assert.equal(response.status, 200);
    assert.equal(response.body.metrics.reviewCount, 1);
    assert.equal(response.body.metrics.complaintCount, 1);
    assert.equal(response.body.ledgerVerify.ok, true);

    response = await request(root + "api/download");
    assert.equal(response.status, 200);
    assert.equal(response.body.downloadUrl, `${basePath}download/two-day-weekend-marketplace.apk`);
    assert.match(response.body.absoluteDownloadUrl, /two-day-weekend-marketplace\.apk$/);
    assert.match(response.body.policy, /双休.*不加班/);

    response = await request(root + "download", {
      parseJson: false
    });
    assert.equal(response.status, 200);
    assert.match(response.body, /双休超市/);
    assert.match(response.body, /双休不加班公司的产品/);
    assert.match(response.body, /人人都能作为商城的管理者/);
    assert.match(response.body, /投票推动商品下架/);
    assert.match(response.body, /two-day-weekend-marketplace\.apk/);

    response = await request(root + "download/two-day-weekend-marketplace.apk", {
      parseJson: false
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "selftest apk bytes");

    app.locals.db
      .prepare("UPDATE ledger_events SET payload_json = ? WHERE id = 1")
      .run(JSON.stringify({ tampered: true }));
    response = await request(root + "api/ledger/verify");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.ok(response.body.failures.length >= 1);

    console.log("selftest ok");
  } finally {
    await close(server);
    app.locals.db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body
  });
  const text = await response.text();
  if (options.parseJson === false) {
    return { status: response.status, body: text };
  }
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
