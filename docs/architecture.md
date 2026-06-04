# Architecture

## Product Scope

The application is a mobile marketplace with blockchain-style merchant reputation.

In scope:

- Customer browsing, search, cart, orders, seller contact records.
- Free seller application with globally unique brand IDs.
- Seller center for listing and managing products.
- Product reports and dual-anchor governance actions that can force products offline.
- Admin forced delisting.
- Merchant reputation ledger containing seller identity, reviews, complaints, and governance events.
- Merchant live rooms: the server indexes the room and signaling metadata; media should be peer-to-peer when possible.
- APK download page hosted under the marketplace base path.

Out of scope for this first build:

- Real payment, custody, escrow, or public-chain cryptocurrency settlement.
- Public-chain gas/wallet integrations.
- Server-side live media relay as the default path.

## Key Decisions

- Product data is not ledger data. It is ordinary mutable database state.
- Seller ID is a personal brand identifier. It is globally unique, cannot be reused, and cannot be deleted.
- Ledger entries are append-only and chained by hash. Reputation clients can export/sync/verify the chain.
- Reputation governance uses dual-anchor consensus: account count and account age do not create power. Only verified completed-order reviews or responsibility anchors such as stake/witness quorum can affect core reputation.
- Live streaming discovery is centralized, while media transport is direct WebRTC when the network allows it.
- The Android app uses a native WebView shell around the shared mobile web app to deliver quickly while keeping camera/audio permissions under app control.

## Dual-Anchor Reputation Consensus

Every visible review, complaint, and removal request leaves records in both the actor history and the target history. Plain comments remain visible, but their governance weight is zero. Core reputation changes require at least one anchor:

- Trade anchor: the actor has a completed order for the reviewed product or merchant.
- Responsibility anchor: the actor stakes reputation/deposit or receives enough witness signatures.

New accounts, aged accounts, and mass-registered accounts have no governance weight by themselves. Ten thousand empty accounts still add up to zero. Repeated malicious complaints reduce the actor's future weight and can zero it entirely.

## Ledger Event Types

- `seller.registered`
- `seller.reviewed`
- `seller.complained`
- `product.vote.delist`
- `product.force_delisted`
- `governance.vote_threshold_changed`

Each entry stores:

- monotonically increasing index
- timestamp
- event type
- actor ID
- target ID
- canonical JSON payload
- previous hash
- event hash
- server signature

## Live Streaming

The server should not carry the live video stream. It stores room presence, broadcaster metadata, and short-lived signaling messages. The app attempts direct WebRTC connections from viewers to the merchant. For many viewers, the practical scaling limit is the merchant uplink; the first production upgrade should be SFU support, but the initial implementation keeps media off the server as requested.

## Deployment Shape

One Ubuntu host runs:

- Node service on localhost, for example `127.0.0.1:8787`
- Caddy/nginx reverse proxy at `/shc-20260520-a1faaf/weekend-marketplace/`
- static web app and download directory
- SQLite data directory with backups
