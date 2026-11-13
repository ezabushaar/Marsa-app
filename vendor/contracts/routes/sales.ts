import { z } from "zod";
import {
  boolQuery,
  centsString,
  columnSearch,
  countedPage,
  csvEnum,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  page,
  route,
  userRef,
  uuid,
} from "../http.js";
import { LABEL_FORMATS, PRICE_LISTS, SIGNATURE_OPTIONS } from "../settings.js";
import { approvalRow } from "./documents.js";
import { SUBSTITUTE_REASONS, categoryCode } from "./products.js";
export { SUBSTITUTE_REASONS, type SubstituteReason } from "./products.js";
import { actionAllowed } from "./purchasing.js";

/**
 * Sales (phase 3a): quotes and sales orders (Quote, Quotes, SalesOrder, SalesOrderEdit, SalesDialogs boards).
 * Reads are for every signed-in person; writes need documents.sales.edit except releasing a credit hold
 * (credit.release_hold, checked in the service by the hold kind). Money is whole cents; sums are strings.
 */

// ── Shared ──────────────────────────────────────────────────────────────

const version = z.number().int().min(1);
const note = z.string().trim().min(1, "Say why").max(500);
/** The largest amount one input may carry: $100 billion, the posting service's line cap. */
export const MAX_CENTS_INPUT = 10_000_000_000_000;
/** Whole cents, as a number or a string of digits (totals may exceed the safe integer range), never past the cap. */
const centsInput = z.union([
  z.number().int().min(0).max(MAX_CENTS_INPUT),
  z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) <= BigInt(MAX_CENTS_INPUT), "At most $100,000,000,000.00"),
]);

export const ORDER_DISCOUNT_KINDS = ["percent", "amount"] as const;
/** `clearance`: a published clearance item's price (decision 85; sales orders only). */
/** `contract` (A3, D1500): the customer's contract price for the item stood in for the list. */
export const LINE_PRICE_SOURCES = ["price_list", "override", "quote", "clearance", "contract"] as const;
export const LINE_FLOOR_STATUSES = ["ok", "below_floor", "approved"] as const;

/**
 * L5 (D1283): why a line's price was typed under the list price or discounted. Control asks for one on every
 * line under its list price; "other" needs words. Stored on the line, shown in the audit, on the Manager's
 * approval request, in the "Why this price" sentence and in the below-floor report.
 */
export const PRICE_REASONS = [
  "competitor_match",
  "volume_deal",
  "loyal_customer",
  "damaged_or_dated",
  "clear_old_stock",
  "manager_agreed",
  "price_error",
  "other",
] as const;
export type PriceReason = (typeof PRICE_REASONS)[number];
export const PRICE_REASON_LABELS: Record<PriceReason, string> = {
  competitor_match: "Match a competitor",
  volume_deal: "Volume deal",
  loyal_customer: "Loyal customer",
  damaged_or_dated: "Damaged or short-dated",
  clear_old_stock: "Clear old stock",
  manager_agreed: "Agreed with a Manager",
  price_error: "Fix a price error",
  other: "Other",
};
/** "Volume deal", or the words typed with "Other" ("Other: matched the Feb flyer"). */
export function priceReasonText(reason: PriceReason | null | undefined, note?: string | null): string | null {
  if (!reason) return null;
  if (reason === "other") return note?.trim() ? `Other: ${note.trim()}` : "Other";
  return note?.trim() ? `${PRICE_REASON_LABELS[reason]} (${note.trim()})` : PRICE_REASON_LABELS[reason];
}
/** L5 line notes: one for the picker (picking slip, handheld pick), one for the customer (quote, order, invoice). */
export const MAX_LINE_NOTE = 300;
export const MAX_PRICE_REASON_NOTE = 200;

export const shipToRow = z.object({
  id: uuid,
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
  /** Null: no rate of its own; taxed at its state's nexus default (`tax.nexus`, D174). */
  taxRatePpm: z.number().int().nullable(),
  taxStatus: z.enum(["taxable", "exempt"]),
});

const customerRef = z.object({
  id: uuid,
  number: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
});
const storeRef = z.object({ id: uuid, code: z.string(), name: z.string() });
const warehouseRef = z.object({ id: uuid, code: z.string(), name: z.string() });
const terms = z.object({ code: z.string(), label: z.string() });
const docRef = z.object({ id: uuid, number: z.string() });

/** One line as a screen sends it: an id for an existing line, else a new one; a typed price is an override. */
export const salesLineInput = z
  .object({
    id: uuid.optional(),
    productId: uuid,
    quantity: z.number().int().min(1).max(1_000_000),
    unitPriceCents: z.number().int().min(0).nullable().optional(),
    discountBp: z.number().int().min(0).max(10_000).optional(),
    /** Decision 85: true takes the item's clearance price (orders only), false takes the line off it. */
    clearance: z.boolean().optional(),
    /** L5 (D1283): why the price is under the list price; left out keeps the line's own, null clears it. */
    priceReason: z.enum(PRICE_REASONS).nullable().optional(),
    priceReasonNote: z.string().trim().max(MAX_PRICE_REASON_NOTE).nullable().optional(),
    /** L5 (D1286): notes for the picker and for the customer; left out keeps the line's own, null or "" clears. */
    pickerNote: z.string().trim().max(MAX_LINE_NOTE).nullable().optional(),
    customerNote: z.string().trim().max(MAX_LINE_NOTE).nullable().optional(),
  })
  .strict();

const headerFields = {
  storeId: uuid.nullable().optional(),
  requestedDate: day.nullable().optional(),
  customerPo: z.string().trim().max(100).nullable().optional(),
  shipToAddressId: uuid.nullable().optional(),
  warehouseId: uuid.nullable().optional(),
  priceList: z.enum(PRICE_LISTS).optional(),
  termsCode: z.string().trim().min(1).max(32).optional(),
  discountKind: z.enum(ORDER_DISCOUNT_KINDS).nullable().optional(),
  /** Basis points for a percent discount, cents for an amount. */
  discountValue: centsInput.nullable().optional(),
  noteToCustomer: z.string().trim().max(2000).nullable().optional(),
  internalNote: z.string().trim().max(2000).nullable().optional(),
  /** W4: a coupon code (null clears it); refused with the reason when it can't be used. */
  couponCode: z.string().trim().max(40).nullable().optional(),
  /** W4: automatic discounts staff take off, each with a reason; and ones put back. */
  removePromotions: z
    .array(z.object({ promotionId: uuid, reason: z.string().trim().min(1).max(300) }).strict())
    .max(50)
    .optional(),
  restorePromotions: z.array(uuid).max(50).optional(),
};

/** W4: what the discounts gave on a document (frozen on its lines) and those staff took off. */
export const documentPromotions = z.object({
  couponCode: z.string().nullable(),
  /** The promotions' part of the document's discount. */
  discountCents: centsString,
  applied: z.array(
    z.object({
      promotionId: uuid,
      name: z.string(),
      couponCode: z.string().nullable(),
      kind: z.enum(["percent_items", "amount_items", "order_percent", "order_amount", "buy_x_get_y"]),
      level: z.enum(["line", "order"]),
      lineId: uuid,
      amountCents: centsString,
      freeQty: z.number().int(),
      reason: z.string(),
    }),
  ),
  removed: z.array(z.object({ promotionId: uuid, name: z.string(), reason: z.string(), at: z.string() })),
});

const noPromotions = { couponCode: null, discountCents: "0", applied: [], removed: [] };

export const PRICE_TRACE_STEPS = [
  "list",
  "price_list",
  "contract",
  "quote",
  "clearance",
  "override",
  "line_discount",
  "promotion",
  "order_discount",
  "floor",
] as const;
export type PriceTraceStep = (typeof PRICE_TRACE_STEPS)[number];

/**
 * L5 "Why this price" (D1280–D1282): the steps that made a line's price, in order — Standard, the customer's tier,
 * where the price came from (a quote, clearance, a typed price with its reason), the line discount, each promotion,
 * the line's share of the order discount, and the floor — and the sentence Control shows
 * ("Tier 2 $18.40 · Spring promo −$1.84 · floor $15.00 OK"). Floor dollars that reveal the cost only with
 * cost.view.
 */
export const priceTrace = z.object({
  sentence: z.string(),
  steps: z.array(
    z.object({
      step: z.enum(PRICE_TRACE_STEPS),
      text: z.string(),
      /** A unit price (list, tier, typed) or an amount off for the line (discount, promotion, share). */
      cents: z.number().int().nullable(),
      tone: z.enum(["plain", "pos", "warn", "neg"]),
    }),
  ),
});

const baseLineRow = {
  id: uuid,
  lineNo: z.number().int(),
  product: z.object({ id: uuid, sku: z.string(), name: z.string() }),
  quantity: z.number().int(),
  listPriceCents: z.number().int(),
  unitPriceCents: z.number().int(),
  priceSource: z.enum(LINE_PRICE_SOURCES),
  discountBp: z.number().int(),
  lineTotalCents: centsString,
  floorStatus: z.enum(LINE_FLOOR_STATUSES),
  floorReason: z.string().nullable(),
  /** The live price_override request for the line, when one was asked. */
  approval: approvalRow.nullable(),
  /** L5 (D1283): why the price is under the list price. */
  priceReason: z.enum(PRICE_REASONS).nullable().default(null),
  priceReasonNote: z.string().nullable().default(null),
  /** L5 (D1286): the picker's and the customer's notes. */
  pickerNote: z.string().nullable().default(null),
  customerNote: z.string().nullable().default(null),
  /** L5 (D1280): "Why this price", worked out by the server from what priced the line. */
  priceTrace: priceTrace.nullable().default(null),
};

// ── Quotes ──────────────────────────────────────────────────────────────

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "expired", "rejected"] as const;
export const QUOTE_COLUMNS = ["draft", "sent", "accepted", "expired_or_rejected"] as const;
export const QUOTE_SORTS = ["number", "quoteDate", "customer", "status", "expiresOn", "total"] as const;
export const QUOTE_ACTIONS = ["edit", "send", "convert", "accept", "reject", "extend", "delete"] as const;

export const quoteActions = z.object(
  Object.fromEntries(QUOTE_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof QUOTE_ACTIONS)[number],
    typeof actionAllowed
  >,
);

export const quoteLineRow = z.object(baseLineRow);

