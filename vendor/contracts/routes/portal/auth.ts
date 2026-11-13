import { z } from "zod";
import { type RouteContract, day, isoTime, route, uuid } from "../../http.js";
import { PORTAL_CAPABILITIES, PORTAL_EMAIL_CATEGORIES, PORTAL_ROLES, PORTAL_THEMES } from "../../portal.js";
import { email, password } from "../auth.js";

/**
 * The portal's public side and its session (docs/phases/phase-5-design.md §3.1, §3.2): wholesale applications
 * (saved under a resume link, no password at application, §9 question 4), sign-in, password links and the
 * signed-in person. Slice 5 `p5-portal-identity`.
 *
 * Sign-in sets the `marsa_portal` cookie (httpOnly, Secure, SameSite=Lax, host-only on the portal host); portal
 * routes never take a Bearer token. The three routes that sign someone in (login, set-password, reset confirm)
 * take no Idempotency-Key: a replay would have to store the session token, and each is safe to retry (another
 * sign-in; a single-use link). Every other portal write takes one (§3.2).
 *
 * Not here: `GET public/brands`, `public/catalog` and `POST alerts/stop/:token` are the catalog's and the
 * follows' (slice 6), declared `{ public: true }` in `shop.ts`.
 */

// ── The signed-in person ────────────────────────────────────────────────

export const portalUserView = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  /** E.164, for WhatsApp. */
  phone: z.string().nullable(),
  role: z.enum(PORTAL_ROLES),
  whatsappUpdates: z.boolean(),
  newArrivalsAlerts: z.boolean(),
  /** UX S6 (ACC-2, D1414): the email categories this person turned off; empty means all on. */
  emailOff: z.array(z.enum(PORTAL_EMAIL_CATEGORIES)),
  /**
   * Avara wave E (D1836): the colour theme this person chose (System · Light · Dark); null until they choose
   * one, so a browser's own copy stands. A saved choice follows them to every browser they sign in on.
   */
  theme: z.enum(PORTAL_THEMES).nullable(),
});

export const portalMe = z.object({
  user: portalUserView,
  /** The customer the session belongs to, by its trading name and number (never the price list). */
  customer: z.object({ number: z.string(), name: z.string() }),
  caps: z.array(z.enum(PORTAL_CAPABILITIES)),
  /** When this session ends (12 hours, or 30 days with "keep me signed in"). */
  expiresAt: isoTime,
});

const linkToken = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "That link isn't valid");

/** A phone as typed ("(317) 555-0123" or "+13175550123"); the service keeps it as E.164. */
const phoneInput = z.string().trim().max(40);

export const login = route({
  id: "portal.auth.login",
  method: "POST",
  path: "/v1/portal/auth/login",
  access: { public: true },
  body: z.object({ email, password, keepSignedIn: z.boolean().optional() }).strict(),
  response: portalMe,
});

/** Works without a session: an absent or already revoked session still answers 204. */
export const logout = route({
  id: "portal.auth.logout",
  method: "POST",
  path: "/v1/portal/auth/logout",
  access: { public: true },
  idempotency: "optional",
  noContent: true,
});

/** Always 202 with the same body, whether or not the account exists; sent only to active accounts. */
export const requestPasswordReset = route({
  id: "portal.auth.password_reset.request",
  method: "POST",
  path: "/v1/portal/auth/password-reset/request",
  access: { public: true },
  status: 202,
  body: z.object({ email: z.string().trim().min(1).max(254) }).strict(),
  response: z.object({ accepted: z.literal(true) }),
});

/** Sets a new password from a reset link (1 hour, single use) and signs in; every other session ends. */
export const confirmPasswordReset = route({
  id: "portal.auth.password_reset.confirm",
  method: "POST",
  path: "/v1/portal/auth/password-reset/confirm",
  access: { public: true },
  body: z.object({ token: linkToken, newPassword: password }).strict(),
  response: portalMe,
});

/**
 * The first password, from a welcome (approval) or invite link (7 days, single use), with the WhatsApp number
 * and the opt-ins (WLogin "First sign-in after approval"); signs in.
 */
export const setPassword = route({
  id: "portal.auth.set_password",
  method: "POST",
  path: "/v1/portal/auth/set-password",
  access: { public: true },
  body: z
    .object({
      token: linkToken,
      password,
      phone: phoneInput.nullable().optional(),
      whatsappUpdates: z.boolean().optional(),
      newArrivalsAlerts: z.boolean().optional(),
    })
    .strict(),
  response: portalMe,
});

