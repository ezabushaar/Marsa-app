import { z } from "zod";
import type { Permission } from "./permissions.js";
import { schoolCalendarSchema } from "./routes/schedule.js";

/**
 * The settings registry: every key the settings store accepts, its value schema, its default and who may
 * change it. Business rules that need the database (terms in use, a mapped card-fee account, journals
 * already posted) live in @marsa/core; the shapes live here so the Control forms validate the same way.
 */

const bp = z.number().int().min(0).max(10_000);
const centsInt = z.number().int().min(0).max(2_100_000_000);

export const TERMS_KINDS = ["prepaid", "due_on_receipt", "net"] as const;
export type TermsKind = (typeof TERMS_KINDS)[number];

export const termsEntrySchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, "A terms code is 2-32 lower-case letters, digits or _"),
    label: z.string().trim().min(1).max(60),
    kind: z.enum(TERMS_KINDS),
    netDays: z.number().int().min(1).max(365).nullable().default(null),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.kind === "net" && t.netDays === null)
      ctx.addIssue({
        code: "custom",
        message: `${t.label} is a Net term and needs a number of days (1-365)`,
      });
    if (t.kind !== "net" && t.netDays !== null)
      ctx.addIssue({ code: "custom", message: `${t.label} is not a Net term, so it has no number of days` });
  });

export const termsListSchema = z
  .array(termsEntrySchema)
  .min(1, "Keep at least one payment term")
  .max(50)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const t of list) {
      if (seen.has(t.code))
        ctx.addIssue({ code: "custom", message: `Terms code "${t.code}" is listed twice` });
      seen.add(t.code);
    }
  });

export const PRICE_LISTS = ["standard", "tier1", "tier2", "tier3"] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

/** The largest credit limit a customer (or the default for new customers) may have: $100,000,000. */
export const MAX_CREDIT_LIMIT_CENTS = 10_000_000_000;

export const customerDefaultsSchema = z
  .object({
    termsCode: z.string().min(1),
    priceList: z.enum(PRICE_LISTS),
    creditLimitCents: z.number().int().min(0).max(MAX_CREDIT_LIMIT_CENTS),
  })
  .strict();

export const minimumOrderSchema = z
  .object({
    wholesaleOrderCents: centsInt,
    minUnitsPerItem: z.number().int().min(1).max(10_000),
  })
  .strict();

/** States where a card surcharge is never charged. They can't be removed from the list, only added to. */
export const SURCHARGE_BANNED_STATES = ["CO", "CT", "MA", "NY"] as const;

export const surchargeReviewSchema = z
  .object({
    approvedBy: z.string().uuid(),
    approvedAt: z.string(),
    note: z.string().min(1),
  })
  .strict();

const surchargeFields = {
  enabled: z.boolean(),
  percentBp: bp,
  fixedCents: centsInt,
  capCents: z.number().int().min(1).max(2_100_000_000).nullable(),
  /** Debit and prepaid cards are never surcharged; the schema accepts only true. */
  excludeDebitAndPrepaid: z.literal(true),
  disclosureText: z.string().max(2000).nullable(),
  label: z.string().trim().min(1).max(60),
  excludedStates: z
    .array(z.string().regex(/^[A-Z]{2}$/, "States are two capital letters"))
    .max(60)
    .refine(
      (s) => SURCHARGE_BANNED_STATES.every((b) => s.includes(b)),
      "CO, CT, MA and NY must stay on the list of states never charged a card fee",
    )
    .refine((s) => new Set(s).size === s.length, "A state is listed twice"),
};

/** The stored value. `review` is written by the server when an Owner turns the surcharge on. */
export const cardSurchargeSchema = z
  .object({ ...surchargeFields, review: surchargeReviewSchema.nullable() })
  .strict();

/** What a save sends. Any `review` sent by the client is ignored; the server records who reviewed it. */
export const cardSurchargeInputSchema = z
  .object({ ...surchargeFields, review: z.unknown().optional() })
  .strict()
  .transform(({ review: _ignored, ...rest }) => rest);

export const tolerancesSchema = z
  .object({
    overReceiptBp: bp,
    billCostBp: bp,
  })
  .strict();

export const timeZoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}, "Not a time zone name (for example America/Indiana/Indianapolis)");

export const floorPolicySchema = z
  .object({
    defaultMinMarginBp: z.number().int().min(0).max(9999),
    enforceOnItemPrices: z.boolean(),
  })
  .strict();

export const authPolicySchema = z
  .object({
    maxFailedAttempts: z.number().int().min(3).max(20),
    lockMinutes: z.number().int().min(1).max(1440),
    sessionHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    resetTokenMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    inviteTokenDays: z.number().int().min(1).max(30),
    minPasswordLength: z.number().int().min(8).max(128),
  })
  .strict();

export const editLockSchema = z.object({ minutes: z.number().int().min(1).max(240) }).strict();

export const approvalPolicySchema = z.object({ expiryDays: z.number().int().min(1).max(90) }).strict();

export const bankChangeApproversSchema = z
  .object({
    mode: z.enum(["any_holder", "listed"]),
    userIds: z.array(z.string().uuid()).max(50),
  })
  .strict();

/** Phase 2: a PO over this total needs a Manager's approval; null = no PO needs approval (Open points). */
export const poApprovalSchema = z
  .object({ limitCents: z.number().int().min(0).max(100_000_000_000).nullable() })
  .strict();

/** Freight on a PO is spread across its lines by value (decided); the field exists so the screen can show it. */
export const purchasingDefaultsSchema = z
  .object({
    leadTimeDays: z.number().int().min(0).max(365),
    freightSpread: z.literal("value"),
  })
  .strict();

export const inventoryPolicySchema = z
  .object({
    lowStockUnits: z.number().int().min(0).max(100_000),
    countStaleDays: z.number().int().min(1).max(3650),
  })
  .strict();