export const quoteRow = z.object({
  id: uuid,
  number: z.string(),
  revision: z.number().int(),
  customer: customerRef,
  store: storeRef,
  status: z.enum(QUOTE_STATUSES),
  column: z.enum(QUOTE_COLUMNS),
  quoteDate: day,
  expiresOn: day,
  priceList: z.enum(PRICE_LISTS),
  terms,
  shipTo: shipToRow.nullable(),
  /** The customer's sales rep (a quote has none of its own), D264. */
  salesRep: userRef.nullable().default(null),
  warehouse: warehouseRef,
  customerPo: z.string().nullable(),
  requestedDate: day.nullable(),
  discountKind: z.enum(ORDER_DISCOUNT_KINDS).nullable(),
  discountValue: centsString.nullable(),
  noteToCustomer: z.string().nullable(),
  internalNote: z.string().nullable(),
  subtotalCents: centsString,
  discountCents: centsString,
  totalCents: centsString,
  /** D2238: the shipping charge quoted with it (not in its total); the order's freight on conversion. */
  shippingQuoteCents: centsString.nullable().default(null),
  lineCount: z.number().int(),
  unitsQuoted: z.number().int(),
  sentAt: isoTime.nullable(),
  sentCount: z.number().int(),
  acceptedAt: isoTime.nullable(),
  rejectedAt: isoTime.nullable(),
  rejectReason: z.string().nullable(),
  order: docRef.nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
  updatedAt: isoTime.nullable(),
  updatedBy: userRef.nullable(),
});

export const quoteRevisionRow = z.object({
  revision: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
  snapshot: z.unknown(),
});

export const quoteDetail = quoteRow.extend({
  lines: z.array(quoteLineRow),
  revisions: z.array(quoteRevisionRow),
  actions: quoteActions,
  promotions: documentPromotions.default(noPromotions),
});

const idParams = z.object({ id: uuid });

export const listQuotes = route({
  id: "quotes.list",
  method: "GET",
  path: "/v1/quotes",
  access: { self: true },
  query: z.object({
    /** Matches the number, the customer's name or number, or the customer PO. */
    search: z.string().trim().max(100).optional(),
    customerId: uuid.optional(),
    status: z.enum(QUOTE_STATUSES).optional(),
    column: z.enum(QUOTE_COLUMNS).optional(),
    /** The person who created the quote. */
    createdBy: uuid.optional(),
    /** Column-header filters (D282): the quote number, the customer's name or number, and statuses. */
    number: columnSearch,
    customer: columnSearch,
    statuses: csvEnum(QUOTE_STATUSES),
    /** The channel, and the customer's sales rep (D264). */
    storeId: uuid.optional(),
    salesRepId: uuid.optional(),
    from: day.optional(),
    to: day.optional(),
    /** Valid-until dates, inclusive. */
    expiresFrom: day.optional(),
    expiresTo: day.optional(),
    sort: z.enum(QUOTE_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  /** `counts`: All and each status (the board's tabs), with the other filters applied. */
  response: countedPage(quoteRow, ["all", ...QUOTE_STATUSES] as const),
});

export const getQuote = route({
  id: "quotes.get",
  method: "GET",
  path: "/v1/quotes/:id",
  access: { self: true },
  params: idParams,
  response: quoteDetail,
});

const quoteHeaderFields = {
  ...headerFields,
  quoteDate: day.optional(),
  expiresOn: day.nullable().optional(),
};

/** New quote: Q number on this first save; lines priced from the customer's list unless a price is typed. */
export const createQuote = route({
  id: "quotes.create",
  method: "POST",
  path: "/v1/quotes",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  body: z
    .object({
      customerId: uuid,
      ...quoteHeaderFields,
      // D2131: a new draft may start with no lines (the create dialog); confirm/send still need one.
      lines: z.array(salesLineInput).max(500).default([]),
    })
    .strict(),
  response: quoteDetail,
});

/** Edit header and lines (`lines` is the full set). A sent quote keeps its old version; expired or rejected revives. */
export const updateQuote = route({
  id: "quotes.update",
  method: "PATCH",
  path: "/v1/quotes/:id",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({ version, ...quoteHeaderFields, lines: z.array(salesLineInput).max(500).optional() }) // D2131: a draft may hold no lines
    .strict(),
  response: quoteDetail,
});

/** Send or resend. A line under the floor opens a Manager's request and answers 202 waiting_approval. */
export const sendQuote = route({
  id: "quotes.send",
  method: "POST",
  path: "/v1/quotes/:id/send",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version }).strict(),
  response: z.object({
    quote: quoteDetail,
    outcome: z.enum(["sent", "waiting_approval"]),
    warnings: z.array(z.string()),
    approvals: z.array(approvalRow),
  }),
});

export const acceptQuote = route({
  id: "quotes.accept",
  method: "POST",
  path: "/v1/quotes/:id/accept",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: quoteDetail,
});

export const rejectQuote = route({
  id: "quotes.reject",
  method: "POST",
  path: "/v1/quotes/:id/reject",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, reason: note }).strict(),
  response: quoteDetail,
});

export const extendQuote = route({
  id: "quotes.extend",
  method: "POST",
  path: "/v1/quotes/:id/extend",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, expiresOn: day }).strict(),
  response: quoteDetail,
});

export const deleteQuote = route({
  id: "quotes.delete",
  method: "DELETE",
  path: "/v1/quotes/:id",
  access: { permission: "documents.sales.edit" },
  params: idParams,
  query: z.object({ version: z.coerce.number().int().min(1) }),
  noContent: true,
});

// ── Sales orders ────────────────────────────────────────────────────────

export const SO_STATUSES = ["draft", "submitted", "confirmed", "closed", "cancelled"] as const;
export const SO_FULFILMENT_STATUSES = ["not_released", "released", "part_shipped", "shipped"] as const;
export const SO_BILLING_STATUSES = ["not_billed", "part_billed", "billed"] as const;
export const SO_PAYMENT_STATUSES = ["unpaid", "processing", "part_paid", "paid"] as const;
/** counter (phase 5): a trade counter sale. */
/** Phase 6 adds `opening`: an order paid but not shipped at cut-over. */
/** Numbering and legacy §B adds `legacy_website`: an old website order kept as a closed, locked document. */
export const SO_SOURCES = [
  "manual",
  "quote",
  "portal",
  "website",
  "counter",
  "opening",
  "legacy_website",
] as const;
/** The channels the Sales orders list filters by: desk (manual and quote orders), portal, website, counter. */
export const SO_CHANNELS = ["desk", "portal", "website", "counter"] as const;
export const SO_HOLDS = ["credit", "manual", "tax", "stock"] as const;
export const SO_COLUMNS = [
  "draft",
  "submitted",
  "confirmed",
  "on_hold",
  "part_shipped",
  "closed",
  "cancelled",
] as const;
/** The reasons a person picks when cancelling. */
export const SO_CANCEL_REASONS = [
  "customer_cancelled",
  "out_of_stock",
  "duplicate_order",
  "credit_not_approved",
  "not_paid",
] as const;
/** Every reason an order can carry: a person's, and the system's no_reply (phase 5, row 39). */
export const SO_ALL_CANCEL_REASONS = [...SO_CANCEL_REASONS, "no_reply"] as const;
export const SO_SORTS = [
  "number",
  "orderDate",
  "customer",
  "status",
  "fulfilment",
  "billing",
  "payment",
  "total",
] as const;
export const SO_ACTIONS = [
  "edit",
  "confirm",
  "delete",
  "cancel",
  "hold",
  "releaseHold",
  "createDelivery",
  "createInvoice",
  "paymentLink",
] as const;

export const soActions = z.object(
  Object.fromEntries(SO_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof SO_ACTIONS)[number],
    typeof actionAllowed
  >,
);

export const soLineRow = z.object({
  ...baseLineRow,
  cancelledQty: z.number().int(),
  reservedQty: z.number().int(),
  shippedQty: z.number().int(),
  invoicedQty: z.number().int(),
  openQty: z.number().int(),
  backorderQty: z.number().int(),
  discountShareCents: centsString,
  taxCents: centsString,
});

export const creditCheckRow = z.object({
  limitCents: centsString,
  openArCents: centsString,
  overdueCents: centsString,
  oldestOverdueDays: z.number().int(),
  overdueHoldDays: z.number().int(),
  uninvoicedOrdersCents: centsString,
  thisOrderCents: centsString,
  exposureCents: centsString,
  overByCents: centsString,
  passed: z.boolean(),
  prepaymentRequired: z.boolean(),
  reason: z.string().nullable(),
  checkedAt: isoTime,
});

export const taxCalcRow = z.object({
  provider: z.string(),
  /**
   * Null when the tax isn't one rate of ours: a website order carries the tax WooCommerce charged at checkout
   * (phase 6 slice 16), shown with Woo's own tax lines instead of a percent.
   */
  ratePpm: z.number().int().nullable(),
  taxCents: centsString,
  freightTaxCents: centsString,
  reference: z.string().nullable(),
  calculatedAt: isoTime,
  /** The channel's own tax lines (WooCommerce: label, its percent as given, tax on goods and shipping). */
  lines: z
    .array(z.object({ label: z.string(), ratePercent: z.string().nullable(), taxCents: centsString }))
    .optional(),
});

export const linkedDocumentRow = z.object({
  id: uuid,
  number: z.string().nullable(),
  status: z.string(),
  /** Sales visual slice 2 (D2060): an invoice's invoice date or a payment's payment date (the tracker's dates). */
  date: day.nullable().default(null),
  /** A delivery's packed and shipped times (the tracker's Picked and Shipped dates); null for other kinds. */
  packedAt: isoTime.nullable().default(null),
  shippedAt: isoTime.nullable().default(null),
});

/** A legacy website order or invoice: its migration source key and the opening document carrying its balance. */
export const legacyLinkRow = z.object({
  sourceKey: z.string(),
  carriedBy: z
    .object({ type: z.string(), id: uuid, number: z.string().nullable(), amountCents: centsString })
    .nullable(),
  historyOrderId: uuid.nullable(),
});