/** What a link is for, so its page can greet the person ("Welcome, Red Eye Smoke Shop"); 400 token_invalid. */
export const tokenInfo = route({
  id: "portal.auth.token",
  method: "GET",
  path: "/v1/portal/auth/token/:token",
  access: { public: true },
  params: z.object({ token: linkToken }),
  response: z.object({
    purpose: z.enum(["welcome", "invite", "reset"]),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    customerName: z.string(),
    expiresAt: isoTime,
  }),
});

export const me = route({
  id: "portal.me",
  method: "GET",
  path: "/v1/portal/me",
  access: { portal: "any" },
  response: portalMe,
});

/** Change own password. A wrong current password counts toward the lockout; other sessions end. */
export const changePassword = route({
  id: "portal.password.change",
  method: "POST",
  path: "/v1/portal/password",
  access: { portal: "any" },
  idempotency: "optional",
  body: z.object({ currentPassword: password, newPassword: password }).strict(),
  noContent: true,
});

/**
 * UX S6 (ACC-2, D1414): Account › Notifications saves. Each person sets their own WhatsApp number and opt-in, new
 * arrivals and restock alerts, and which email categories they get (account and security emails always go).
 * WhatsApp updates need a number. Answers the person as now saved.
 */
export const updateNotifications = route({
  id: "portal.me.notifications",
  method: "PATCH",
  path: "/v1/portal/me/notifications",
  access: { portal: "any" },
  idempotency: "optional",
  body: z
    .object({
      phone: phoneInput.nullable().optional(),
      whatsappUpdates: z.boolean().optional(),
      newArrivalsAlerts: z.boolean().optional(),
      emailOff: z.array(z.enum(PORTAL_EMAIL_CATEGORIES)).max(PORTAL_EMAIL_CATEGORIES.length).optional(),
    })
    .strict(),
  response: portalUserView,
});

/**
 * Avara wave E (D1836): the person's own appearance preference, a sibling of the notification settings so each
 * save carries only what changed. `theme: null` forgets the saved choice (every browser keeps its own again).
 * Answers the person as now saved.
 */
export const updatePreferences = route({
  id: "portal.me.preferences",
  method: "PATCH",
  path: "/v1/portal/me/preferences",
  access: { portal: "any" },
  idempotency: "optional",
  body: z.object({ theme: z.enum(PORTAL_THEMES).nullable() }).strict(),
  response: portalUserView,
});

/**
 * UX S6 (ACC-1, D1413): the "Stop these emails" link of an automatic email (an abandoned-cart reminder). The page
 * waits for a press, so a mail scanner opening the link never unsubscribes anyone; the person can turn it back on
 * in Account › Notifications.
 */