/**
 * Phase 3: how long a quote is valid, how long a credit-held order keeps its stock (decision 48), from how
 * many days overdue an invoice puts new orders on credit hold (decision 2), and after how many days an unpaid
 * portal invoice is voided (decision 45).
 */
export const salesPolicySchema = z
  .object({
    quoteValidityDays: z.number().int().min(1).max(365),
    holdReservationDays: z.number().int().min(1).max(90),
    overdueHoldDays: z.number().int().min(1).max(365),
    portalInvoiceVoidDays: z.number().int().min(1).max(90),
  })
  .strict();

// ── Phase 5: channels (docs/phases/phase-5-design.md §2.2) ──────────────

const factText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v));

/**
 * UX S6 (W5, D1410–D1411): Settings › Wholesale portal › Landing. The public catalog switch (off by default: Ez's
 * open decision) and the trust facts the public pages show. Every fact starts empty and an empty fact is never
 * shown, so the landing never states a fact nobody entered.
 */
export const portalLandingSchema = z
  .object({
    /** "Show the catalog to visitors who aren't signed in": items and pictures with "Price after approval". */
    publicCatalog: z.boolean(),
    /** "Ships in 1–2 business days from Indianapolis". */
    deliveryDays: factText(120),
    /** Free shipping from this order value. */
    freeShippingCents: centsInt.nullable(),
    phone: factText(40),
    email: z
      .string()
      .trim()
      .max(160)
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .refine(
        (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "Enter an email address, or leave it empty",
      ),
    address: factText(240),
    hours: factText(120),
    /** Licenses and registrations, as they should read ("Indiana retail merchant certificate 0123456"). */
    licenses: factText(240),
    /** Up to three customer quotes, in the customer's words, with their name and store. */
    quotes: z
      .array(
        z
          .object({
            text: z.string().trim().min(1, "A quote needs its words").max(280),
            name: z.string().trim().min(1, "A quote needs the person's name").max(80),
            store: factText(120),
          })
          .strict(),
      )
      .max(3, "At most three quotes"),
  })
  .strict();

/**
 * The wholesale portal's rules: session length and "keep me signed in", the lockout, the "Only N left" badge
 * (at or under this many available units), when a cart counts as abandoned, when a Submitted order nobody
 * invoiced closes (row 39), what "new arrivals" means, the quick-order sheet's size and the upload limit.
 */
export const portalPolicySchema = z
  .object({
    sessionHours: z.number().int().min(1).max(72),
    keepSignedInDays: z.number().int().min(1).max(90),
    maxFailedAttempts: z.number().int().min(3).max(20),
    lockMinutes: z.number().int().min(1).max(1440),
    lowStockBadgeUnits: z.number().int().min(0).max(100_000),
    abandonedCartHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    submittedCloseDays: z.number().int().min(1).max(365),
    newArrivalsDays: z.number().int().min(1).max(365),
    quickOrderMaxLines: z.number().int().min(1).max(1000),
    uploadMaxMb: z.number().int().min(1).max(50),
  })
  .strict();

/** Invoice reminders (row 22): 10:00 business time on the due date, again after 3 days, then every 7 days. */
export const remindersPolicySchema = z
  .object({
    enabled: z.boolean(),
    sendAt: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "A time of day, HH:MM (24 hours)"),
    onDueDate: z.boolean(),
    firstAfterDays: z.number().int().min(1).max(60),
    thenEveryDays: z.number().int().min(1).max(60),
  })
  .strict();

/** Who customer messages come from (SetMessages "Sender details"); empty until set before go-live. */
export const messagesSenderSchema = z
  .object({
    deskEmail: z.string().trim().email().max(200).nullable(),
    whatsappNumber: z
      .string()
      .regex(/^\+[1-9][0-9]{6,14}$/, "A WhatsApp number in international form, e.g. +13175550123")
      .nullable(),
    replyTo: z.enum(["account_owner", "desk"]),
    footerAddress: z.string().trim().max(500).nullable(),
  })
  .strict();

/**
 * Phase 5 (slice 3): the company details every document prints (SetBusiness "Company"): the trading and legal
 * names, address, phone, accounts email, EIN and the website the pay and accept links point at. Blank until set
 * before go-live; documents leave a blank field out.
 */
export const businessCompanySchema = z
  .object({
    tradingName: z.string().trim().min(1).max(100),
    legalName: z.string().trim().min(1).max(200),
    address: z
      .object({
        line1: z.string().trim().min(1).max(200),
        line2: z.string().trim().max(200).nullable(),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().min(2).max(50),
        postalCode: z.string().trim().min(1).max(20),
      })
      .strict()
      .nullable(),
    phone: z.string().trim().max(40).nullable(),
    accountsEmail: z.string().trim().email().max(200).nullable(),
    taxId: z.string().trim().max(20).nullable(),
    website: z.string().trim().max(200).nullable(),
  })
  .strict();

/**
 * EasyPost (D2186): Settings › Shipping. The label file (PDF opens in the browser's print dialog; ZPL goes to a
 * thermal printer) and size, whether addresses are checked with EasyPost before rates, the box presets (inner
 * size in inches and the empty box's weight in ounces), the carrier and service the rates list puts first,
 * carriers to leave out, the signature default, DHL eCommerce's merchant id (EasyPost asks it for DHL rates), and whether a delivered scan marks the
 * delivery delivered.
 */
export const LABEL_FORMATS = ["PDF", "ZPL"] as const;
export const LABEL_SIZES = ["4x6", "4x8", "8.5x11"] as const;
export const SIGNATURE_OPTIONS = ["none", "signature", "adult_signature"] as const;
export const boxPresetSchema = z
  .object({
    name: z.string().trim().min(1, "Name the box").max(40),
    lengthIn: z.number().positive().max(120),
    widthIn: z.number().positive().max(120),
    heightIn: z.number().positive().max(120),
    /** The empty box's weight, ounces. */
    tareOz: z.number().min(0).max(800),
  })
  .strict();