export const soRow = z.object({
  id: uuid,
  number: z.string(),
  /** admin-w6 (D651): the method from Settings › Shipping methods, when one was chosen. */
  shippingMethod: z.object({ id: uuid, name: z.string(), kind: z.string() }).nullable().default(null),
  /** Staff typed the freight: the method's charge and free-over threshold don't set it. */
  freightManual: z.boolean().default(false),
  customer: customerRef,
  store: storeRef,
  /** The order's sales rep, D264. */
  salesRep: userRef.nullable().default(null),
  quote: docRef.nullable(),
  source: z.enum(SO_SOURCES),
  status: z.enum(SO_STATUSES),
  fulfilmentStatus: z.enum(SO_FULFILMENT_STATUSES),
  billingStatus: z.enum(SO_BILLING_STATUSES),
  paymentStatus: z.enum(SO_PAYMENT_STATUSES),
  holds: z.array(z.enum(SO_HOLDS)),
  column: z.enum(SO_COLUMNS),
  orderDate: day,
  requestedDate: day.nullable(),
  customerPo: z.string().nullable(),
  /** Phase 5: the channel's own number, "#1004046" for a website order ("Website order #1004046"). */
  externalRef: z.string().nullable().default(null),
  shipTo: shipToRow.nullable(),
  warehouse: warehouseRef,
  priceList: z.enum(PRICE_LISTS),
  terms,
  prepaymentRequired: z.boolean(),
  discountKind: z.enum(ORDER_DISCOUNT_KINDS).nullable(),
  discountValue: centsString.nullable(),
  noteToCustomer: z.string().nullable(),
  internalNote: z.string().nullable(),
  subtotalCents: centsString,
  discountCents: centsString,
  freightCents: centsString,
  taxCents: centsString,
  totalCents: centsString,
  lineCount: z.number().int(),
  unitsOrdered: z.number().int(),
  unitsReserved: z.number().int(),
  unitsShipped: z.number().int(),
  confirmedAt: isoTime.nullable(),
  confirmedBy: userRef.nullable(),
  holdReason: z.string().nullable(),
  holdCreditAt: isoTime.nullable(),
  holdReleasedAt: isoTime.nullable(),
  holdReleasedBy: userRef.nullable(),
  holdReleaseNote: z.string().nullable(),
  reservationExpiresAt: isoTime.nullable(),
  reservationsReleasedAt: isoTime.nullable(),
  cancelReason: z.enum(SO_ALL_CANCEL_REASONS).nullable(),
  cancelNote: z.string().nullable(),
  cancelledAt: isoTime.nullable(),
  cancelledBy: userRef.nullable(),
  closedAt: isoTime.nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
  updatedAt: isoTime.nullable(),
  updatedBy: userRef.nullable(),
});

export const soDetail = soRow.extend({
  lines: z.array(soLineRow),
  creditCheck: creditCheckRow.nullable(),
  taxCalc: taxCalcRow.nullable(),
  linked: z.object({
    deliveries: z.array(linkedDocumentRow),
    invoices: z.array(linkedDocumentRow),
    payments: z.array(linkedDocumentRow),
  }),
  actions: soActions,
  legacy: legacyLinkRow.nullable().default(null),
  promotions: documentPromotions.default(noPromotions),
});

export const listSalesOrders = route({
  id: "sales_orders.list",
  method: "GET",
  path: "/v1/sales-orders",
  access: { self: true },
  query: z.object({
    search: z.string().trim().max(100).optional(),
    customerId: uuid.optional(),
    status: z.enum(SO_STATUSES).optional(),
    column: z.enum(SO_COLUMNS).optional(),
    onHold: z
      .enum(["true", "false", "1", "0"])
      .transform((v) => v === "true" || v === "1")
      .optional(),
    source: z.enum(SO_SOURCES).optional(),
    /** Phase 5 slice 12: the channel; desk is the manual and quote orders together. */
    channel: z.enum(SO_CHANNELS).optional(),
    /** Column-header filters (D282): the order number, the customer's name or number, and board columns. */
    number: columnSearch,
    customer: columnSearch,
    statuses: csvEnum(SO_COLUMNS),
    /** The channel, and the order's sales rep (D264). */
    storeId: uuid.optional(),
    salesRepId: uuid.optional(),
    from: day.optional(),
    to: day.optional(),
    sort: z.enum(SO_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(soRow),
});

export const getSalesOrder = route({
  id: "sales_orders.get",
  method: "GET",
  path: "/v1/sales-orders/:id",
  access: { self: true },
  params: idParams,
  response: soDetail,
});

const orderHeaderFields = {
  ...headerFields,
  orderDate: day.optional(),
  freightCents: centsInput.nullable().optional(),
  /** admin-w6 (D651): a shipping method; its charge sets the freight unless freight is typed. */
  shippingMethodId: uuid.nullable().optional(),
};

/** New order: SO number on this first save; Draft (a portal order arrives Submitted). */
export const createSalesOrder = route({
  id: "sales_orders.create",
  method: "POST",
  path: "/v1/sales-orders",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  body: z
    .object({
      customerId: uuid,
      source: z.enum(["manual", "portal", "website"]).optional(),
      ...orderHeaderFields,
      // D2131: a new draft may start with no lines (the create dialog); confirm/send still need one.
      lines: z.array(salesLineInput).max(500).default([]),
    })
    .strict(),
  response: soDetail,
});

/** Convert a quote into an order at the quoted prices; freight and tax are added on the order. */
export const convertQuote = route({
  id: "quotes.convert",
  method: "POST",
  path: "/v1/quotes/:id/convert",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, ...orderHeaderFields }).strict(),
  response: soDetail,
});

/**
 * Edit header and lines (`lines` is the full set). A confirmed order re-runs the floor, tax, credit check and
 * reservations on its unshipped lines; shipped or invoiced lines keep their price and can't go below shipped.
 */
export const updateSalesOrder = route({
  id: "sales_orders.update",
  method: "PATCH",
  path: "/v1/sales-orders/:id",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({ version, ...orderHeaderFields, lines: z.array(salesLineInput).max(500).optional() }) // D2131: a draft may hold no lines
    .strict(),
  response: soDetail,
});

/**
 * Confirm: every line priced, floor (a line under it waits for a Manager: 202 waiting_approval), tax (fails
 * closed with 503 tax_unavailable), credit check, reservations. A failed credit check confirms on credit
 * hold (`on_hold`). A portal order is invoiced here.
 */
export const confirmSalesOrder = route({
  id: "sales_orders.confirm",
  method: "POST",
  path: "/v1/sales-orders/:id/confirm",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version }).strict(),
  response: z.object({
    order: soDetail,
    outcome: z.enum(["confirmed", "on_hold", "waiting_approval"]),
    warnings: z.array(z.string()),
    approvals: z.array(approvalRow),
    invoice: docRef.nullable(),
  }),
});

export const cancelSalesOrder = route({
  id: "sales_orders.cancel",
  method: "POST",
  path: "/v1/sales-orders/:id/cancel",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      version,
      reason: z.enum(SO_CANCEL_REASONS),
      note,
      /** Defaults to true once the order was confirmed. */
      emailCustomer: z.boolean().optional(),
    })
    .strict(),
  response: soDetail,
});

/** Put a confirmed order on manual hold. */
export const holdSalesOrder = route({
  id: "sales_orders.hold",
  method: "POST",
  path: "/v1/sales-orders/:id/hold",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, note }).strict(),
  response: soDetail,
});

/** Release one hold with a note: a credit hold needs credit.release_hold (checked by the service), a manual one documents.sales.edit. */
export const releaseSalesOrderHold = route({
  id: "sales_orders.release_hold",
  method: "POST",
  path: "/v1/sales-orders/:id/release-hold",
  access: { permission: ["credit.release_hold", "documents.sales.edit"] },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, hold: z.enum(SO_HOLDS), note }).strict(),
  response: soDetail,
});

/** Delete a draft or submitted order that was never confirmed; anything else answers 409 use_cancel. */
export const deleteSalesOrder = route({
  id: "sales_orders.delete",
  method: "DELETE",
  path: "/v1/sales-orders/:id",
  access: { permission: "documents.sales.edit" },
  params: idParams,
  query: z.object({ version: z.coerce.number().int().min(1) }),
  noContent: true,
});

/**
 * A3 "Duplicate" (D1503): a new draft for the same customer with the order's open lines (item and quantity), priced
 * again today by the server (contract, tier, floor), the header's terms, ship-to, rep and notes carried over; no
 * dates, PO or discounts. Opens in the editor.
 */
export const duplicateSalesOrder = route({
  id: "sales_orders.duplicate",
  method: "POST",
  path: "/v1/sales-orders/:id/duplicate",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  status: 201,
  params: idParams,
  response: soDetail,
});

// ── Deliveries (slice B) ────────────────────────────────────────────────

export const DELIVERY_STATUSES = [
  "to_release",
  "picking",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
] as const;
/** The Deliveries board's tabs: the stages, and Exceptions (not yet shipped, with a line picked short). */
export const DELIVERY_VIEWS = [
  "to_release",
  "picking",
  "packed",
  "shipped",
  "delivered",
  "exceptions",
] as const;
export const DELIVERY_SHORT_REASONS = ["not_in_bin", "damaged_in_bin", "promised_elsewhere"] as const;
export const DELIVERY_SORTS = ["number", "created", "customer", "status", "shipped"] as const;
export const DELIVERY_ACTIONS = [
  "release",
  "pick",
  "pack",
  "unpack",
  "buyLabel",
  "dispatch",
  "markDelivered",
  "cancel",
  "split",
] as const;

export const deliveryActions = z.object(
  Object.fromEntries(DELIVERY_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof DELIVERY_ACTIONS)[number],
    typeof actionAllowed
  >,
);

/** Units of one delivery line in a box. */
export const boxContent = z.object({ lineId: uuid, qty: z.number().int().min(1) }).strict();

export const boxInput = z
  .object({
    weightGrams: z.number().int().min(1),
    /** Centimetres to two decimals (EasyPost D2183: inches typed on the floor keep their precision). */
    lengthCm: z.number().min(0.25).max(500).optional(),
    widthCm: z.number().min(0.25).max(500).optional(),
    heightCm: z.number().min(0.25).max(500).optional(),
    /** What the box holds (the packing slip's "Packed in"); when any box says, every picked unit is in one. */
    contents: z.array(boxContent).max(500).optional(),
  })
  .strict();