export const unsubscribeEmail = route({
  id: "portal.email.unsubscribe",
  method: "POST",
  path: "/v1/portal/email/unsubscribe/:token",
  access: { public: true },
  idempotency: "optional",
  params: z.object({
    token: z
      .string()
      .min(20)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
  body: z.object({}).strict().optional(),
  response: z.object({ stopped: z.literal(true), category: z.enum(PORTAL_EMAIL_CATEGORIES) }),
});

// ── Wholesale applications (WApply, WAppStatus) ─────────────────────────

export const APPLICATION_STATUSES = ["draft", "under_review", "needs_fix", "approved", "declined"] as const;
/** WApply "Business type". */
export const BUSINESS_TYPES = [
  "smoke_shop",
  "convenience_store",
  "perfume_or_beauty",
  "gas_station",
  "online_shop",
  "other",
] as const;
/** WApply "Typical monthly order". */
export const MONTHLY_BANDS = ["under_500", "500_2000", "2000_5000", "5000_15000", "15000_plus"] as const;

/** What an applicant fills in; everything can be saved part-way (progress is saved) and checked at submit. */
export const applicationFields = z
  .object({
    contactName: z.string().trim().min(1, "Enter your name").max(200),
    contactEmail: email,
    whatsappPhone: phoneInput,
    storeName: z.string().trim().min(1, "Enter the store name").max(200),
    legalName: z.string().trim().max(200).nullable(),
    businessType: z.enum(BUSINESS_TYPES),
    monthlyBand: z.enum(MONTHLY_BANDS),
    /** Federal EIN, 9 digits ("12-3456789" is fine). */
    ein: z.string().trim().max(20),
    /** UX audit PUB-6 (D1644): a state tax ID or seller's permit number, apart from the EIN; letters, digits, dashes. */
    stateTaxId: z.string().trim().max(40),
    line1: z.string().trim().max(200),
    line2: z.string().trim().max(200).nullable(),
    city: z.string().trim().max(100),
    /** UX S6 (PUB-5): a US state's two letters from the list (`US_STATES`); the server checks it too. */
    state: z.string().trim().max(2),
    postalCode: z.string().trim().max(12),
    locations: z.number().int().min(1).max(10_000),
  })
  .partial()
  .strict();

/** The applicant's own view (the status page and the form); never the decision staff record. */
export const portalApplication = z.object({
  status: z.enum(APPLICATION_STATUSES),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  whatsappPhone: z.string().nullable(),
  storeName: z.string().nullable(),
  legalName: z.string().nullable(),
  businessType: z.string().nullable(),
  monthlyBand: z.string().nullable(),
  /** The last 4 digits of the EIN given; the whole number is never sent back. */
  einLast4: z.string().nullable(),
  /** The last 4 characters of the state tax ID / seller's permit given (PUB-6, D1644). */
  stateTaxIdLast4: z.string().nullable().default(null),
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  locations: z.number().int().nullable(),
  certificate: z
    .object({ name: z.string(), contentType: z.string(), sizeBytes: z.number().int(), uploadedAt: isoTime })
    .nullable(),
  /** Fields still needed before it can be sent (WApply's required fields). */
  missing: z.array(z.string()),
  submittedAt: isoTime.nullable(),
  /** "Expected answer by" (1 business day after it was sent). */
  expectedBy: day.nullable(),
  /** What to fix (needs_fix) or why it was declined. */
  note: z.string().nullable(),
  /** The rep, once approved ("your rep is Ez Shaar"). */
  repName: z.string().nullable(),
});

const applicationToken = z.object({ token: linkToken });

/**
 * Step 1 (WApply "You and the store"): makes the application and answers its resume link's token once. The
 * token is the only key to the application; only its sha256 is kept.
 */
export const startApplication = route({
  id: "portal.applications.start",
  method: "POST",
  path: "/v1/portal/applications",
  access: { public: true },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      contactName: z.string().trim().min(1, "Enter your name").max(200),
      contactEmail: email,
      whatsappPhone: phoneInput.min(1, "Enter a phone on WhatsApp"),
      storeName: z.string().trim().min(1, "Enter the store name").max(200),
      legalName: z.string().trim().max(200).nullable().optional(),
      businessType: z.enum(BUSINESS_TYPES),
      monthlyBand: z.enum(MONTHLY_BANDS),
      /** "I agree to be contacted about my application and accept the privacy policy." */
      consent: z.literal(true, { errorMap: () => ({ message: "Tick the box to agree" }) }),
    })
    .strict(),
  response: z.object({ token: z.string(), application: portalApplication }),
});

export const getApplication = route({
  id: "portal.applications.get",
  method: "GET",
  path: "/v1/portal/applications/:token",
  access: { public: true },
  params: applicationToken,
  response: portalApplication,
});

/** Saves progress while it is a draft. */
export const updateApplication = route({
  id: "portal.applications.update",
  method: "PATCH",
  path: "/v1/portal/applications/:token",
  access: { public: true },
  idempotency: "optional",
  params: applicationToken,
  body: applicationFields,
  response: portalApplication,
});

/** Sends it for review (422 application_incomplete names what is missing); the applicant gets an email. */
export const submitApplication = route({
  id: "portal.applications.submit",
  method: "POST",
  path: "/v1/portal/applications/:token/submit",
  access: { public: true },
  idempotency: "optional",
  params: applicationToken,
  body: z.object({}).strict(),
  response: portalApplication,
});

/**
 * The resale certificate: the file's bytes as the body with its own Content-Type (PDF, JPEG, PNG, WebP or
 * HEIC) and `?name=`; at most `portal.policy.uploadMaxMb`. On a draft it is attached; on an application that
 * needs a fix it replaces the certificate and sends it back for review (re-upload only).
 */
export const uploadApplicationCertificate = route({
  id: "portal.applications.certificate",
  method: "POST",
  path: "/v1/portal/applications/:token/certificate",
  access: { public: true },
  idempotency: "optional",
  rawBody: true,
  params: applicationToken,
  query: z.object({ name: z.string().trim().min(1).max(200) }),
  response: portalApplication,
});

export const ROUTES = {
  login,
  logout,
  requestPasswordReset,
  confirmPasswordReset,
  setPassword,
  tokenInfo,
  me,
  changePassword,
  updateNotifications,
  updatePreferences,
  unsubscribeEmail,
  startApplication,
  getApplication,
  updateApplication,
  submitApplication,
  uploadApplicationCertificate,
} satisfies Record<string, RouteContract>;