export type BoxPreset = z.infer<typeof boxPresetSchema>;
export const savedAddressSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(100),
    company: z.string().trim().max(100).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(2).max(50),
    postalCode: z.string().trim().min(3).max(20),
    country: z.string().trim().length(2).default("US"),
  })
  .strict();

/** Shipping estimates (D2232): item kinds the estimator packs, with a packed unit's weight and size. */
export const SHIP_KINDS = [
  "bottle_30",
  "bottle_50",
  "bottle_100",
  "bottle_200",
  "gift_set",
  "mini_set",
  "hair_mist",
  "body_spray",
  "other",
] as const;
export type ShipKind = (typeof SHIP_KINDS)[number];
export const SHIP_KIND_LABELS: Record<ShipKind, string> = {
  bottle_30: "Bottle 30 ml",
  bottle_50: "Bottle 50 ml",
  bottle_100: "Bottle 100 ml",
  bottle_200: "Bottle 200 ml",
  gift_set: "Gift set / collection",
  mini_set: "Mini set",
  hair_mist: "Hair mist",
  body_spray: "Body spray / mist",
  other: "Other",
};
const unitProfileSchema = z
  .object({
    weightOz: z.number().positive().max(2000),
    lengthIn: z.number().positive().max(120),
    widthIn: z.number().positive().max(120),
    heightIn: z.number().positive().max(120),
  })
  .strict();
export const DEFAULT_KIND_PROFILES: Record<ShipKind, z.infer<typeof unitProfileSchema>> = {
  bottle_30: { weightOz: 4, lengthIn: 3.5, widthIn: 2, heightIn: 1.5 },
  bottle_50: { weightOz: 7, lengthIn: 4.5, widthIn: 2.5, heightIn: 2 },
  bottle_100: { weightOz: 12, lengthIn: 5, widthIn: 3, heightIn: 2.25 },
  bottle_200: { weightOz: 20, lengthIn: 6.5, widthIn: 3.5, heightIn: 2.75 },
  gift_set: { weightOz: 32, lengthIn: 10, widthIn: 8, heightIn: 3.5 },
  mini_set: { weightOz: 10, lengthIn: 6, widthIn: 5, heightIn: 2 },
  hair_mist: { weightOz: 5, lengthIn: 6, widthIn: 2, heightIn: 2 },
  body_spray: { weightOz: 9, lengthIn: 8, widthIn: 2.25, heightIn: 2.25 },
  other: { weightOz: 12, lengthIn: 5, widthIn: 4, heightIn: 3 },
};
/**
 * Settings › Shipping labels › Estimates (D2233–D2236): how the estimator packs (fill factor, heaviest box), when it
 * suggests a pallet, the pallet's size and limits, the freight class (Ez to set), the markup on the suggested charge,
 * and each kind's packed unit.
 */
export const shippingEstimatesSchema = z
  .object({
    fillFactor: z.number().min(0.3).max(1),
    maxBoxWeightLb: z.number().min(5).max(150),
    palletOverLb: z.number().min(0).max(5000),
    palletOverParcels: z.number().int().min(1).max(100),
    palletLengthIn: z.number().positive().max(120),
    palletWidthIn: z.number().positive().max(120),
    palletMaxHeightIn: z.number().positive().max(120),
    palletMaxWeightLb: z.number().positive().max(5000),
    palletTareLb: z.number().min(0).max(200),
    /** NMFC class, e.g. "85"; null until Ez sets it. */
    freightClass: z.string().trim().max(10).nullable(),
    markupPercent: z.number().min(0).max(200),
    kindDefaults: z.object(
      Object.fromEntries(SHIP_KINDS.map((k) => [k, unitProfileSchema])) as Record<
        ShipKind,
        typeof unitProfileSchema
      >,
    ),
  })
  .strict();
export type ShippingEstimatesSetting = z.infer<typeof shippingEstimatesSchema>;
export const shippingLabelsSchema = z
  .object({
    labelFormat: z.enum(LABEL_FORMATS),
    labelSize: z.enum(LABEL_SIZES),
    verifyAddresses: z.boolean(),
    presets: z.array(boxPresetSchema).max(30),
    preferredCarrier: z.string().trim().max(40).nullable(),
    preferredService: z.string().trim().max(60).nullable(),
    hiddenCarriers: z.array(z.string().trim().min(1).max(40)).max(20),
    defaultSignature: z.enum(SIGNATURE_OPTIONS),
    dhlMerchantId: z.string().trim().max(60).nullable(),
    autoDeliver: z.boolean(),
    /** D2231: other ship-from addresses staff pick from (a second building, a 3PL). */
    savedAddresses: z.array(savedAddressSchema).max(20).default([]),
  })
  .strict();
export type ShippingLabelsSetting = z.infer<typeof shippingLabelsSchema>;
export const DEFAULT_BOX_PRESETS: BoxPreset[] = [
  { name: "Small box", lengthIn: 8, widthIn: 6, heightIn: 4, tareOz: 4 },
  { name: "Medium box", lengthIn: 12, widthIn: 10, heightIn: 8, tareOz: 10 },
  { name: "Cube box", lengthIn: 14, widthIn: 14, heightIn: 12, tareOz: 16 },
  { name: "Large box", lengthIn: 16, widthIn: 16, heightIn: 15, tareOz: 24 },
  { name: "Long box", lengthIn: 20, widthIn: 16, heightIn: 14, tareOz: 28 },
  { name: "Bulk box", lengthIn: 24, widthIn: 18, heightIn: 18, tareOz: 40 },
];

/**
 * Settings › Business: the company logo (an upload kept in stored_files, kind `company_logo`), printed on every
 * PDF and email and in the portal header in place of the wordmark. Null until Ez uploads one; everything then
 * shows the "M" badge and the trading name.
 */
