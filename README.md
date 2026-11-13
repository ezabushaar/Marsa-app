# Marsa Wholesale

The iOS and Android app for Marsa's wholesale customers: retailers sign in, shop the catalog at their own prices,
scan barcodes to reorder, send orders, follow deliveries and pay invoices.

It is a native client of **Marsa ERP's wholesale portal API** (`/v1/portal/*`, the same API as
wholesale.itsmarsa.com). There is no separate backend: prices, stock, minimums, carts, orders and invoices all come
from the ERP, under the same rules the web portal follows.

## Stack

- Expo SDK 58, React Native 0.88, TypeScript
- Expo Router (file routes in `src/app`), TanStack Query
- `expo-camera` for barcode scanning, `expo-web-browser` for hosted payment pages
- `vendor/contracts`: the ERP's portal route contracts (zod schemas and the typed client), copied by
  `scripts/sync-contracts.mjs`, so every request and answer is typed exactly as the API defines it

## What's in the app

Navigation follows the plan doc ("Marsa Wholesale App — Full Plan"): five tabs with Scan always one tap away.

| Area | What it does |
| --- | --- |
| Welcome (signed out) | What the app is, top sellers, the public catalog without prices, sign in, apply for wholesale, privacy and terms |
| **Home** | Balance due with Pay, cart progress to the minimum and free freight, order again (last 3 orders), your usual order in one tap, clearance deals, back in stock, buy again, new arrivals, brands, your rep (WhatsApp, email) |
| **Shop** | Search by name, brand, SKU or UPC (typo-tolerant), filters by category, brand and stock, sorts, infinite scroll; an exact barcode jumps to the item |
| **Scan** (center) | Scan a whole shelf: each UPC or case barcode adds a line (again adds a pack), review, add all to cart; type a code when a label won't scan |
| Product | Gallery, your price, contract price, margin at MSRP, case price, stock, quantity rules, last ordered, save to a list, volume quote request, restock alert, share photos, sells well with |
| Cart and checkout | ERP quantity rules, one-tap fixes, minimum and free-freight progress, save as a list; ship-to or pickup, shipping method, ACH, card or Net terms, PO, coupon; accepting a quote uses the same checkout |
| **Orders** | Orders by status and Quotes; order detail with confirmed quantities, totals, tracking, reorder, pay, cancel, ask for changes, start a return |
| **Account** | Invoices and pay, store credit, saved lists, restock alerts, deals, returns, business details and change requests, addresses, team and invites, notifications (WhatsApp, email), password, help, privacy, terms, delete account |

Roles follow the ERP: a Buyer never sees invoices or balances, and an Accounts user sees orders and invoices but no shop.

Store review readiness (privacy manifest, permissions, deletion, review notes, data-safety answers) is in
[STORE_SUBMISSION.md](STORE_SUBMISSION.md).

## Run it

```bash
npm install
cp .env.example .env          # points at https://wholesale.itsmarsa.com by default
npx expo start                # then open on a device with a development build (see below)
```

`expo-camera` is a native module, so use a development build rather than Expo Go:

```bash
npx eas-cli@latest build --profile development --platform ios     # or android
```

Against a local ERP (`pnpm --filter @marsa/api dev` in marsa-erp), use your computer's LAN address and plain HTTP:

```
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
EXPO_PUBLIC_PORTAL_ORIGIN=http://localhost:5174
```

and start the API with `COOKIE_SECURE=false`.

## Checks

```bash
npm run typecheck
npm test
npx expo export --platform ios --platform android   # bundles both apps
```

## Keeping the contracts in step with the ERP

When the ERP's portal routes change, sync them and typecheck. The compiler then flags every screen that
needs an update.

```bash
npm run sync:contracts -- ../marsa-erp
npm run typecheck
```

## How sign-in works (and an ERP follow-up)

The portal API authenticates with the `marsa_portal` cookie. The phone's native networking stores it (iOS
`NSHTTPCookieStorage`, Android's cookie jar), and the app sends the portal's `Origin` header on each request so
that cookie-signed writes pass the API's `PORTAL_ORIGINS` check. This needs no ERP change.

For the long term, a mobile session token would be cleaner: a portal sign-in that returns a token the app keeps in
`expo-secure-store` and sends as `Authorization: Bearer`. That's a small, security-reviewed change in
`apps/api/src/portalAuth.ts`. Push notifications for order and invoice updates would also need an ERP endpoint to
register device tokens.