export const labelRow = z.object({
  provider: z.string(),
  trackingNumber: z.string(),
  labelUrl: z.string(),
  costCents: z.number().int(),
  reference: z.string(),
  boughtAt: isoTime,
  voidedAt: isoTime.nullable(),
  /** One entry per box, when the carrier returned more than one label. */
  labels: z.array(z.object({ trackingNumber: z.string(), labelUrl: z.string() }).strict()).optional(),
  // ── EasyPost (D2180–D2229); absent on labels bought before it ──
  /** The carrier and service as EasyPost names them, and in words ("UPS Ground Saver"). */
  carrier: z.string().optional(),
  service: z.string().optional(),
  serviceLabel: z.string().optional(),
  format: z.enum(LABEL_FORMATS).optional(),
  /** Each parcel's label, tracker and public tracking page. */
  parcels: z
    .array(
      z.object({
        shipmentId: z.string(),
        trackingNumber: z.string(),
        labelUrl: z.string(),
        zplUrl: z.string().nullable().optional(),
        trackerId: z.string().nullable().optional(),
        publicUrl: z.string().nullable().optional(),
      }),
    )
    .optional(),
  insuranceCents: z.number().int().nullable().optional(),
  signature: z.enum(SIGNATURE_OPTIONS).optional(),
  /** The customer was charged the label's cost as the order's freight ("Charge actual"). */
  chargedActual: z.boolean().optional(),
  /** The carrier's refund of a voided label: submitted → refunded or rejected. */
  refundStatus: z.enum(["submitted", "refunded", "rejected", "not_applicable"]).nullable().optional(),
  refundCheckedAt: isoTime.nullable().optional(),
  voidedBy: userRef.nullable().optional(),
  /**
   * Labels bought here for a second package of a delivery the website already labelled (D2217, "Buy another
   * label"): each with its own tracking, cost and void state.
   */
  extraLabels: z
    .array(
      z.object({
        provider: z.string(),
        trackingNumber: z.string(),
        labelUrl: z.string(),
        costCents: z.number().int(),
        reference: z.string(),
        serviceLabel: z.string().optional(),
        boughtAt: isoTime,
        voidedAt: isoTime.nullable(),
        refundStatus: z.enum(["submitted", "refunded", "rejected", "not_applicable"]).nullable().optional(),
      }),
    )
    .optional(),
  /** Said when part of the purchase didn't take (insurance, charge actual); the label stands. */
  warning: z.string().nullable().optional(),
  /** "erp" (bought here) or "website" (WooCommerce Shipping bought it, D2215). */
  origin: z.enum(["erp", "website"]).optional(),
  /** Website labels: every label the order carries, refunded ones too. */
  websiteLabels: z
    .array(
      z.object({
        labelId: z.string(),
        trackingNumber: z.string(),
        carrier: z.string().nullable(),
        service: z.string().nullable(),
        status: z.string(),
        costCents: z.number().int(),
        createdAt: isoTime.nullable(),
        isReturn: z.boolean(),
        packageName: z.string().nullable(),
      }),
    )
    .optional(),
});

export const TRACKING_STATUSES = [
  "unknown",
  "pre_transit",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "available_for_pickup",
  "return_to_sender",
  "failure",
  "cancelled",
  "error",
] as const;

/** One carrier tracker of a delivery or a return (EasyPost D2190), with its scans oldest first. */
export const trackerRow = z.object({
  id: uuid,
  trackingCode: z.string(),
  carrier: z.string().nullable(),
  status: z.string(),
  statusDetail: z.string().nullable(),
  publicUrl: z.string().nullable(),
  estDeliveryAt: isoTime.nullable(),
  checkedAt: isoTime.nullable(),
  source: z.string(),
  events: z.array(
    z.object({
      at: isoTime,
      status: z.string(),
      message: z.string(),
      location: z.string().nullable(),
    }),
  ),
});

export const deliveryLineRow = z.object({
  id: uuid,
  lineNo: z.number().int(),
  orderLineId: uuid,
  /** The brand, UPC and photo are for the pick list (PickPack, HPick): scan and recognise the item. */
  product: z.object({
    id: uuid,
    sku: z.string(),
    name: z.string(),
    brand: z.string().nullable().optional(),
    upc: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
  }),
  quantity: z.number().int(),
  pickedQty: z.number().int(),
  shortQty: z.number().int(),
  shortReason: z.enum(DELIVERY_SHORT_REASONS).nullable(),
  bin: z.object({ id: uuid, code: z.string() }).nullable(),
  shippedQty: z.number().int(),
  /** Only with cost.view. */
  valueCents: centsString.optional(),
  /** L5 (D1286): the order line's note for the picker. */
  pickerNote: z.string().nullable().default(null),
});