export const businessLogoSchema = z.object({ fileId: z.string().uuid().nullable() }).strict();

/** What a logo may be: PNG or JPEG (what the PDF renderer and every mail client can show). */
export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;
/** The largest logo file, in bytes (1 MB: it is embedded in every PDF). */
export const LOGO_MAX_BYTES = 1024 * 1024;
/** A logo's sides, in pixels: big enough to print sharp, small enough to embed. */
export const LOGO_MIN_PX = 32;
export const LOGO_MAX_PX = 4000;

/**
 * The go-live readiness of the company block (cut-over blocker "Documents" 1 and Portal 3): the details every
 * document prints that are still empty, in the form's order, plus the logo. Empty: ready.
 */
export function companyDetailsMissing(
  company: z.output<typeof businessCompanySchema>,
  logo: z.output<typeof businessLogoSchema> | null,
): string[] {
  const blank = (v: string | null | undefined) => !v || v.trim() === "";
  const missing: string[] = [];
  if (blank(company.legalName)) missing.push("legal name");
  if (!company.address) missing.push("address");
  if (blank(company.phone)) missing.push("phone");
  if (blank(company.taxId)) missing.push("EIN");
  if (blank(company.accountsEmail)) missing.push("accounts email");
  if (blank(company.website)) missing.push("website");
  if (logo !== null && !logo.fileId) missing.push("logo");
  return missing;
}

/** The trade counter: what price list the walk-in customer pays (open question 3: retail, the default). */
export const salesCounterSchema = z.object({ walkInPriceList: z.enum(["retail", ...PRICE_LISTS]) }).strict();

/**
 * The WooCommerce switches (design §8): taking website orders in, pushing stock, pushing order status. All off
 * until cut-over, so the legacy WordPress Control stays the one writer.
 */
export const channelsWooSchema = z
  .object({ ingest: z.boolean(), stockPush: z.boolean(), orderPush: z.boolean() })
  .strict();

export type WooSwitchKey = "ingest" | "stockPush" | "orderPush";

/**
 * The three `channels.woo` switches (phase 6 slice 16, cut-over blocker Phase 5 close 4): what each does when
 * turned on or off, and the words a person types to confirm the change (Settings › Integrations; the server
 * checks the same words, so a change is never one stray click).
 */
export const WOO_SWITCHES: readonly {
  key: WooSwitchKey;
  label: string;
  word: string;
  on: string;
  off: string;
}[] = [
  {
    key: "ingest",
    label: "Take website orders in",
    word: "INGEST",
    on: "Every website order paid from now on becomes a sales order, an invoice and a payment here, reserving stock; orders paid before stay history in WooCommerce. The old WordPress Control must already be off for website orders.",
    off: "Website orders are no longer taken in: WooCommerce events are acknowledged and nothing is booked here, so orders paid while it is off stay history (the old system must book them).",
  },
  {
    key: "stockPush",
    label: "Push stock to the website",
    word: "STOCK PUSH",
    on: "The website's stock is set from this warehouse's Available for every linked item, and every held stock push is sent. Refused until the opening balances are posted.",
    off: "Stock pushes wait as held; the website keeps the stock it shows now.",
  },
  {
    key: "orderPush",
    label: "Push order status back",
    word: "ORDER PUSH",
    on: "Website orders are marked completed with their tracking when they ship, and refunds made here are recorded at WooCommerce. Held pushes are sent.",
    off: "Order status and refund records wait as held; WooCommerce isn't told about shipments or refunds made here.",
  },
];

/** The words that confirm a change of the switches, e.g. "INGEST ON"; null when nothing changes. */
export function wooSwitchConfirmWords(
  before: Record<WooSwitchKey, boolean>,
  after: Record<WooSwitchKey, boolean>,
): string | null {
  const changed = WOO_SWITCHES.filter((s) => before[s.key] !== after[s.key]).map(
    (s) => `${s.word} ${after[s.key] ? "ON" : "OFF"}`,
  );
  return changed.length ? changed.join(" AND ") : null;
}

/** Typed words compared as a person types them: case and repeated spaces don't matter. */
export const sameConfirmWords = (typed: string | null | undefined, expected: string): boolean =>
  (typed ?? "").trim().replace(/\s+/g, " ").toUpperCase() === expected;

// ── Launch: the outbound messages switch (launch-messaging) ────────────────────────

/**
 * `messages.outbound`: whether email and WhatsApp may leave at all. Off (the default, and seeded off) during the
 * migration, whatever EMAIL_PROVIDER / WHATSAPP_PROVIDER say: every message for a channel that is off waits in
 * the outbox as held ("Sending switched off"), checked when queued and again when sent. Turning one on sends
 * nothing by itself: the backlog is released or discarded on Settings › Messages.
 */
export const messagesOutboundSchema = z.object({ email: z.boolean(), whatsapp: z.boolean() }).strict();

export type OutboundChannel = "email" | "whatsapp";

/** The reason on a message held because its channel's sending is switched off. */
export const SENDING_OFF_REASON = "Sending switched off";

export const OUTBOUND_SWITCHES: readonly { key: OutboundChannel; label: string; word: string }[] = [
  { key: "email", label: "Email", word: "EMAIL" },
  { key: "whatsapp", label: "WhatsApp", word: "WHATSAPP" },
];

/**
 * The words that confirm turning a channel ON ("EMAIL ON", "EMAIL ON AND WHATSAPP ON"); null when nothing is
 * turned on (turning off needs no words: stopping is always one click).
 */
export function outboundConfirmWords(
  before: Record<OutboundChannel, boolean>,
  after: Record<OutboundChannel, boolean>,
): string | null {
  const on = OUTBOUND_SWITCHES.filter((s) => after[s.key] && !before[s.key]).map((s) => `${s.word} ON`);
  return on.length ? on.join(" AND ") : null;
}

