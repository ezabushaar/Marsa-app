/**
 * The wholesale portal's identity model (docs/phases/phase-5-design.md §3.1), shared by the API guard, the core
 * portal services and the portal app. Portal users are a customer's people, separate from staff: their own
 * table, session cookie, origin list and guard branch. A portal route declares `{ portal: <capability> }` (or
 * `public`); the guard resolves `req.portal` and refuses a missing capability `403 portal_forbidden`.
 */

export const PORTAL_ROLES = ["owner", "buyer", "accounts"] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

/** shop: catalog, cart, orders, quotes, lists, returns. pay: invoices, statement, pay, credit, tax, methods,
 * accept terms. team: people, addresses, account change requests. */
export const PORTAL_CAPABILITIES = ["shop", "pay", "team"] as const;
export type PortalCapability = (typeof PORTAL_CAPABILITIES)[number];

/** What a portal route declares: one capability, or `any` for every signed-in portal user (me, password). */
export type PortalAccess = PortalCapability | "any";

/**
 * Owner: shop, pay, team. Buyer: shop ("orders; can't see invoices": order pages show lines and totals, never
 * invoices, balances, pay or credit). Accounts: pay (and order pages read-only).
 */
export const PORTAL_ROLE_CAPS: Readonly<Record<PortalRole, readonly PortalCapability[]>> = {
  owner: ["shop", "pay", "team"],
  buyer: ["shop"],
  accounts: ["pay"],
};

/** What the portal guard resolves for a request (`req.portal`): the customer comes only from the session. */
export interface PortalPrincipal {
  userId: string;
  customerId: string;
  role: PortalRole;
  caps: readonly PortalCapability[];
}

/** The portal session cookie: httpOnly, Secure, SameSite=Lax, host-only on the portal host. */
export const PORTAL_SESSION_COOKIE = "marsa_portal";

export function portalCapsOf(role: PortalRole): readonly PortalCapability[] {
  return PORTAL_ROLE_CAPS[role];
}

/** True when the principal may use a route declaring this access. */
export function portalAllows(principal: Pick<PortalPrincipal, "caps">, access: PortalAccess): boolean {
  return access === "any" || principal.caps.includes(access);
}

/**
 * UX S6 (ACC-2, D1414): the email categories a portal user can turn off. Account, password, invitation, pay links
 * staff send and "pay to ship" always go: they are the business itself, not notifications.
 */
/** Avara wave E (D1836): the appearance a portal person may save (the switcher's three choices). */
export const PORTAL_THEMES = ["system", "light", "dark"] as const;
export type PortalTheme = (typeof PORTAL_THEMES)[number];

export const PORTAL_EMAIL_CATEGORIES = ["orders", "billing", "cart"] as const;
export type PortalEmailCategory = (typeof PORTAL_EMAIL_CATEGORIES)[number];
export const PORTAL_EMAIL_CATEGORY_LABELS: Record<PortalEmailCategory, { label: string; about: string }> = {
  orders: { label: "Order updates", about: "Order received, confirmed and shipped with tracking." },
  billing: {
    label: "Invoices and payment reminders",
    about: "New invoices, receipts and due-date reminders.",
  },
  cart: { label: "Cart reminders", about: "One email when items wait in your cart for a day." },
};

/** UX S6 (PUB-5, ACC-7): the US states (and DC) by their two letters, for the state pickers and the server check. */
export const US_STATES: readonly { code: string; name: string }[] = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
].map(([code, name]) => ({ code: code as string, name: name as string }));
export const isUsState = (code: string) => US_STATES.some((s) => s.code === code);
