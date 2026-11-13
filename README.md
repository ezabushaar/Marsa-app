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

## What's in v1

| Tab / screen | What it does |
| --- | --- |
| Sign in, reset password | Portal accounts (Owner, Buyer, Accounts). "Keep me signed in" holds the session 30 days |
| Shop | Buy again, new arrivals, brands, cart progress toward the order minimum, the customer's rep (WhatsApp, email) |
| Catalog | Search by name, brand, SKU or UPC with typo-tolerant ranking; filters by brand and in stock; sort; infinite scroll. An exact SKU or barcode jumps to the item |
| Scan to order | Scan a bottle's UPC or a case barcode, set the quantity, add it, then scan the next one |
| Product | Customer price, contract price, MSRP and margin at MSRP, live stock, minimum, pack and case size, last ordered, notes, "sells well with" |
| Cart | Quantity steppers that follow the ERP's minimum, pack and maximum rules; one-tap fixes for problem lines; minimum, freight and tax estimate |
| Checkout | Ship-to or pickup, shipping method, ACH, card or Net terms, PO number, coupon, notes. Sends a Submitted order (nothing is charged) with an idempotency key, so a double tap never places two orders |
| Orders | Tabs (open, to pay, shipped, delivered); order detail with confirmed quantities, totals, deliveries and tracking; reorder, pay, cancel and "ask for changes" |
| Invoices | Total due and aging; select invoices and pay through the ERP's hosted pay page (ACH or card) |
| Account | Billing summary, WhatsApp and new-arrival alerts, links to the web portal for quotes, returns, addresses, team and password |

Roles follow the ERP: a Buyer never sees invoices or balances, and an Accounts user sees orders and invoices but
no shop.

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