// ── Phase 6: migration and cut-over (docs/phases/phase-6-design.md §10) ──────────────

/** §6: closing a month needs the Owner's sign-off while this is on (default on). */
export const closePolicySchema = z.object({ ownerSignOff: z.boolean() }).strict();

/**
 * P9 (D1964): the fiscal year's first month (1 = January, the default: the calendar year). A fiscal year is named
 * by the calendar year it ends in: with July, "2027" runs 1 July 2026 – 30 June 2027.
 */
export const fiscalYearSchema = z.object({ startMonth: z.number().int().min(1).max(12) }).strict();

/** The first and last day of fiscal year `year` (named by the year it ends in) for a start month. */
export function fiscalYearBounds(year: number, startMonth = 1): { startsOn: string; endsOn: string } {
  const mm = String(startMonth).padStart(2, "0");
  const startsOn = startMonth === 1 ? `${year}-01-01` : `${year - 1}-${mm}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    startsOn,
    endsOn: `${year}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

/** The fiscal year (by the year it ends in) a day falls in. */
export function fiscalYearOf(day: string, startMonth = 1): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return startMonth === 1 || m < startMonth ? y : y + 1;
}

/** The first day of the fiscal year a day falls in. */
export const fiscalYearStart = (day: string, startMonth = 1): string =>
  fiscalYearBounds(fiscalYearOf(day, startMonth), startMonth).startsOn;

/**
 * Phase 6 slice 18 (Ez's decision #4, cut-over blocker Migration 3): partners migrated from WordPress get their
 * portal links only when Ez says. Off: a migrated partner's "Forgot password" sends nothing (audited as held);
 * on: it sends their welcome link again.
 */
export const portalMigratedLinksSchema = z.object({ sendWelcome: z.boolean() }).strict();

/**
 * §3.6 and §5: an old-vs-counted difference over these units or cents needs a reason before approval; a batch
 * deposit and a payout are suggested for a bank line within these many days.
 */
export const migrationPolicySchema = z
  .object({
    bridgeUnits: z.number().int().min(0).max(100_000),
    bridgeCents: centsInt,
    depositMatchDays: z.number().int().min(0).max(60),
    payoutMatchDays: z.number().int().min(0).max(60),
  })
  .strict();

/**
 * Phase 7 (plan "Follow-ups"): a cart becomes a follow-up from this value (Ez, 13 Oct 2026: $500), a quote from
 * this many days before it expires; after a logged contact the same fact doesn't come back for this many days
 * unless its reminder is due.
 */
export const crmPolicySchema = z
  .object({
    abandonedCartCents: centsInt,
    quoteExpiringDays: z.number().int().min(0).max(60),
    contactQuietDays: z.number().int().min(0).max(60),
  })
  .strict();

