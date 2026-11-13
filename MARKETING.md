# Marsa Wholesale: marketing and analytics system

The app measures everything first-party in Marsa ERP, then the ERP sends conversions to Google Analytics 4, Meta,
TikTok and Snapchat **from the server**. No ad SDK is inside the app, the advertising ID is never read, and no
platform access token ever ships in the app. That's the setup ad platforms now recommend (server-side or
Conversions API), it survives iOS privacy changes and ad blockers, and it keeps App Store review simple.

```
 App (iOS / Android)                     Marsa ERP                          Platforms
 ───────────────────                     ─────────                          ─────────
 track("add_to_cart", …) ──batch──▶  POST /v1/portal/events  ──┬──▶ ERP reports (funnel, searches, app vs web)
 + utm_*, fbclid, ttclid,             (portal_events table)     │
   gclid, ScCid, ad consent                                     └──▶ marketing outbox (consent = granted only)
                                     order_submitted (server) ──────▶ GA4 Measurement Protocol
                                                                     Meta Conversions API (dataset 2132146271517312)
                                                                     TikTok Events API (pixel to create)
                                                                     Snap Conversions API (pixel to create)
```

## 1. What is already built in the app

| Piece | Where | What it does |
| --- | --- | --- |
| Analytics pipe | `src/lib/analytics.ts` | `track(event, props)` batches events every 4 s (or 20 events, or when the app goes to the background) to the ERP's `portal.events.track` route, using the ERP's own event names. Each event carries `src: app`, `os`, app version, ad consent, and the campaign that opened the app. |
| Campaign capture | same | Any link that opens the app (`marsa://…` or, later, `https://wholesale.itsmarsa.com/…`) has its `utm_source/medium/campaign/content`, `ref`, `fbclid`, `ttclid`, `gclid` and `ScCid` kept for 30 days and attached to every event. |
| Ad-measurement consent | `askAdConsentOnce()`, Account › Privacy choices | iOS: Apple's tracking prompt, shown once after the store's first order is sent. Android: on by default with an opt-out. Everyone can switch it off in Privacy choices; that switch is also the "Do Not Sell or Share" opt-out US state privacy laws ask for. |
| Build switch | `EXPO_PUBLIC_AD_ATTRIBUTION=on` | Off by default. When on, `app.config.ts` declares tracking in Apple's privacy manifest (email and purchase history, Marsa's own advertising). Off: no prompt, consent is always "denied", nothing may be forwarded. |
| Review prompt | `src/app/placed/[id].tsx` | Asks for an App Store / Google Play rating after a store's 2nd order and every 10th, using the system dialog (Apple caps it at 3 a year). Ratings drive store search ranking. |
| Referral | `src/lib/referral.ts` | "Invite another store" (Account, and a Home card after 2 orders) shares `…/apply?ref=<customer number>&utm_source=app&utm_medium=referral&utm_campaign=store_invite`. |
| Tagged apply links | Welcome, sign in, public product | "Apply for wholesale" opens the web application with `utm_source=app&utm_medium=<screen>`, so the web side can tell app-driven applications apart. |

### Events the app sends

All names are the ERP's existing portal events (`PORTAL_EVENTS` in the contracts), so app and web reports line up.

| Event | When | Key facts |
| --- | --- | --- |
| `landing_view` | Welcome screen | campaign |
| `public_catalog_view` | Public catalog opened | |
| `public_apply_click` | Apply tapped | from (welcome, sign_in, product) |
| `signin_view`, `signin_ok`, `signin_fail` | Sign-in | error code |
| `search` | A search settles | q, results, fuzzy, exact |
| `product_view` | Product page | product_id, sku, brand, price_cents, stock |
| `add_to_cart` | Add from a card, scan or list | product_id or lines, qty, price/value, via, deal |
| `cart_line_change` | Quantity changed | product_id, from, to |
| `cart_view`, `cart_fix_applied` | Cart | lines, items_cents, problems |
| `checkout_view` | Checkout | lines, items_cents, quote |
| `coupon_apply` | Order sent with a coupon | code |
| `order_submit_error` | Send refused | error code, payment |
| `order_submitted` | **Recorded by the ERP** when the order lands (never from the phone) | order number, value |
| `reorder_click`, `usual_order_add`, `list_add` | Retention actions | order_id, lines |
| `notify_me` | Restock alert set | product_id |
| `ask_rep_click` | Volume quote asked | product_id, quantity |
| `invoices_view`, `checkout_redirect`, `payment_returned` | Paying | kind, amount |
| `apply_link_copied` | Referral link shared | ref, from |

## 2. ERP work to finish the system (not built yet)

The ERP already stores these events. To send them to the platforms it needs one more worker job, built like the
existing WooCommerce and email providers (outbox, retries, one send per event id):