export const deliveryRow = z.object({
  id: uuid,
  number: z.string(),
  order: docRef,
  customer: z.object({ id: uuid, number: z.string(), displayName: z.string() }),
  warehouse: warehouseRef,
  status: z.enum(DELIVERY_STATUSES),
  shipTo: z.unknown(),
  carrierService: z.string().nullable(),
  boxes: z.array(boxInput).nullable(),
  weightGrams: z.number().int().nullable(),
  label: labelRow.nullable(),
  trackingNumber: z.string().nullable(),
  /** EasyPost (D2190): the carrier's state of the slowest parcel, its public page, when it last changed. */
  trackingStatus: z.string().nullable().default(null),
  trackingUrl: z.string().nullable().default(null),
  trackingUpdatedAt: isoTime.nullable().default(null),
  lineCount: z.number().int(),
  unitsToShip: z.number().int(),
  unitsPicked: z.number().int(),
  unitsShipped: z.number().int(),
  releasedAt: isoTime.nullable(),
  releasedBy: userRef.nullable(),
  packedAt: isoTime.nullable(),
  packedBy: userRef.nullable(),
  shippedAt: isoTime.nullable(),
  shippedBy: userRef.nullable(),
  shipDate: day.nullable(),
  deliveredAt: isoTime.nullable(),
  deliveredBy: userRef.nullable(),
  cancelledAt: isoTime.nullable(),
  cancelledBy: userRef.nullable(),
  cancelNote: z.string().nullable(),
  journal: docRef.nullable(),
  invoice: z.object({ id: uuid, number: z.string().nullable() }).nullable(),
  /** Only with cost.view. */
  cogsCents: centsString.optional(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
  updatedAt: isoTime.nullable(),
  updatedBy: userRef.nullable(),
});

export const deliveryDetail = deliveryRow.extend({
  lines: z.array(deliveryLineRow),
  actions: deliveryActions,
  /**
   * U7 Find an order: who picked last and when (the newest `delivery.picked` in the delivery's audit trail);
   * null before the first pick. Read on the detail only, never on lists.
   */
  pickedBy: userRef.nullable().default(null),
  pickedAt: isoTime.nullable().default(null),
  /** EasyPost (D2190): each parcel's tracker and scans (the delivery page's tracking timeline). */
  trackers: z.array(trackerRow).default([]),
  /** EasyPost (D2182): where the label ships from (the warehouse's ship-from, else the company address). */
  shipFrom: z.unknown().optional(),
  /** D2231: the ship-from was changed for this shipment only (with the reason); null: the warehouse's. */
  shipFromOverride: z
    .object({ reason: z.string().nullable(), by: z.string().nullable(), at: isoTime })
    .nullable()
    .default(null),
});

export const listDeliveries = route({
  id: "deliveries.list",
  method: "GET",
  path: "/v1/deliveries",
  access: { self: true },
  query: z.object({
    /** Matches the delivery or order number, the customer's name or the tracking number. */
    search: z.string().trim().max(100).optional(),
    orderId: uuid.optional(),
    customerId: uuid.optional(),
    status: z.enum(DELIVERY_STATUSES).optional(),
    /** One of the board's tabs. */
    view: z.enum(DELIVERY_VIEWS).optional(),
    from: day.optional(),
    to: day.optional(),
    sort: z.enum(DELIVERY_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  /** `counts`: All and each tab, with the other filters applied. */
  response: countedPage(deliveryRow, ["all", ...DELIVERY_VIEWS] as const),
});

export const QUEUE_STAGES = ["to_release", "to_pick", "to_pack", "packed"] as const;

/** The pick and pack queue (PickPack board): open deliveries of un-held orders, and what waits on Finance. */
export const pickPackQueue = route({
  id: "deliveries.queue",
  method: "GET",
  path: "/v1/deliveries/pick-pack-queue",
  access: { self: true },
  query: z.object({ warehouseId: uuid.optional() }),
  response: z.object({
    warehouse: warehouseRef.nullable(),
    items: z.array(
      deliveryRow.extend({
        stage: z.enum(QUEUE_STAGES),
        shipBy: day.nullable(),
        secondShipment: z.boolean(),
      }),
    ),
    waiting: z.array(
      z.object({
        order: docRef,
        customer: z.object({ id: uuid, displayName: z.string() }),
        holds: z.array(z.string()),
        holdReason: z.string().nullable(),
        delivery: docRef.nullable(),
      }),
    ),
    counts: z.object({
      toPick: z.number().int(),
      toPack: z.number().int(),
      packed: z.number().int(),
      waiting: z.number().int(),
    }),
  }),
});

export const getDelivery = route({
  id: "deliveries.get",
  method: "GET",
  path: "/v1/deliveries/:id",
  access: { self: true },
  params: idParams,
  response: deliveryDetail,
});

/** Create a delivery from a confirmed, un-held order for its reserved units still to ship (a subset when given). */
export const createDelivery = route({
  id: "deliveries.create",
  method: "POST",
  path: "/v1/sales-orders/:id/deliveries",
  access: { permission: ["documents.sales.edit", "stock.move"] },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      orderVersion: version.optional(),
      lines: z
        .array(z.object({ orderLineId: uuid, quantity: z.number().int().min(1) }).strict())
        .min(1)
        .optional(),
      carrierService: z.string().trim().max(100).nullable().optional(),
    })
    .strict()
    .optional(),
  response: deliveryDetail,
});

/**
 * A3 "Split shipment" (D1504): before picking starts, part of a delivery (lines and quantities) moves to a new
 * delivery of the same order; the order's reservations are untouched (they live on the order lines), only the
 * delivery-line links move. Leaving nothing on the first, or taking nothing, is refused.
 */
export const splitDelivery = route({
  id: "deliveries.split",
  method: "POST",
  path: "/v1/deliveries/:id/split",
  access: { permission: "stock.move" },
  idempotency: "required",
  status: 201,
  params: idParams,
  body: z
    .object({
      version,
      lines: z.array(z.object({ lineId: uuid, quantity: z.number().int().min(1) }).strict()).min(1),
    })
    .strict(),
  response: z.object({ source: deliveryDetail, made: deliveryDetail }),
});

export const releaseDelivery = route({
  id: "deliveries.release",
  method: "POST",
  path: "/v1/deliveries/:id/release",
  access: { permission: "stock.move" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: deliveryDetail,
});

/** Pick per line; a short needs a reason and gives the short units' reservation back to the warehouse. */
export const pickDelivery = route({
  id: "deliveries.pick",
  method: "POST",
  path: "/v1/deliveries/:id/pick",
  access: { permission: "stock.move" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      lines: z
        .array(
          z
            .object({
              lineId: uuid,
              pickedQty: z.number().int().min(0),
              binId: uuid.nullable().optional(),
              shortQty: z.number().int().min(0).optional(),
              shortReason: z.enum(DELIVERY_SHORT_REASONS).nullable().optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  response: deliveryDetail,
});

export const packDelivery = route({
  id: "deliveries.pack",
  method: "POST",
  path: "/v1/deliveries/:id/pack",
  access: { permission: "stock.move" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      boxes: z.array(boxInput).min(1),
      carrierService: z.string().trim().max(100).nullable().optional(),
    })
    .strict(),
  response: deliveryDetail,
});

export const unpackDelivery = route({
  id: "deliveries.unpack",
  method: "POST",
  path: "/v1/deliveries/:id/unpack",
  access: { permission: "stock.move" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: deliveryDetail,
});

export const RATE_BADGES = ["cheapest", "fastest", "best_value", "preferred"] as const;

/** One buyable rate (EasyPost D2187: every connected carrier, friendly names, badges, the delta to the cheapest). */
export const labelRate = z.object({
  label: z.string(),
  amountCents: z.number().int(),
  days: z.number().int().nullable(),
  shipmentId: z.string(),
  carrier: z.string(),
  serviceCode: z.string(),
  /** "UPS" for UPSDAP, "FedEx" for FedExDefault. */
  carrierLabel: z.string().default(""),
  badges: z.array(z.enum(RATE_BADGES)).default([]),
  /** Above the cheapest, cents (0 for the cheapest). */
  deltaCents: z.number().int().default(0),
  /** The rate's own id at EasyPost (bought by id). */
  rateId: z.string().nullable().default(null),
});

/**
 * Live rates for a packed delivery from every connected carrier, cheapest first. Nothing is bought. `testMode`
 * means the label is a sample; `hidden` lists carriers that can't serve this route (shown as a note, not an error).
 */
export const deliveryLabelRates = route({
  id: "deliveries.label_rates",
  method: "GET",
  path: "/v1/deliveries/:id/label-rates",
  access: { permission: "stock.move" },
  params: idParams,
  query: z.object({
    signature: z.enum(SIGNATURE_OPTIONS).optional(),
    /** JSON of other boxes to rate (an additional label, D2217); the delivery's own boxes otherwise. */
    boxes: z
      .string()
      .max(4000)
      .transform((v, ctx) => {
        try {
          return z.array(boxInput).min(1).max(20).parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "boxes must be a JSON list of boxes" });
          return z.NEVER;
        }
      })
      .optional(),
  }),
  response: z.object({
    testMode: z.boolean(),
    rates: z.array(labelRate),
    hidden: z.array(z.object({ carrier: z.string(), reason: z.string() })).default([]),
  }),
});

/** Buy a label from the carrier: label data on the delivery, never dispatch. */
export const buyDeliveryLabel = route({
  id: "deliveries.label",
  method: "POST",
  path: "/v1/deliveries/:id/label",
  access: { permission: "stock.move" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      version,
      carrierService: z.string().trim().max(100).nullable().optional(),
      /** The quote the screen showed. Together these buy that rate instead of quoting again. */
      shipmentId: z.string().trim().max(100).optional(),
      carrier: z.string().trim().max(40).optional(),
      serviceCode: z.string().trim().max(60).optional(),
      /** EasyPost (D2188): the rate the confirm dialog showed; a different price at purchase is refused. */
      expectedCents: z.number().int().min(0).optional(),
      /** Declared value to insure, cents (EasyPost insurance); none when absent. */
      insuranceCents: z.number().int().min(100).max(500_000_00).optional(),
      signature: z.enum(SIGNATURE_OPTIONS).optional(),
      /** Set the order's freight to the label's cost (only before the order is invoiced). */
      chargeActual: z.boolean().optional(),
      /** A second package's label on a delivery the website already labelled (D2217). */
      additional: z.boolean().optional(),
      /** The additional label's own boxes (the delivery's boxes otherwise). */
      boxes: z.array(boxInput).min(1).max(20).optional(),
    })
    .strict(),
  response: deliveryDetail,
});

/** Confirm dispatch: stock out, cost of goods, the invoice (slice C), the tracking email, in one transaction. */
export const dispatchDelivery = route({
  id: "deliveries.dispatch",
  method: "POST",
  path: "/v1/deliveries/:id/dispatch",
  access: { permission: "stock.move" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, shipDate: day.optional() }).strict(),
  response: z.object({
    delivery: deliveryDetail,
    journal: docRef.nullable(),
    invoice: docRef.nullable(),
    replayed: z.boolean(),
  }),
});

export const markDeliveryDelivered = route({
  id: "deliveries.delivered",
  method: "POST",
  path: "/v1/deliveries/:id/delivered",
  access: { permission: "stock.move" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: deliveryDetail,
});

export const cancelDelivery = route({
  id: "deliveries.cancel",
  method: "POST",
  path: "/v1/deliveries/:id/cancel",
  access: { permission: "stock.move" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, note }).strict(),
  response: deliveryDetail,
});

// ── Invoices (slice C) ──────────────────────────────────────────────────

/** `legacy`: an old website invoice, history only (never posted, outside every balance). */
export const INVOICE_STATUSES = ["draft", "posted", "voided", "legacy"] as const;
/** Credited: nothing open, nothing paid, settled by credit notes (phase 4 review fix 8). */
export const INVOICE_PAYMENT_STATUSES = ["unpaid", "part_paid", "paid", "credited"] as const;
/** channel (phase 5): a website order captured with WooCommerce's amounts. */
/** Phase 6 adds `opening`: an open item at cut-over. */
export const INVOICE_SOURCES = [
  "dispatch",
  "confirm",
  "manual",
  "channel",
  "opening",
  "legacy_website",
] as const;
export const INVOICE_COLUMNS = ["draft", "posted_unpaid", "part_paid", "paid", "voided", "legacy"] as const;
/**
 * The Invoices board's tabs (decision 87): Unpaid (posted with a balance), Overdue, Paid (in full, by money),
 * Draft, Credited (settled by credit notes), Website orders, and Legacy; All is no view.
 */
export const INVOICE_VIEWS = [
  "open",
  "overdue",
  "paid_in_full",
  "draft",
  "credited",
  "website",
  "legacy",
] as const;
/** The Invoices list's tab counts: All, each column (Legacy included), Overdue, and each board view. */
export const INVOICE_TABS = [
  "all",
  ...INVOICE_COLUMNS,
  "overdue",
  "open",
  "paid_in_full",
  "credited",
  "website",
] as const;
export const INVOICE_SORTS = [
  "number",
  "invoiceDate",
  "dueDate",
  "customer",
  "status",
  "total",
  "balance",
] as const;
export const INVOICE_ACTIONS = ["void", "recordPayment", "paymentLink", "reminders"] as const;

export const invoiceActions = z.object(
  Object.fromEntries(INVOICE_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof INVOICE_ACTIONS)[number],
    typeof actionAllowed
  >,
);

export const invoiceLineRow = z.object({
  id: uuid,
  lineNo: z.number().int(),
  orderLineId: uuid,
  deliveryLineId: uuid.nullable(),
  product: z.object({ id: uuid, sku: z.string(), name: z.string() }),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  discountBp: z.number().int(),
  lineTotalCents: centsString,
  discountShareCents: centsString,
  taxCents: centsString,
  /** cost.view only: the cost of these units when they shipped; null while nothing has shipped. */
  costCents: centsString.nullable().optional(),
});

export const invoicePaymentRow = z.object({
  id: uuid,
  number: z.string().nullable(),
  status: z.string(),
  amountCents: centsString,
});

export const invoiceRow = z.object({
  id: uuid,
  number: z.string().nullable(),
  customer: customerRef,
  order: docRef,
  delivery: docRef.nullable(),
  store: storeRef,
  /** The invoice's sales rep (its order's), D264. */
  salesRep: userRef.nullable().default(null),
  source: z.enum(INVOICE_SOURCES),
  status: z.enum(INVOICE_STATUSES),
  paymentStatus: z.enum(INVOICE_PAYMENT_STATUSES),
  column: z.enum(INVOICE_COLUMNS),
  overdue: z.boolean(),
  daysOverdue: z.number().int(),
  invoiceDate: day,
  dueDate: day,
  terms,
  salesEvent: z.string(),
  /** Phase 5: the channel's own number, "#1004046" for a website order. */
  externalRef: z.string().nullable().default(null),
  billTo: z.unknown(),
  shipTo: z.unknown(),
  subtotalCents: centsString,
  discountCents: centsString,
  freightCents: centsString,
  taxCents: centsString,
  totalCents: centsString,
  paidCents: centsString,
  /** A2 (D1203): written off as bad debt (less what was recovered); balance = total − paid − credited − this. */
  writtenOffCents: centsString.default("0"),
  balanceCents: centsString,
  /** Ez #24: staff paused the reminders; opening invoices start paused. */
  remindersPaused: z.boolean().default(false),
  lineCount: z.number().int(),
  units: z.number().int(),
  journal: docRef.nullable(),
  voidJournal: docRef.nullable(),
  postedAt: isoTime.nullable(),
  postedBy: userRef.nullable(),
  voidedAt: isoTime.nullable(),
  voidedBy: userRef.nullable(),
  voidReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  updatedAt: isoTime.nullable(),
});

export const invoiceDetail = invoiceRow.extend({
  lines: z.array(invoiceLineRow),
  taxCalc: z.unknown(),
  payments: z.array(invoicePaymentRow),
  actions: invoiceActions,
  legacy: legacyLinkRow.nullable().default(null),
});

export const listInvoices = route({
  id: "invoices.list",
  method: "GET",
  path: "/v1/invoices",
  access: { self: true },
  query: z.object({
    /** Matches the invoice or order number, or the customer's name or number. */
    search: z.string().trim().max(100).optional(),
    customerId: uuid.optional(),
    orderId: uuid.optional(),
    status: z.enum(INVOICE_STATUSES).optional(),
    paymentStatus: z.enum(INVOICE_PAYMENT_STATUSES).optional(),
    /** The board's columns; "paid" is Paid or credited. */
    column: z.enum(INVOICE_COLUMNS).optional(),
    /** The board's tabs (decision 87); left out, every invoice (All). */
    view: z.enum(INVOICE_VIEWS).optional(),
    /** Column-header filters (D282): the invoice number, the customer's name or number, and board columns. */
    number: columnSearch,
    customer: columnSearch,
    statuses: csvEnum(INVOICE_COLUMNS),
    overdue: z
      .enum(["true", "false", "1", "0"])
      .transform((v) => v === "true" || v === "1")
      .optional(),
    from: day.optional(),
    to: day.optional(),
    /** Due dates, inclusive (the board's "Due" chip). */
    dueFrom: day.optional(),
    dueTo: day.optional(),
    /** The channel. */
    storeId: uuid.optional(),
    salesRepId: uuid.optional(),
    /** Balance between these cents, inclusive. */
    balanceMin: z.coerce.number().int().min(0).optional(),
    balanceMax: z.coerce.number().int().min(0).optional(),
    sort: z.enum(INVOICE_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  /** `counts`: each status tab (and Overdue) with the other filters applied. */
  response: countedPage(invoiceRow, INVOICE_TABS),
});

const countAndCents = z.object({ count: z.number().int(), cents: centsString });

/** The Invoices board's tiles: open receivable, overdue, due in the next 7 days, collected this month. */
export const invoiceSummary = route({
  id: "invoices.summary",
  method: "GET",
  path: "/v1/invoices/summary",
  access: { permission: ["payments.record", "invoices.post"] },
  response: z.object({
    open: countAndCents,
    overdue: countAndCents,
    dueNext7Days: countAndCents,
    collectedThisMonth: countAndCents,
  }),
});

export const getInvoice = route({
  id: "invoices.get",
  method: "GET",
  path: "/v1/invoices/:id",
  access: { self: true },
  params: idParams,
  response: invoiceDetail,
});

/** Create and post an invoice for a confirmed order's quantity not yet invoiced (a prepayment invoice). */
export const createOrderInvoice = route({
  id: "invoices.create_for_order",
  method: "POST",
  path: "/v1/sales-orders/:id/invoice",
  access: { permission: "invoices.post" },
  idempotency: "required",
  params: idParams,
  body: z.object({ orderVersion: version.optional(), invoiceDate: day.optional() }).strict().optional(),
  response: invoiceDetail,
});

/** Void: only unpaid and in the same open period (a reversal); otherwise a credit note. */
export const voidInvoice = route({
  id: "invoices.void",
  method: "POST",
  path: "/v1/invoices/:id/void",
  access: { permission: "invoices.post" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, reason: note }).strict(),
  response: invoiceDetail,
});

/**
 * Ez #24: pause or resume one invoice's reminders, with a reason (audited). statements.send: whoever sends
 * statements (Owner, Admin, Manager, Finance, Sales). Resuming sends only the latest scheduled reminder.
 */
export const pauseInvoiceReminders = route({
  id: "invoices.reminders.pause",
  method: "POST",
  path: "/v1/invoices/:id/reminders/pause",
  access: { permission: "statements.send" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, reason: note }).strict(),
  response: invoiceDetail,
});

export const resumeInvoiceReminders = route({
  id: "invoices.reminders.resume",
  method: "POST",
  path: "/v1/invoices/:id/reminders/resume",
  access: { permission: "statements.send" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, reason: note }).strict(),
  response: invoiceDetail,
});

/** What an Email receipt answers: the address it went to, whether it waits (held), the queued messages. */
export const emailedReceipt = z.object({ email: z.string(), held: z.boolean(), messageIds: z.array(uuid) });

/**
 * Email receipt on a paid invoice (statements.send): paid in full, the payments that paid it and the invoice's
 * PDF, to the one address staff confirm (the customer's email prefilled). The Idempotency-Key is also the
 * message's dedupe key, so a retry never sends it twice.
 */
export const emailInvoiceReceipt = route({
  id: "invoices.email_receipt",
  method: "POST",
  path: "/v1/invoices/:id/email-receipt",
  access: { permission: "statements.send" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      email: z.string().trim().email("Enter a valid email address").max(254),
    })
    .strict(),
  response: emailedReceipt,
});

// ── Customer payments and pay links (slice D) ───────────────────────────

/** What a person records on Receive payment. */
export const PAY_METHODS = ["cash", "check", "ach", "card", "wire"] as const;
/** What a payment can carry: phase 6 adds `opening_credit`, made only by the opening worksheet. */
export const PAYMENT_ROW_METHODS = [...PAY_METHODS, "opening_credit"] as const;
export const CUSTOMER_PAYMENT_STATUSES = ["processing", "posted", "voided", "legacy"] as const;
export const CUSTOMER_PAYMENT_COLUMNS = ["processing", "posted", "reconciled", "voided", "legacy"] as const;
/** The Payments board's tabs (after All received). */
export const CUSTOMER_PAYMENT_VIEWS = ["unapplied", "processing", "failed", "voided", "undeposited"] as const;
export const CUSTOMER_PAYMENT_SORTS = ["number", "paymentDate", "customer", "amount", "status"] as const;
export const CUSTOMER_PAYMENT_ACTIONS = ["clear", "void", "applyCredit"] as const;
export const PAYMENT_LINK_STATUSES = ["pending", "paid", "failed", "expired", "cancelled"] as const;
export const ALLOCATION_KINDS = ["payment", "credit"] as const;

export const customerPaymentActions = z.object(
  Object.fromEntries(CUSTOMER_PAYMENT_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof CUSTOMER_PAYMENT_ACTIONS)[number],
    typeof actionAllowed
  >,
);

export const allocationRow = z.object({
  id: uuid,
  invoice: z.object({ id: uuid, number: z.string().nullable() }),
  kind: z.enum(ALLOCATION_KINDS),
  amountCents: centsString,
  journal: docRef.nullable(),
  appliedAt: isoTime,
  voidedAt: isoTime.nullable(),
});

export const customerPaymentRow = z.object({
  id: uuid,
  number: z.string().nullable(),
  customer: customerRef,
  status: z.enum(CUSTOMER_PAYMENT_STATUSES),
  column: z.enum(CUSTOMER_PAYMENT_COLUMNS),
  method: z.enum(PAYMENT_ROW_METHODS),
  depositAccount: z.object({ id: uuid, code: z.string(), name: z.string() }),
  paymentDate: day,
  reference: z.string().nullable(),
  memo: z.string().nullable(),
  amountCents: centsString,
  allocatedCents: centsString,
  unappliedCents: centsString,
  feeCents: centsString,
  journal: docRef.nullable(),
  feeJournal: docRef.nullable(),
  voidJournal: docRef.nullable(),
  postedAt: isoTime.nullable(),
  postedBy: userRef.nullable(),
  clearedAt: isoTime.nullable(),
  voidedAt: isoTime.nullable(),
  voidedBy: userRef.nullable(),
  voidNote: z.string().nullable(),
  reconciledAt: isoTime.nullable(),
  paymentLinkId: uuid.nullable(),
  providerRef: z.string().nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
});

export const customerPaymentDetail = customerPaymentRow.extend({
  allocations: z.array(allocationRow),
  /** `bounce` (a deposited check the bank returned) and `refund` (its unapplied credit) are left out by older answers. */
  actions: customerPaymentActions.extend({
    bounce: actionAllowed.optional(),
    refund: actionAllowed.optional(),
  }),
  /** Unapplied credit refunded: on its way back through the processor, and paid back. */
  refundingCents: centsString.optional(),
  refundedCents: centsString.optional(),
  /** How the unapplied credit is refunded now: back on the processor's charge, or from a bank account. */
  refundTo: z.enum(["card", "bank"]).optional(),
  /** The batch deposit a check or cash payment sits on (draft or posted), or null. */
  deposit: z
    .object({
      id: uuid,
      number: z.string().nullable(),
      status: z.enum(["draft", "posted", "voided"]),
      depositDate: day,
      bankAccount: z.object({ id: uuid, name: z.string(), code: z.string() }),
    })
    .nullable()
    .optional(),
});

export const allocationInput = z.object({ invoiceId: uuid, amountCents: centsInput }).strict();

export const listCustomerPayments = route({
  id: "customer_payments.list",
  method: "GET",
  path: "/v1/customer-payments",
  access: { self: true },
  query: z.object({
    /** Matches the number, the reference, or the customer's name or number. */
    search: z.string().trim().max(100).optional(),
    customerId: uuid.optional(),
    status: z.enum(CUSTOMER_PAYMENT_STATUSES).optional(),
    /** One of the board's tabs: Unapplied, Processing, Failed, Voided, Not yet deposited. */
    view: z.enum(CUSTOMER_PAYMENT_VIEWS).optional(),
    method: z.enum(PAYMENT_ROW_METHODS).optional(),
    /** The account the money landed in. */
    depositAccountId: uuid.optional(),
    from: day.optional(),
    to: day.optional(),
    sort: z.enum(CUSTOMER_PAYMENT_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  /** `counts`: All and each tab, with the other filters applied. */
  response: countedPage(customerPaymentRow, ["all", ...CUSTOMER_PAYMENT_VIEWS] as const),
});

export const getCustomerPayment = route({
  id: "customer_payments.get",
  method: "GET",
  path: "/v1/customer-payments/:id",
  access: { self: true },
  params: idParams,
  response: customerPaymentDetail,
});

/**
 * Record a payment: allocations fill the oldest invoice first unless given (each capped at its balance,
 * together at the amount); the rest is customer credit. Cash and checks land in Undeposited funds, cards in
 * Stripe clearing; ACH and wires need the bank account. An ACH is Processing until cleared.
 */
export const recordCustomerPayment = route({
  id: "customer_payments.record",
  method: "POST",
  path: "/v1/customer-payments",
  access: { permission: "payments.record" },
  idempotency: "required",
  body: z
    .object({
      customerId: uuid,
      /** Left out with `paymentMethodId`: the method's kind. One of the two is needed. */
      method: z.enum(PAY_METHODS).optional(),
      /** admin-w6 (D661): a method from Settings › Payment methods (its reference may be required). */
      paymentMethodId: uuid.nullable().optional(),
      amountCents: centsInput,
      paymentDate: day.optional(),
      reference: z.string().trim().max(100).nullable().optional(),
      memo: z.string().trim().max(500).nullable().optional(),
      depositAccountId: uuid.nullable().optional(),
      allocations: z.array(allocationInput).max(200).nullable().optional(),
    })
    .strict(),
  response: customerPaymentDetail,
});

/** The ACH cleared: it posts now. */
export const clearCustomerPayment = route({
  id: "customer_payments.clear",
  method: "POST",
  path: "/v1/customer-payments/:id/clear",
  access: { permission: "payments.record" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, clearedAt: isoTime.optional() }).strict(),
  response: customerPaymentDetail,
});

/** Void (payments.void): a reason; refused once the deposit is reconciled; reopens the invoices. */
export const voidCustomerPayment = route({
  id: "customer_payments.void",
  method: "POST",
  path: "/v1/customer-payments/:id/void",
  access: { permission: "payments.void" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, note }).strict(),
  response: customerPaymentDetail,
});

/** Apply the payment's unapplied cash to a later open invoice of the same customer. */
export const applyCustomerCredit = route({
  id: "customer_payments.apply_credit",
  method: "POST",
  path: "/v1/customer-payments/:id/apply-credit",
  access: { permission: "payments.record" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, invoiceId: uuid, amountCents: centsInput.nullable().optional() }).strict(),
  response: customerPaymentDetail,
});

/**
 * Email receipt on a posted payment (payments.record): the amount, the invoices it paid and the credit it left,
 * to the one address staff confirm (the customer's email prefilled). The Idempotency-Key is also the message's
 * dedupe key.
 */
export const emailCustomerPaymentReceipt = route({
  id: "customer_payments.email_receipt",
  method: "POST",
  path: "/v1/customer-payments/:id/email-receipt",
  access: { permission: "payments.record" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      email: z.string().trim().email("Enter a valid email address").max(254),
    })
    .strict(),
  response: emailedReceipt,
});

export const paymentLinkRow = z.object({
  id: uuid,
  customer: z.object({ id: uuid, number: z.string(), displayName: z.string() }),
  invoice: z.object({ id: uuid, number: z.string().nullable() }).nullable(),
  order: docRef.nullable(),
  status: z.enum(PAYMENT_LINK_STATUSES),
  amountCents: centsString,
  url: z.string(),
  provider: z.string(),
  /** Null on a code link (phase 5): each checkout attempt carries its own. */
  providerRef: z.string().nullable(),
  expiresAt: isoTime,
  openedCount: z.number().int(),
  failureReason: z.string().nullable(),
  paidAt: isoTime.nullable(),
  payment: z.object({ id: uuid, number: z.string().nullable() }).nullable(),
  cancelledAt: isoTime.nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
});

/** One active link per invoice or order, the amount fixed; `regenerate` cancels the active one first. */
export const createPaymentLink = route({
  id: "payment_links.create",
  method: "POST",
  path: "/v1/payment-links",
  access: { permission: "payments.record" },
  idempotency: "required",
  body: z
    .object({
      invoiceId: uuid.nullable().optional(),
      orderId: uuid.nullable().optional(),
      regenerate: z.boolean().optional(),
    })
    .strict(),
  response: paymentLinkRow,
});

export const getPaymentLink = route({
  id: "payment_links.get",
  method: "GET",
  path: "/v1/payment-links/:id",
  access: { self: true },
  params: idParams,
  response: paymentLinkRow,
});

export const cancelPaymentLink = route({
  id: "payment_links.cancel",
  method: "POST",
  path: "/v1/payment-links/:id/cancel",
  access: { permission: "payments.record" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: paymentLinkRow,
});

/**
 * Stripe's webhook: the signed event is stored once (by its event id) and processed later from the inbox;
 * the answer only says whether it was stored or already known.
 */
export const stripeWebhook = route({
  id: "stripe.webhook",
  method: "POST",
  path: "/v1/webhooks/stripe",
  access: { public: true },
  rawBody: true,
  response: z.object({ status: z.enum(["stored", "duplicate", "ignored"]) }),
});

// ── Line item v2, wave L1: what the line knows about the item and the customer (D680–D699) ──

/** Comma-separated item ids (at most 200, duplicates dropped), as the lines of one document send them. */
const productIdList = z
  .string()
  .trim()
  .transform((v) => [
    ...new Set(
      v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(uuid).min(1).max(200));

/** The newest posted sale of the item to the customer: the unit price after the line discount, before any order discount. */
export const lastSaleRow = z.object({
  date: day,
  invoice: z.object({ id: uuid, number: z.string() }),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
});

/** A3 (D1500): the customer's live contract price for an item (the step with the lowest minimum). */
export const contractPriceStep = z.object({
  unitPriceCents: z.number().int(),
  minQty: z.number().int(),
  endsOn: day.nullable(),
});

/**
 * One row per item asked for. `costCents` (the item's average cost, the one the floor uses) only with cost.view;
 * `minMarginBp` (the item's own minimum margin, else the floor policy's) only with cost.view and margin.view —
 * the keys are absent otherwise, as on products.get.
 */
export const lineFactsRow = z.object({
  productId: uuid,
  lastSale: lastSaleRow.nullable(),
  contract: contractPriceStep.nullable().optional(),
  minPriceCents: z.number().int().nullable(),
  costCents: z.number().int().nullable().optional(),
  minMarginBp: z.number().int().optional(),
});

/**
 * L1 batched read for the lines of a quote or order (D681): every line's last price to this customer, and (by
 * permission) the cost and minimum margin the margin light reads. One read for all the lines, in a fixed number
 * of queries whatever their count. Without a customer, no last prices.
 */
export const lineFacts = route({
  id: "sales.line_facts",
  method: "GET",
  path: "/v1/sales/line-facts",
  access: { self: true },
  query: z.object({ productIds: productIdList, customerId: uuid.optional() }),
  response: z.object({ rows: z.array(lineFactsRow) }),
});

/** A past posted invoice line of the item to the customer, newest first. Money only by permission. */
export const itemSaleRow = z.object({
  invoiceLineId: uuid,
  date: day,
  invoice: z.object({ id: uuid, number: z.string() }),
  order: z.object({ id: uuid, number: z.string() }),
  quantity: z.number().int(),
  /** The invoice line's unit price and line discount, and the unit price after it. */
  unitPriceCents: z.number().int(),
  discountBp: z.number().int(),
  netUnitCents: z.number().int(),
  /** The line's sales value: its total less its share of the order discount (no tax, no shipping). */
  netCents: centsString,
  /** Units and value credited back on posted credit notes against this line. */
  creditedQty: z.number().int(),
  creditedCents: centsString,
  /** cost.view: the cost of goods recorded when the units shipped (null when not shipped yet). */
  costCents: centsString.nullable().optional(),
  /** cost.view and margin.view: (net − cost) ÷ net. */
  marginBp: z.number().int().nullable().optional(),
});

export const itemReceiptRow = z.object({
  receipt: z.object({ id: uuid, number: z.string() }),
  po: z.object({ id: uuid, number: z.string() }),
  vendor: z.object({ id: uuid, name: z.string() }),
  date: day,
  warehouse: z.object({ id: uuid, code: z.string() }),
  receivedQty: z.number().int(),
  acceptedQty: z.number().int(),
  /** cost.view: the PO unit cost frozen on the receipt line. */
  unitCostCents: z.number().int().nullable().optional(),
});

export const itemOpenPoRow = z.object({
  po: z.object({ id: uuid, number: z.string() }),
  vendor: z.object({ id: uuid, name: z.string() }),
  warehouse: z.object({ id: uuid, code: z.string(), name: z.string() }),
  quantity: z.number().int(),
  expectedDate: day.nullable(),
});

/**
 * L1 combined read for one line's ⓘ panel (D682): the item card's warehouse facts (available here, the default
 * bin), the floor in dollars (cost.view), this customer's posted history of the item with one "last price", and
 * receiving (the last posted receipts and the open purchase orders). Prices, tiers and box codes come from
 * products.get, which the lines already hold.
 */
export const itemFacts = route({
  id: "sales.item_facts",
  method: "GET",
  path: "/v1/sales/item-facts/:productId",
  access: { self: true },
  params: z.object({ productId: uuid }),
  query: z.object({ customerId: uuid.optional(), warehouseId: uuid.optional() }),
  response: z.object({
    productId: uuid,
    warehouse: z.object({ id: uuid, code: z.string(), name: z.string() }),
    available: z.number().int(),
    defaultBin: z.object({ id: uuid, code: z.string(), sellable: z.number().int() }).nullable(),
    minPriceCents: z.number().int().nullable(),
    /** cost.view: the item's average cost and the lowest unit price the floor allows without a Manager. */
    costCents: z.number().int().nullable().optional(),
    floorUnitCents: z.number().int().nullable().optional(),
    /** cost.view and margin.view. */
    minMarginBp: z.number().int().optional(),
    history: z.object({
      rows: z.array(itemSaleRow),
      /** Posted invoice lines in all (the rows are the newest 100). */
      count: z.number().int(),
      units: z.number().int(),
      creditedUnits: z.number().int(),
      /** Σ net − Σ credited: ties to the customer's posted invoices less credit notes for the item. */
      netCents: centsString,
      lastSale: lastSaleRow.nullable(),
    }),
    receipts: z.array(itemReceiptRow),
    openPos: z.array(itemOpenPoRow),
  }),
});

// ── Line item L2: faster adding (D940–D969) ─────────────────────────────

/** Whose price the adding tools show: a price list, or "retail" (the counter sale's walk-in and retail customers). */
export const ADDING_PRICE_BASES = [...PRICE_LISTS, "retail"] as const;
export type AddingPriceBase = (typeof ADDING_PRICE_BASES)[number];

/** Asking for a customer's price: the document's list (or retail) wins, else the customer's own, else Standard. */
const addingPriceQuery = {
  customerId: uuid.optional(),
  priceList: z.enum(ADDING_PRICE_BASES).optional(),
  /** Available in this warehouse (the document's); over every active warehouse without it. */
  warehouseId: uuid.optional(),
};

/**
 * An item as the adding tools show it (D941): picture, brand, codes, the units available, this customer's price
 * (priced by the server the way a new line is), the Tier 3 the editor previews the floor against, and the selling
 * rules (L3). `costCents` only with cost.view; `minMarginBp` with cost.view and margin.view — absent otherwise.
 */
export const addingItemRow = z.object({
  id: uuid,
  sku: z.string(),
  upc: z.string().nullable(),
  name: z.string(),
  brand: z.object({ id: uuid, name: z.string() }),
  thumbUrl: z.string().nullable(),
  categoryPath: z.string().nullable(),
  status: z.enum(["active", "hidden", "discontinued"]),
  available: z.number().int(),
  /** This customer's price for one unit (their list, or retail). */
  priceCents: z.number().int(),
  standardPriceCents: z.number().int(),
  /** The Tier 3 floor the line editor previews a typed price against, and the item's minimum price. */
  floorCents: z.number().int(),
  minPriceCents: z.number().int().nullable(),
  casePack: z.number().int().nullable(),
  sellMultiple: z.number().int().nullable(),
  minSellQty: z.number().int().nullable(),
  maxSellQty: z.number().int().nullable(),
  costCents: z.number().int().nullable().optional(),
  minMarginBp: z.number().int().optional(),
  /** A3: the customer's contract price for the item; `priceCents` is it when the contract starts at one unit. */
  contract: contractPriceStep.nullable().optional(),
});

/**
 * L2 Advance Search (D940): the catalog for adding many items at once, active items only, a page at a time.
 * `q` matches word by word like the portal's search (every word somewhere on the item or its brand, or the item
 * named by SKU or barcode), best match first; brand, a category's whole branch, and in stock narrow it.
 */
export const addingCatalog = route({
  id: "sales.adding_catalog",
  method: "GET",
  path: "/v1/sales/adding/catalog",
  access: { self: true },
  query: z.object({
    q: z.string().trim().max(100).optional(),
    brandId: uuid.optional(),
    category: categoryCode.optional(),
    inStock: boolQuery,
    ...addingPriceQuery,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: offsetQuery,
  }),
  response: z.object({
    rows: z.array(addingItemRow),
    total: z.number().int(),
    priceBase: z.enum(ADDING_PRICE_BASES),
  }),
});

export const PASTE_PROBLEMS = ["not_found", "discontinued", "no_case_pack"] as const;
/** How a pasted line found its item: by code (the L3 scan rules) or by its words. */
export const PASTE_MATCHES = ["sku", "upc", "case_barcode", "alternate", "name"] as const;

export const pastedLineRow = z.object({
  /** The line's number in the pasted text (blank lines counted), and the line as pasted. */
  row: z.number().int(),
  raw: z.string(),
  /** What the line names: a code, or words. */
  code: z.string().nullable(),
  words: z.string().nullable(),
  /** The quantity as written and what it counts ("12 cs" is cases), null when the line had none (1 is used). */
  quantity: z.number().int().nullable(),
  per: z.enum(["unit", "case"]),
  /** Units the line adds (cases and box barcodes multiplied out); null when nothing matched. */
  units: z.number().int().nullable(),
  matchedBy: z.enum(PASTE_MATCHES).nullable(),
  item: addingItemRow.nullable(),
  /** Other items the words also match (best first, at most 4), to swap to in the preview. */
  others: z.array(addingItemRow),
  problem: z.object({ code: z.enum(PASTE_PROBLEMS), message: z.string() }).nullable(),
});

/**
 * L2 "Paste a list" (D945–D949): reads pasted text ("SKU 12", "6291108737194, 6", "12 x khamrah 100ml",
 * WhatsApp messages with their date and name) and answers each line's item, units and price for a preview. Writes
 * nothing; POST because the text doesn't fit a link. A fixed number of queries for 1 line or 200.
 */
export const pasteLines = route({
  id: "sales.paste_lines",
  method: "POST",
  path: "/v1/sales/adding/paste",
  access: { permission: "documents.sales.edit" },
  body: z
    .object({
      text: z.string().max(20_000, "Paste at most 20,000 characters at a time"),
      ...addingPriceQuery,
    })
    .strict(),
  response: z.object({
    lines: z.array(pastedLineRow),
    matched: z.number().int(),
    unmatched: z.number().int(),
    priceBase: z.enum(ADDING_PRICE_BASES),
  }),
});

export const REORDER_KINDS = ["order", "invoice"] as const;

/** L2 "Copy lines from…" (D950): this customer's orders and posted invoices, newest first (40 at most). */
export const reorderSources = route({
  id: "sales.reorder_sources",
  method: "GET",
  path: "/v1/sales/adding/reorder-sources",
  access: { self: true },
  query: z.object({ customerId: uuid }),
  response: z.object({
    rows: z.array(
      z.object({
        kind: z.enum(REORDER_KINDS),
        id: uuid,
        number: z.string(),
        date: day,
        status: z.string(),
        lineCount: z.number().int(),
        units: z.number().int(),
        totalCents: centsString,
      }),
    ),
  }),
});

export const REORDER_FLAGS = [
  "discontinued",
  "hidden",
  "out_of_stock",
  "short",
  "price_up",
  "price_down",
] as const;

/**
 * L2 reorder preview (D951–D953): the lines of one of this customer's orders or invoices, one per item, repriced at
 * today's price for the customer, each flagged (discontinued items can't be added; hidden, out of stock, short and
 * a price change since are warnings).
 */
export const reorderLines = route({
  id: "sales.reorder_lines",
  method: "GET",
  path: "/v1/sales/adding/reorder/:kind/:id",
  access: { self: true },
  params: z.object({ kind: z.enum(REORDER_KINDS), id: uuid }),
  query: z.object(addingPriceQuery),
  response: z.object({
    source: z.object({
      kind: z.enum(REORDER_KINDS),
      id: uuid,
      number: z.string(),
      date: day,
      customer: z.object({ id: uuid, name: z.string() }),
    }),
    lines: z.array(
      z.object({
        item: addingItemRow,
        quantity: z.number().int(),
        /** What the customer paid then per unit, after the line discount. */
        thenUnitCents: z.number().int(),
        flags: z.array(z.enum(REORDER_FLAGS)),
        addable: z.boolean(),
      }),
    ),
    priceBase: z.enum(ADDING_PRICE_BASES),
  }),
});

/**
 * L2 "This customer's items" (D955–D957): every item on the customer's posted sales invoices (opening invoices
 * left out, as L1's history), with how many invoices it was on, units, the first and last date, and the last
 * quantity and price paid; today's price and stock come with the item. The 500 most recently bought.
 */
export const customerItems = route({
  id: "sales.customer_items",
  method: "GET",
  path: "/v1/sales/adding/customer-items",
  access: { self: true },
  query: z.object({ customerId: uuid, priceList: addingPriceQuery.priceList, warehouseId: uuid.optional() }),
  response: z.object({
    rows: z.array(
      z.object({
        item: addingItemRow,
        times: z.number().int(),
        units: z.number().int(),
        firstDate: day,
        lastDate: day,
        lastQty: z.number().int(),
        lastUnitCents: z.number().int(),
        lastInvoice: z.object({ id: uuid, number: z.string() }),
      }),
    ),
    total: z.number().int(),
    priceBase: z.enum(ADDING_PRICE_BASES),
  }),
});

// ── Line item L4: stock truth (D1170–D1199) ─────────────────────────────

/** One active warehouse's stock of the item: on hand, reserved, available, and the fullest bin to pick from. */
export const lineStockWarehouse = z.object({
  warehouse: z.object({ id: uuid, code: z.string(), name: z.string() }),
  /** The document's warehouse (the one its lines ship from). */
  here: z.boolean(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  bin: z.object({ id: uuid, code: z.string(), sellable: z.number().int() }).nullable(),
});

export const lineStockIncoming = z.object({
  po: z.object({ id: uuid, number: z.string() }),
  vendor: z.object({ id: uuid, name: z.string() }),
  warehouse: z.object({ id: uuid, code: z.string() }),
  quantity: z.number().int(),
  expectedDate: day.nullable(),
});

/** A substitute as the shortage dialog and the ⓘ panel offer it: the item at this customer's price, and why. */
export const lineSubstituteRow = z.object({
  item: addingItemRow,
  reason: z.enum(SUBSTITUTE_REASONS),
  note: z.string().nullable(),
  /** P10 (D1981): units reserved for other orders in the document's warehouse, and the surplus (sellable − reserved). */
  reserved: z.number().int().default(0),
  surplus: z.number().int().default(0),
});

export const lineStockRow = z.object({
  productId: uuid,
  /** Every active warehouse, the document's first; the totals are over them. */
  warehouses: z.array(lineStockWarehouse),
  totals: z.object({ onHand: z.number().int(), reserved: z.number().int(), available: z.number().int() }),
  /** Open lines of sent purchase orders, soonest expected first (undated last), at most 10. */
  incoming: z.array(lineStockIncoming),
  incomingUnits: z.number().int(),
  /**
   * Active substitutes with their available units in the document's warehouse, ranked by surplus (the most spare
   * units first; the item's own order breaks ties, D1981).
   */
  substitutes: z.array(lineSubstituteRow),
});

/**
 * L4 batched read for the lines (D1171): per item, stock by active warehouse (on hand, reserved, available, the
 * fullest bin), what is on its way (open PO lines with the expected date and vendor) and its substitutes at this
 * customer's price. One read for every line, a fixed number of queries whatever their count; cached like the
 * line facts.
 */
export const lineStock = route({
  id: "sales.line_stock",
  method: "GET",
  path: "/v1/sales/line-stock",
  access: { self: true },
  query: z.object({ productIds: productIdList, ...addingPriceQuery }),
  response: z.object({
    warehouse: z.object({ id: uuid, code: z.string(), name: z.string() }),
    priceBase: z.enum(ADDING_PRICE_BASES),
    rows: z.array(lineStockRow),
  }),
});

/**
 * L4 "Take from another warehouse" (D1175): asks for a draft transfer of the shortage from another warehouse to the
 * document's, from the fullest bins there to the receiving bin here. Nothing moves until the warehouse dispatches
 * it (stock.move, with the usual transfer approval); the note names the document.
 */
export const shortageTransfer = route({
  id: "sales.shortage_transfer",
  method: "POST",
  path: "/v1/sales/shortage-transfer",
  access: { permission: "documents.sales.edit" },
  idempotency: "required",
  body: z
    .object({
      productId: uuid,
      fromWarehouseId: uuid,
      toWarehouseId: uuid,
      quantity: z.number().int().min(1).max(1_000_000),
      /** The quote or order it is for ("Q-00012"), written on the transfer's note. */
      documentNumber: z.string().trim().max(40).optional(),
    })
    .strict(),
  response: z.object({
    transfer: z.object({ id: uuid, number: z.string(), status: z.string() }),
    quantity: z.number().int(),
    /** P10 (D1984): how many warehouse people were told to dispatch it (the warehouse queue). */
    notified: z.number().int().default(0),
  }),
});

// ── L5: the customer's notes and alerts above the lines (D1284) ─────────

export const CUSTOMER_ALERT_KINDS = [
  "inactive",
  "credit_hold",
  "overdue",
  "over_limit",
  "tax_exempt",
  "tax_taxable",
  "whatsapp_opt_out",
  "shipping",
  // P10 (D1991): items or brands this customer must not be sold.
  "restricted",
  "note",
] as const;
export type CustomerAlertKind = (typeof CUSTOMER_ALERT_KINDS)[number];

export const customerAlert = z.object({
  kind: z.enum(CUSTOMER_ALERT_KINDS),
  /** neg: stops or holds a sale; warn: look before selling; info: good to know. */
  tone: z.enum(["neg", "warn", "info"]),
  text: z.string(),
  /** Who wrote a note, and when. */
  by: z.string().nullable(),
  at: isoTime.nullable(),
});

/**
 * L5 (D1284): what to know about the customer before adding lines, read-only from existing data: deactivated,
 * orders on credit hold, overdue and over the limit, tax status of the ship-to (exempt with a certificate, or
 * taxable), WhatsApp opt-out, how their last order shipped, and their newest CRM notes (crm.view). Money only with
 * the same reads the customer record shows.
 */
export const customerAlerts = route({
  id: "sales.customer_alerts",
  method: "GET",
  path: "/v1/sales/customer-alerts/:customerId",
  access: { self: true },
  params: z.object({ customerId: uuid }),
  query: z.object({ shipToAddressId: uuid.optional() }),
  response: z.object({ customerId: uuid, alerts: z.array(customerAlert) }),
});