/** The task types of the Work rules (KAdmin); each has a default due time in hours. */
export const TASK_TYPES = [
  "follow_up",
  "fulfilment",
  "marketing_review",
  "finance_payout",
  "support",
  "other",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM, e.g. 09:00");

/**
 * Phase 7 (KAdmin, KSupport; both values still open with Ez, built to these defaults): the default due time of
 * each task type in hours, the support first-reply goal in business hours, and the business hours (Monday to
 * Friday) those count in. Changes apply to new tasks and tickets only.
 */
export const workPolicySchema = z
  .object({
    dueHours: z.object(
      Object.fromEntries(
        TASK_TYPES.map((t) => [
          t,
          z
            .number()
            .int()
            .min(1)
            .max(24 * 60),
        ]),
      ) as Record<TaskType, z.ZodNumber>,
    ),
    firstReplyBusinessHours: z.number().int().min(1).max(80),
    businessDayStart: hhmm,
    businessDayEnd: hhmm,
  })
  .strict()
  .refine((v) => v.businessDayStart < v.businessDayEnd, "The business day must end after it starts");

// ── Launch: sales tax nexus (D174) ───────────────────────────────────────────────

/**
 * `tax.nexus` (Ez, 24 Oct 2026): the states Marsa collects sales tax in, each with the default rate (ppm) a
 * ship-to there is taxed at when it has no rate of its own (Indiana 7%, state rate, no local); every other state
 * 0%. An address's own rate still wins and an exempt address is taxed nothing. `wholesaleDefault`: wholesale
 * customers are tax exempt unless Ez says so, so their new addresses start exempt (no certificate needed while
 * this is "exempt"); retail customers stay taxable under the nexus rule.
 */
export const taxNexusSchema = z
  .object({
    states: z
      .record(
        z.string().regex(/^[A-Z]{2}$/, "States are two capital letters, e.g. IN"),
        z
          .number()
          .int("Rates are whole parts per million")
          .min(0, "A rate is 0% to 100%")
          .max(1_000_000, "A rate is 0% to 100%"),
      )
      .refine((m) => Object.keys(m).length <= 60, "At most 60 states"),
    wholesaleDefault: z.enum(["exempt", "taxable"]),
  })
  .strict();

export type TaxNexus = z.output<typeof taxNexusSchema>;

/** The default rate (ppm) for a ship-to in `state` with no rate of its own: the nexus state's, else 0. */
export function nexusRatePpm(nexus: Pick<TaxNexus, "states">, state: string | null | undefined): number {
  const s = (state ?? "").trim().toUpperCase();
  return Object.hasOwn(nexus.states, s) ? (nexus.states[s] ?? 0) : 0;
}

/** A rate as a percent, "7%" or "8.875%". */
export const ppmPercent = (ppm: number) => `${Number((ppm / 10_000).toFixed(4))}%`;

/** "Nexus default: 7% (IN)" for a nexus state, "No nexus: 0%" for any other. */
export function nexusDefaultText(nexus: Pick<TaxNexus, "states">, state: string | null | undefined): string {
  const s = (state ?? "").trim().toUpperCase();
  return Object.hasOwn(nexus.states, s)
    ? `Nexus default: ${ppmPercent(nexus.states[s] ?? 0)} (${s})`
    : "No nexus: 0%";
}

/** Whether a customer of this kind is exempt by default (Ez: every wholesale customer, unless he says so). */
export const wholesaleExemptByDefault = (nexus: Pick<TaxNexus, "wholesaleDefault">, kind: string) =>
  kind === "wholesale" && nexus.wholesaleDefault === "exempt";

/**
 * Marsa Time T4 (D1243): overtime and the pay period. Weekly overtime past `weeklyOtHours` (default 40, FLSA);
 * daily overtime past `dailyOtHours` when set (null: off, the default — Indiana has no daily overtime). The pay
 * period is weekly or every two weeks counted from `biweeklyAnchor` (a Sunday that starts a period).
 */
export const timePayrollSchema = z
  .object({
    weeklyOtHours: z.number().min(1, "At least 1 hour").max(80, "At most 80 hours"),
    dailyOtHours: z.number().min(1, "At least 1 hour").max(24, "At most 24 hours").nullable(),
    payPeriod: z.enum(["weekly", "biweekly"]),
    biweeklyAnchor: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD")
      .refine((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0, "Pick a Sunday: periods start on Sunday"),
  })
  .strict()
  .refine(
    (v) =>
      Number.isInteger(v.weeklyOtHours * 4) &&
      (v.dailyOtHours === null || Number.isInteger(v.dailyOtHours * 4)),
    {
      message: "Hours are in quarter hours",
    },
  );

interface SettingDef<S extends z.ZodTypeAny, I extends z.ZodTypeAny = S> {
  /** Validates a stored value. */
  schema: S;
  /** Validates what a save sends; defaults to the stored schema. */
  input: I;
  default: z.output<S>;
  label: string;
  description: string;
  /** Who may change it. Some keys need more for particular changes (checked in core). */
  permission: Permission;
}

function def<S extends z.ZodTypeAny, I extends z.ZodTypeAny = S>(
  d: Omit<SettingDef<S, I>, "input"> & { input?: I },
): SettingDef<S, I> {
  return { ...d, input: (d.input ?? d.schema) as I };
}

export const SETTINGS = {
  "terms.list": def({
    schema: termsListSchema,
    default: [
      { code: "prepaid", label: "Prepaid", kind: "prepaid", netDays: null },
      { code: "due_on_receipt", label: "Due on receipt", kind: "due_on_receipt", netDays: null },
      { code: "net15", label: "Net 15", kind: "net", netDays: 15 },
      { code: "net30", label: "Net 30", kind: "net", netDays: 30 },
    ],
    label: "Default terms",
    description: "The one list of payment terms customers and vendors can be given (decision 35).",
    permission: "settings.manage",
  }),
  "customers.defaults": def({
    schema: customerDefaultsSchema,
    default: { termsCode: "due_on_receipt", priceList: "standard", creditLimitCents: 0 },
    label: "Defaults for new customers",
    description:
      "Payment terms, price list and credit limit a new customer starts with. Existing customers keep theirs.",
    permission: "settings.manage",
  }),
  "customers.inactive_days": def({
    schema: z.object({ days: z.number().int().min(7).max(730) }),
    default: { days: 45 },
    label: "Inactive customers",
    description: "A customer with no order in this many days shows on the Inactive customers list (W7).",
    permission: "settings.manage",
  }),
  "sales.minimum_order": def({
    schema: minimumOrderSchema,
    default: { wholesaleOrderCents: 50_000, minUnitsPerItem: 3 },
    label: "Minimum wholesale order",
    description: "Smallest wholesale order before freight, and the fewest units of one item per order.",
    permission: "settings.payments",
  }),
  "payments.card_surcharge": def({
    schema: cardSurchargeSchema,
    input: cardSurchargeInputSchema,
    default: {
      enabled: false,
      percentBp: 290,
      fixedCents: 30,
      capCents: null,
      excludeDebitAndPrepaid: true,
      disclosureText: null,
      label: "Card processing fee",
      excludedStates: [...SURCHARGE_BANNED_STATES],
      review: null,
    },
    label: "Card fee",
    description:
      "Off until reviewed. Never on debit or prepaid cards, never in CO, CT, MA or NY, skipped for every Net term, and never more than the cap.",
    permission: "settings.payments",
  }),
  "purchasing.tolerances": def({
    schema: tolerancesSchema,
    default: { overReceiptBp: 0, billCostBp: 100 },
    label: "Tolerances",
    description: "Global over-receipt and bill-cost tolerances; a vendor can override either (decision 32).",
    permission: "settings.accounting",
  }),
  "business.time_zone": def({
    schema: timeZoneSchema,
    default: "America/Indiana/Indianapolis",
    label: "Business time zone",
    description:
      "Decides the business day for dates, periods and numbers. Fixed in this version; can't change once a journal exists.",
    permission: "settings.manage",
  }),
  "pricing.floor": def({
    schema: floorPolicySchema,
    // 10% by Ez's decision of 14 Oct 2026 (the plan proposed 15%); migration 0015 moves stored defaults.
    default: { defaultMinMarginBp: 1000, enforceOnItemPrices: true },
    label: "Price floor",
    description: "Minimum margin used when an item has none of its own; going under needs Manager approval.",
    permission: "prices.edit",
  }),
  "auth.policy": def({
    schema: authPolicySchema,
    default: {
      maxFailedAttempts: 5,
      lockMinutes: 15,
      sessionHours: 12,
      resetTokenMinutes: 60,
      inviteTokenDays: 7,
      minPasswordLength: 10,
    },
    label: "Sign-in policy",
    description: "Wrong tries before the account locks, lock length, session length and password rules.",
    permission: "users.manage",
  }),
  "documents.edit_lock": def({
    schema: editLockSchema,
    default: { minutes: 15 },
    label: "Edit lock",
    description: "How long an edit lock lasts without activity before someone else can take the record.",
    permission: "settings.manage",
  }),
  "approvals.policy": def({
    schema: approvalPolicySchema,
    default: { expiryDays: 7 },
    label: "Approvals",
    description: "Days an approval request waits before it expires.",
    permission: "settings.manage",
  }),
  "purchasing.po_approval": def({
    schema: poApprovalSchema,
    default: { limitCents: null },
    label: "Purchase order approval limit",
    description:
      "A purchase order over this total waits for a Manager's approval before it is sent. Not set: Send approves and sends.",
    permission: "settings.accounting",
  }),
  "purchasing.defaults": def({
    schema: purchasingDefaultsSchema,
    default: { leadTimeDays: 14, freightSpread: "value" },
    label: "Purchasing defaults",
    description:
      "Lead time for items without one, and how PO freight is spread across the lines at receipt (by value, decided).",
    permission: "settings.accounting",
  }),
  "inventory.transfer_approval": def({
    schema: poApprovalSchema,
    default: { limitCents: null },
    label: "Transfer approval limit",
    description:
      "A transfer worth more than this at cost waits for a Manager's approval before it is dispatched. Not set: Dispatch moves it at once.",
    permission: "settings.accounting",
  }),
  "inventory.policy": def({
    schema: inventoryPolicySchema,
    default: { lowStockUnits: 5, countStaleDays: 90 },
    label: "Stock policy",
    description:
      "Low stock is this many available units or fewer; items not counted in this many days are suggested.",
    permission: "settings.accounting",
  }),
  "sales.policy": def({
    schema: salesPolicySchema,
    // 30-day quotes (plan "values still blank", built to 30); 7-day holds and portal voids (decisions 45, 48);
    // credit hold from 30 days overdue (decision 2).
    default: { quoteValidityDays: 30, holdReservationDays: 7, overdueHoldDays: 30, portalInvoiceVoidDays: 7 },
    label: "Sales policy",
    description:
      "Days a quote stays valid, days a credit-held order keeps its reserved stock, days overdue before new orders go on credit hold, and days an unpaid portal invoice waits before it is voided.",
    permission: "settings.manage",
  }),
  "portal.policy": def({
    schema: portalPolicySchema,
    default: {
      sessionHours: 12,
      keepSignedInDays: 30,
      maxFailedAttempts: 5,
      lockMinutes: 15,
      lowStockBadgeUnits: 20,
      abandonedCartHours: 24,
      submittedCloseDays: 30,
      newArrivalsDays: 30,
      quickOrderMaxLines: 200,
      uploadMaxMb: 10,
    },
    label: "Wholesale portal",
    description:
      "Portal sign-in length and lockout, the low-stock badge, when a cart is abandoned, when an order nobody invoiced closes, new arrivals, the quick-order size and the upload limit.",
    permission: "settings.manage",
  }),
  "reminders.policy": def({
    schema: remindersPolicySchema,
    default: { enabled: true, sendAt: "10:00", onDueDate: true, firstAfterDays: 3, thenEveryDays: 7 },
    label: "Invoice reminders",
    description:
      "Reminders on an open invoice: on the due date at this time, again after these days, then on this cycle until it is settled.",
    permission: "settings.manage",
  }),
  "messages.sender": def({
    schema: messagesSenderSchema,
    default: { deskEmail: null, whatsappNumber: null, replyTo: "account_owner", footerAddress: null },
    label: "Message sender",
    description:
      "The desk email and WhatsApp number customer messages come from, who replies go to, and the footer.",
    permission: "settings.manage",
  }),
  "business.company": def({
    schema: businessCompanySchema,
    default: {
      tradingName: "Marsa Wholesale",
      legalName: "Marsa Import Inc",
      address: null,
      phone: null,
      accountsEmail: null,
      taxId: null,
      website: "wholesale.itsmarsa.com",
    },
    label: "Company details",
    description:
      "The names, address, phone, accounts email and website printed on every invoice, quote, statement, PO and email.",
    permission: "settings.manage",
  }),
  "business.logo": def({
    schema: businessLogoSchema,
    default: { fileId: null },
    label: "Company logo",
    description:
      "The logo printed on every invoice, quote, statement, PO and email, and shown in the portal header.",
    permission: "settings.manage",
  }),
  "sales.counter": def({
    schema: salesCounterSchema,
    default: { walkInPriceList: "retail" },
    label: "Trade counter",
    description:
      "The price the walk-in customer pays at the trade counter; a named customer pays their own list.",
    permission: "settings.payments",
  }),
  "channels.woo": def({
    schema: channelsWooSchema,
    default: { ingest: false, stockPush: false, orderPush: false },
    label: "WooCommerce",
    description:
      "Take website orders in, push stock to the website, push order status back. Off until cut-over, so only one system writes.",
    permission: "system.manage",
  }),
  "books.fiscal_year": def({
    schema: fiscalYearSchema,
    default: { startMonth: 1 },
    label: "Fiscal year",
    description:
      "The month the fiscal year starts. Statements' year to date, the balance sheet's earnings this year and the year-end close follow it. Can't change once a year has been closed (reopen it first).",
    permission: "periods.close",
  }),
  "close.policy": def({
    schema: closePolicySchema,
    default: { ownerSignOff: true },
    label: "Month close",
    description:
      "Whether closing a month needs the Owner's sign-off (the tie-outs, reconciliations and reports pinned to it).",
    // Only the Owner can stop the Owner's own sign-off being required.
    permission: "opening_balances.approve",
  }),
  "portal.landing": def({
    schema: portalLandingSchema,
    default: {
      publicCatalog: false,
      deliveryDays: null,
      freeShippingCents: null,
      phone: null,
      email: null,
      address: null,
      hours: null,
      licenses: null,
      quotes: [],
    },
    label: "Portal landing and public pages",
    description:
      'Whether visitors who aren\'t signed in can browse the catalog (with "Price after approval"), and the facts the public pages show: delivery days, free shipping, phone, email, address, hours, licenses and up to three customer quotes. An empty fact is not shown.',
    permission: "settings.manage",
  }),
  "portal.migrated_links": def({
    schema: portalMigratedLinksSchema,
    default: { sendWelcome: false },
    label: "Migrated partner links",
    description:
      "Whether a partner moved from the old shop gets their welcome link when they ask for a password. Off until the Owner sends the links.",
    // Ez's decision #4: partner portal links go out only when he says.
    permission: "opening_balances.approve",
  }),
  "migration.policy": def({
    schema: migrationPolicySchema,
    default: { bridgeUnits: 2, bridgeCents: 5000, depositMatchDays: 5, payoutMatchDays: 3 },
    label: "Opening balances and matching",
    description:
      "An old-vs-counted difference over these units or dollars needs a reason; how many days either side a bank line looks for its batch deposit or payout.",
    permission: "settings.accounting",
  }),
  "vendors.bank_change_approvers": def({
    schema: bankChangeApproversSchema,
    default: { mode: "any_holder", userIds: [] },
    label: "Second approver for vendor bank details",
    description:
      "Anyone else with the vendor bank permission, or only the people chosen here. Never the person who asked.",
    permission: "users.manage",
  }),
  "crm.policy": def({
    schema: crmPolicySchema,
    default: { abandonedCartCents: 50_000, quoteExpiringDays: 3, contactQuietDays: 7 },
    label: "CRM follow-ups",
    description:
      "From what cart value an open cart becomes a follow-up, how many days before expiry a quote does, and how long a logged contact keeps the same reason off the list.",
    permission: "settings.manage",
  }),
  "work.policy": def({
    schema: workPolicySchema,
    default: {
      dueHours: {
        follow_up: 24,
        fulfilment: 24,
        marketing_review: 48,
        finance_payout: 72,
        support: 24,
        other: 72,
      },
      firstReplyBusinessHours: 4,
      businessDayStart: "09:00",
      businessDayEnd: "17:00",
    },
    label: "Task rules",
    description:
      "Default due time per task type, the support first-reply goal in business hours, and the business day it counts in (Monday to Friday). Applies to new tasks only.",
    permission: "settings.manage",
  }),
  "messages.outbound": def({
    schema: messagesOutboundSchema,
    default: { email: false, whatsapp: false },
    label: "Outbound messages",
    description:
      "Whether email and WhatsApp messages may be sent at all. Off during the migration: messages wait in the outbox, nothing is sent.",
    permission: "settings.manage",
  }),
  "tax.nexus": def({
    schema: taxNexusSchema,
    default: { states: { IN: 70_000 }, wholesaleDefault: "exempt" },
    label: "Sales tax nexus",
    description:
      "The states Marsa collects sales tax in and the rate a ship-to there gets when it has no rate of its own; every other state is 0%. Wholesale customers start tax exempt unless set to taxable.",
    permission: "settings.manage",
  }),
  "time.payroll": def({
    schema: timePayrollSchema,
    default: { weeklyOtHours: 40, dailyOtHours: null, payPeriod: "weekly", biweeklyAnchor: "2026-11-01" },
    label: "Overtime and pay period",
    description:
      "Overtime past the weekly hours (40 by default) and, when set, past the daily hours; whether payroll runs every week or every two weeks.",
    permission: "time.manage",
  }),
  "shipping.labels": def({
    schema: shippingLabelsSchema,
    default: {
      labelFormat: "PDF",
      labelSize: "4x6",
      verifyAddresses: true,
      presets: DEFAULT_BOX_PRESETS,
      preferredCarrier: null,
      preferredService: null,
      hiddenCarriers: [],
      defaultSignature: "none",
      dhlMerchantId: null,
      autoDeliver: true,
      savedAddresses: [],
    },
    label: "Shipping labels",
    description:
      "The label file and size, address checks, box presets, the carrier the rates put first, carriers left out, signatures, DHL's merchant id and delivered scans.",
    permission: "settings.manage",
  }),
  "shipping.estimates": def({
    schema: shippingEstimatesSchema,
    default: {
      fillFactor: 0.8,
      maxBoxWeightLb: 50,
      palletOverLb: 150,
      palletOverParcels: 8,
      palletLengthIn: 48,
      palletWidthIn: 40,
      palletMaxHeightIn: 72,
      palletMaxWeightLb: 1500,
      palletTareLb: 45,
      freightClass: null,
      markupPercent: 0,
      kindDefaults: DEFAULT_KIND_PROFILES,
    },
    label: "Shipping estimates",
    description:
      "How quotes and orders estimate shipping: box fill, heaviest box, when a pallet is suggested, the pallet's size and limits, the freight class, the markup on the suggested charge and each item kind's packed weight and size.",
    permission: "settings.manage",
  }),
  "schedule.school_calendar": def({
    schema: schoolCalendarSchema,
    default: { terms: [], holidays: [] },
    label: "School calendar",
    description:
      "Term dates and holidays for the under-18 rules on the schedule board: a night before a school day ends by 10:00 PM, other nights by 11:30 PM. With no terms set, every Sunday to Thursday night counts as a school night.",
    permission: "employees.schedule",
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]["schema"]>;
export type SettingInput<K extends SettingKey> = z.input<(typeof SETTINGS)[K]["input"]>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** Default value of every key, as seeded at version 1. */
export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, SETTINGS[k].default]),
) as { [K in SettingKey]: SettingValue<K> };

/** Every permission that can change at least one setting; the PUT route declares this union. */
export const SETTINGS_PERMISSIONS: readonly Permission[] = [
  ...new Set<Permission>([...SETTING_KEYS.map((k) => SETTINGS[k].permission), "payments.enable_surcharge"]),
];
