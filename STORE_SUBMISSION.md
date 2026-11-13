# Marsa Wholesale: App Store and Google Play submission

What the app already does to pass review, what to fill in on each store, and what only you can provide.
Items marked **You** need an account, a document or a decision from Marsa.

## 1. Before the first submission (You)

| Item | Where | Notes |
| --- | --- | --- |
| Apple Developer Program, organization | developer.apple.com | Needs a D-U-N-S number for Marsa Import Inc (free, 1–2 weeks). $99/year. |
| Google Play Console, organization | play.google.com/console | $25 once, identity check. New personal accounts must run a 14-day closed test with 12 testers before production; an organization account avoids that. |
| **Demo account for reviewers** | App Review notes (Apple), App access (Google) | A real portal login on a test customer with a ship-to address, a few products in stock, one past order, one open invoice. Reviewers reject login-only apps without one. |
| Support email that is monitored | Both stores, and `EXPO_PUBLIC_SUPPORT_EMAIL` | The app falls back to `wholesale@itsmarsa.com`. **Confirm this inbox exists** or set the right one. |
| Privacy policy covers the app | itsmarsa.com/privacy/ | Must mention the app, the data in section 4, that nothing is sold or used for tracking, and how to request deletion. |
| Account deletion web page | Google Play "Delete account URL" | A page (or a section of the privacy policy) that says how to request deletion by email. Google requires a URL even though the app has its own deletion screen. |
| Marsa logo for the icon (optional) | `assets/icon.png` 1024×1024, no transparency | The current icon is a clean "M" monogram on Marsa green. Replace it with the official mark if you have one. |

## 2. Store listing text

- **Name:** Marsa Wholesale
- **Subtitle (Apple, 30 chars):** Wholesale fragrance ordering
- **Short description (Google, 80 chars):** Order Marsa fragrances at wholesale: your prices, live stock, barcode reorder.
- **Category:** Business (primary), Shopping (secondary)
- **Age rating:** 4+ / Everyone. No user-generated content, no chat with strangers, no gambling. Fragrance is not an age-restricted product.
- **Description:**

> Marsa Wholesale is the ordering app for stores that buy perfumes, colognes and gift sets from Marsa.
>
> • See your own wholesale prices, margin at suggested retail and live stock
> • Scan shelf barcodes to reorder in seconds, or reorder any past order in one tap
> • Save lists for your regular orders and get alerts when items are back in stock
> • Track every order from confirmed to delivered, with carrier tracking
> • See invoices and your balance, and pay by card or bank transfer
> • Request returns with photos, manage your team and your addresses
>
> For approved Marsa wholesale accounts. New stores can browse the catalog and apply in the app.

## 3. Review notes (paste into App Review Information)

> Marsa Wholesale is a business-to-business ordering app for retail stores that buy physical goods (fragrances) from Marsa Import Inc, a US distributor. Ordering requires an approved wholesale account; anyone can browse the catalog without signing in (Browse the catalog first on the welcome screen) and apply for an account.
>
> Demo account: <email> / <password>
>
> Payments are for physical goods and existing invoices, so they are handled by our processor's checkout page (guideline 3.1.3(e)/3.1.5(a)); no digital content is sold.
>
> Account deletion: Account › Delete account.
>
> The camera is used only to scan product barcodes and, optionally, to photograph damaged items for a return.

## 4. Privacy answers

Both stores ask what data the app collects. The app keeps no data of its own; everything is the customer's Marsa account.

| Data | Collected | Linked to user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Name | Yes | Yes | No | App functionality (account) |
| Email address | Yes | Yes | No | App functionality (sign-in, order emails) |
| Phone number | Optional | Yes | No | App functionality (WhatsApp updates) |
| Physical address | Yes | Yes | No | App functionality (shipping) |
| Purchase history | Yes | Yes | No | App functionality (orders, reorder) |
| User ID | Yes | Yes | No | App functionality |
| Photos | Only when attached to a return | Yes | No | App functionality (returns) |
| Payment info | **No**: entered on the processor's page, never in the app | | | |
| Location, contacts, health, browsing, advertising ID | No | | | |

- **Apple:** "Data Not Used to Track You". `NSPrivacyTracking` is false in `app.json`, and the privacy manifest declares the same data types and the required-reason APIs the Expo modules use.
- **Google Data safety:** data is encrypted in transit (HTTPS only); users can request deletion (Account › Delete account and the web URL); no data is shared with third parties for their own use.

## 5. What the app does for the store rules

| Rule | How the app meets it |
| --- | --- |
| Apple 4.2 minimum functionality; 3.2 business apps | Native screens throughout (barcode scanner, cart, orders, returns with photos), and a public catalog and apply link for stores that aren't customers yet, so it isn't a login wall or a website wrapper. |
| Apple 5.1.1(v), Google account deletion | Account › Delete account explains what is removed and sends the request. Accounts are created on the web after Marsa's approval, not in the app. **Recommended ERP follow-up:** a `POST /v1/portal/me/delete-request` route so the request lands in the ERP without an email app. |
| Apple 5.1.1 data minimization, permissions | Camera and photos are asked only when used, with plain-language reasons; audio, storage and overlay permissions are blocked on Android. |
| Apple 3.1.1 in-app purchase | Not applicable: physical goods and invoices. Payment opens the processor's secure page. |
| Privacy policy inside the app | Welcome screen and Account › Legal. |
| Apple export compliance | `ITSAppUsesNonExemptEncryption: false` (HTTPS only). |
| iPad | The app is iPhone-only (`supportsTablet: false`), so no iPad screenshots are needed. It still runs on iPad in iPhone mode. |
| Google target API level | Set by Expo SDK 58. |
| Accessibility (ADA, store guidance) | Buttons and icon buttons have spoken labels; text follows the system font size; main buttons are 48pt tall. |

## 6. Screenshots

- **Apple:** 6.9" iPhone (1320×2868) is required; 6.5" is optional. Take them from an iOS simulator build.
- **Google:** at least 2 phone screenshots, plus a 1024×500 feature graphic.
- Suggested set: Home, Catalog, Product, Scan, Cart, Order tracking, Invoices.

## 7. Build and submit

```bash
npx eas-cli@latest build --profile production --platform ios       # first time: interactive, sets up Apple signing
npx eas-cli@latest build --profile production --platform android
npx eas-cli@latest submit --platform ios      # to App Store Connect / TestFlight
npx eas-cli@latest submit --platform android  # to the Play Console internal track
```

Use TestFlight and Google internal testing with Marsa staff and two friendly stores before you submit for review.
