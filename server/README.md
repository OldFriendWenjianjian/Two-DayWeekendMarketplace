# 双休超市 Server

Node.js discovery server for a lightweight marketplace. 双休超市只上架双休、不加班公司的产品，入驻店家需要声明劳动友好承诺。The service is mounted at:

```text
/shc-20260520-a1faaf/weekend-marketplace/
```

Expected public URL:

```text
http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/
```

## Features

- SQLite-backed sellers, products, orders, reports, reviews, complaints, live sessions, and signaling messages.
- Product catalog data stays in the database and is not written to the ledger.
- Seller identity is globally unique and intentionally has no delete API.
- Signed private reputation ledger for seller registrations, reviews, complaints, product reports, and governance actions.
- Ledger hash chain verification with HMAC signatures using `LEDGER_SECRET`.
- Product report voting with automatic hiding once `REPORT_THRESHOLD` is reached.
- Admin force-hide API.
- Live discovery endpoint for seller room/IP/candidate metadata.
- Lightweight WebRTC signaling message mailbox. Media streams are peer-to-peer and do not pass through the server.
- APK download page/API at `/download/two-day-weekend-marketplace.apk`.
- Health check, seed data, and JSON API documentation.

## Requirements

- Node.js 22.5 or newer. This implementation uses `node:sqlite`.

## Run

```powershell
cd server
npm install
npm run seed
npm start
```

Useful environment variables:

```text
PORT=3000
HOST=::
BASE_PATH=/shc-20260520-a1faaf/weekend-marketplace/
SERVER_URL=http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/
DB_PATH=./data/marketplace.sqlite
ADMIN_TOKEN=dev-admin-token
LEDGER_SECRET=replace-with-a-private-secret
REPORT_THRESHOLD=3
APK_PATH=./public/download/two-day-weekend-marketplace.apk
```

Admin endpoints require:

```text
X-Admin-Token: dev-admin-token
```

## Core Endpoints

- `GET /shc-20260520-a1faaf/weekend-marketplace/health`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/docs`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/marketplace`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/seed`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/sellers/apply`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/sellers`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/sellers/{sellerId}/reviews`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/sellers/{sellerId}/complaints`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/products`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/products`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/products?q=coffee&category=food`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/products/{productId}/reports`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/orders`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/admin/products/{productId}/force-hide`
- `PUT /shc-20260520-a1faaf/weekend-marketplace/api/live/sessions/{sellerId}`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/live/sessions`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/signaling/rooms`
- `POST /shc-20260520-a1faaf/weekend-marketplace/api/signaling/rooms/{roomId}/messages`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/signaling/rooms/{roomId}/messages`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/download`
- `GET /shc-20260520-a1faaf/weekend-marketplace/download/two-day-weekend-marketplace.apk`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/ledger/verify`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/ledger/events`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/sellers/{sellerId}/reputation`
- `GET /shc-20260520-a1faaf/weekend-marketplace/api/admin/ledger/events`

## Ledger Notes

Each ledger row stores:

- sequence id
- previous event hash
- event hash
- HMAC signature
- event type
- actor id
- subject seller id
- event payload
- timestamp

`GET /api/ledger/verify` recomputes the whole chain and validates both hashes and signatures. Keep `LEDGER_SECRET` private and stable for a deployment. Rotating it will make historical signatures fail verification unless a rotation scheme is added.

## APK Download

Place the APK at:

```text
server/public/download/two-day-weekend-marketplace.apk
```

or set `APK_PATH`. Until the file exists, the download route returns a JSON `404` with the expected path instead of serving a fake APK.

## Self Test

```powershell
cd server
npm install
npm run selftest
```

The self test uses a temporary SQLite database and covers health, seed data, seller uniqueness, products, orders, reports with automatic hiding, reviews, complaints, live discovery, signaling, admin hiding, download metadata, and ledger verification.