1. **`marketing` provider** in `apps/worker`: for each `order_submitted` (and optionally `add_to_cart`,
   `checkout_view`, `public_apply_click` / `apply_submitted`), send to every platform that has keys, **only when
   the event's `ad` fact is `granted`**.
2. **Identity, hashed:** SHA-256 of the lower-cased email and E.164 phone of the person (from the session, never
   from the phone's body), plus the click ids (`fbclid` → Meta `fbc`, `ttclid`, `gclid`, `ScCid`).
3. **Dedup:** event id = the order id, so a later website pixel never double counts.
4. **Settings › Marketing** in Control: the keys below, an on/off per platform, and a test button.

| Platform | Event mapping (app → platform) | What Marsa needs to provide |
| --- | --- | --- |
| Google Analytics 4 | product_view→`view_item`, search→`search`, add_to_cart→`add_to_cart`, checkout_view→`begin_checkout`, order_submitted→`purchase`, public_apply_click→`generate_lead` | A GA4 property for wholesale; its **Measurement ID** and a **Measurement Protocol API secret** (Admin › Data streams). |
| Meta | ViewContent, Search, AddToCart, InitiateCheckout, **Purchase**, Lead | Dataset **2132146271517312** ("Itsmarsa webiste", already live on the website with server events) under ad account MARSA IMPORT INC (2334291403744031). A **Conversions API access token** from Events Manager › Settings. Optional: a separate dataset for wholesale to keep wholesale and retail audiences apart. |
| TikTok | ViewContent, Search, AddToCart, InitiateCheckout, **PlaceAnOrder**, SubmitForm | No pixel exists yet on ad account 7658724101791514641. Create an Events API pixel in TikTok Events Manager, then generate its **access token**. |
| Snapchat | VIEW_CONTENT, SEARCH, ADD_CART, START_CHECKOUT, **PURCHASE**, SIGN_UP | The only connected Snap ad account belongs to a Saudi business (مصدر العود والعطور) and has no pixel. Create a Marsa US Snap ad account and pixel, then a **Conversions API token**. |

Keys live only in the ERP's environment (`MARKETING_*`), never in the app or the repo.

## 3. Campaign links (use these in every ad, email, WhatsApp and QR code)

Format: `https://wholesale.itsmarsa.com/<page>?utm_source=<where>&utm_medium=<type>&utm_campaign=<name>`

| Channel | utm_source | utm_medium | Example utm_campaign |
| --- | --- | --- | --- |
| Meta ads | facebook / instagram | paid_social | app_launch_2026 |
| TikTok ads | tiktok | paid_social | hawas_ice_drop |
| Snapchat ads | snapchat | paid_social | |
| Google ads | google | cpc | |
| WhatsApp broadcast | whatsapp | message | restock_week46 |
| Email | email | newsletter | |
| Rep visit QR code | rep | qr | rep_<firstname> |
| Store referral | app | referral | store_invite (with ref=<customer number>) |

Lower case, underscores, no spaces. Until universal links are on (below), these open the web portal; the app
picks campaign fields up from `marsa://` links today.

## 4. Next marketing features (in order of payoff)

1. **Push notifications.** The biggest lever for a reorder business: "Hawas Ice Freeze is back", "Your order
   shipped", "Invoice due Friday". Needs the ERP device-token table and an Expo push sender in the worker (plan
   doc, Phase 0). The app side is a day's work once the ERP route exists.
2. **Universal links.** Host `apple-app-site-association` and `assetlinks.json` on wholesale.itsmarsa.com, and
   add `associatedDomains` and intent filters, so campaign and email links open the app when it's installed.
3. **Server-side forwarding** (section 2).
4. **In-app promo banner** driven by ERP promotions (W4 coupons), with its own campaign tag.
5. **Store page optimization:** keywords "wholesale perfume", "fragrance distributor", "Arabic perfume
   wholesale"; screenshots with captions; ask happy stores for ratings during rep visits.

## 5. Store disclosures when ad attribution is turned on

Turning on `EXPO_PUBLIC_AD_ATTRIBUTION` changes what Apple and Google must be told **before** that build is
submitted:

- **App Store privacy:** Email address and Purchase history become "Used to Track You" (third-party advertising
  measurement). The privacy manifest already flips with the switch.
- **Google Play Data safety:** "Data shared" → Email address and Purchase history, purpose "Advertising or
  marketing"; users can request deletion and opt out (Privacy choices).
- **Privacy policy:** name the ad platforms, say data is hashed, and link the opt-out (Account › Privacy choices).
- Leave the switch **off** for the first App Store submission; turn it on in an update once the ERP forwarding
  is live. That keeps the first review simple.
