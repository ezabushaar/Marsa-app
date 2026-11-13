/**
 * Where the app reaches Marsa ERP. The portal API lives on the wholesale portal's host (it serves `/v1`), so the
 * `marsa_portal` session cookie the API sets is the same one the web portal uses.
 *
 * Set them in `.env` (see `.env.example`) or as EAS build environment variables.
 */
const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const API_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL || "https://wholesale.itsmarsa.com");

/**
 * The API refuses a portal write carrying the session cookie unless its Origin is in PORTAL_ORIGINS (CSRF rule for
 * browsers). A native app has no origin of its own, so it sends the portal's.
 */
export const PORTAL_ORIGIN = trimSlash(process.env.EXPO_PUBLIC_PORTAL_ORIGIN || API_URL);

/** The web portal, for the few things the app hands over to it (a new wholesale application). */
export const PORTAL_URL = trimSlash(process.env.EXPO_PUBLIC_PORTAL_URL || "https://wholesale.itsmarsa.com");

/** Marsa's published policies (App Store and Google Play require a privacy policy link inside the app). */
export const LEGAL = {
  privacy: "https://itsmarsa.com/privacy/",
  terms: "https://itsmarsa.com/terms-and-conditions/",
  shipping: "https://itsmarsa.com/shipping-policy/",
  returns: "https://itsmarsa.com/refund_returns/",
} as const;

/** Where account-deletion and support requests go when the customer has no rep. */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || "wholesale@itsmarsa.com";

/** A product photo or logo path from the API ("/v1/images/…") as a full URL. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
