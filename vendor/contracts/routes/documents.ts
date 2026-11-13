import { z } from "zod";
import {
  type RouteContract,
  boolQuery,
  centsString,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  page,
  route,
  userRef,
  uuid,
} from "../http.js";
import { APPROVAL_PERMISSIONS, LOCK_PERMISSIONS, PERMISSIONS } from "../permissions.js";

// ── Edit locks ──────────────────────────────────────────────────────────

const lockParams = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Unknown record type"),
  id: z.string().min(1).max(100),
});

export const lockRow = z.object({
  entityType: z.string(),
  entityId: z.string(),
  holder: userRef,
  /** True when the caller's own session holds it. */
  mine: z.boolean(),
  acquiredAt: isoTime,
  expiresAt: isoTime,
});

export const getLock = route({
  id: "locks.get",
  method: "GET",
  path: "/v1/locks/:type/:id",
  access: { self: true },
  params: lockParams,
  response: z.object({ lock: lockRow.nullable() }),
});

/**
 * Edit: takes the lock, or refreshes it when this session already holds it. Held by someone else: 423
 * locked_by_other, unless `takeOver` (which discards their unsaved edits and tells them).
 */
export const acquireLock = route({
  id: "locks.acquire",
  method: "POST",
  path: "/v1/locks/:type/:id",
  access: { permission: LOCK_PERMISSIONS },
  params: lockParams,
  body: z.object({ takeOver: z.boolean().optional() }).strict(),
  response: lockRow,
});

/** Keeps the lock alive while the form is open; 409 lock_lost once someone else took it. */
export const heartbeatLock = route({
  id: "locks.heartbeat",
  method: "PUT",
  path: "/v1/locks/:type/:id",
  access: { permission: LOCK_PERMISSIONS },
  params: lockParams,
  response: lockRow,
});

/** Save or Cancel: releases the caller's own lock; anything else is a no-op. */
export const releaseLock = route({
  id: "locks.release",
  method: "DELETE",
  path: "/v1/locks/:type/:id",
  access: { self: true },
  params: lockParams,
  noContent: true,
});

// ── Approvals ───────────────────────────────────────────────────────────

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "invalidated"] as const;

export const approvalRow = z.object({
  id: uuid,
  kind: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  subjectLineId: z.string().nullable(),
  summary: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  requiredPermission: z.enum(PERMISSIONS),
  fourEyes: z.boolean(),
  status: z.enum(APPROVAL_STATUSES),
  requestedBy: userRef,
  requestedAt: isoTime,
  decidedBy: userRef.nullable(),
  decidedAt: isoTime.nullable(),
  decisionNote: z.string().nullable(),
  /** Why the requester asks. */
  requestNote: z.string().nullable(),
  expiresAt: isoTime,
  invalidatedAt: isoTime.nullable(),
  invalidatedReason: z.string().nullable(),
  version: z.number().int(),
  /** Whether the caller may approve or reject it now (KApprovals shows the buttons from this). */
  canDecide: z.boolean(),
});

/**
 * The inbox: requests the caller can decide (their permission and the kind's own rule) plus their own
 * requests. `mine` shows only their own.
 */
export const APPROVAL_SORTS = ["requestedAt", "expiresAt", "kind", "requestedBy", "decidedAt"] as const;

export const listApprovals = route({
  id: "approvals.list",
  method: "GET",
  path: "/v1/approvals",
  access: { self: true },
  query: z.object({
    status: z.enum(APPROVAL_STATUSES).default("pending"),
    mine: boolQuery,
    /** Matches what the request is about (its summary), the requester's reason or who asked. */
    search: z.string().trim().max(100).optional(),
    /** Newest request first by default. */
    sort: z.enum(APPROVAL_SORTS).default("requestedAt"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(approvalRow).extend({
    /**
     * Pending requests in the whole inbox this person can decide (ignores status, search and paging), for
     * Home's "Approvals waiting".
     */
    decidable: z.number().int(),
  }),
});

const idParams = z.object({ id: uuid });

export const getApproval = route({
  id: "approvals.get",
  method: "GET",
  path: "/v1/approvals/:id",
  access: { self: true },
  params: idParams,
  response: approvalRow,
});

/** Every decision needs a note (400 note_required when it is blank). */
const decisionBody = z.object({ note: z.string().max(2000).default("") }).strict();

/**
 * Approve. An expired request, or one whose subject changed since it was asked, is marked so and refused
 * (409); that status change is kept. Approving again by the same person returns it.
 */
export const approveApproval = route({
  id: "approvals.approve",
  method: "POST",
  path: "/v1/approvals/:id/approve",
  access: { permission: APPROVAL_PERMISSIONS },
  params: idParams,
  body: decisionBody,
  response: approvalRow,
});

export const rejectApproval = route({
  id: "approvals.reject",
  method: "POST",
  path: "/v1/approvals/:id/reject",
  access: { permission: APPROVAL_PERMISSIONS },
  params: idParams,
  body: decisionBody,
  response: approvalRow,
});

// ── Phase 5: document PDFs (slice 3 `p5-documents`) ─────────────────────

/**
 * Each PDF and the data it prints (docs/phases/phase-5-design.md §5, §6 slice 3; boards D*). Core's
 * `documentData` builds the data from the posted record, as the person asking may read it; `@marsa/documents`
 * renders it to the board's layout. Money is whole cents as a digit string (it may exceed 2^53), dates are
 * business days (YYYY-MM-DD); wording and formatting are the renderer's. No customer-facing document has a
 * cost field at all; the purchase order (vendor-facing) carries the agreed unit cost, and only for someone
 * with cost.view.
 */
export const PDF_KINDS = [
  "invoice",
  "quote",
  "order_confirmation",
  "packing_slip",
  "statement",
  "credit_note",
  "purchase_order",
  "remittance",
  "catalog",
  "deposit_slip",
  "business_card",
  "picking_slip",
  "labels",
  "bill_of_lading",
] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

const money = centsString;
const cents = z.number().int();

/** The company block every document prints (setting `business.company`). */
export const docCompany = z.object({
  /** Trading name: "Marsa Wholesale". */
  name: z.string(),
  /** "Marsa Import Inc". */
  legalName: z.string(),
  /** Street lines then "City, ST ZIP"; empty until the address is set. */
  addressLines: z.array(z.string()),
  phone: z.string().nullable(),
  /** Accounts email. */
  email: z.string().nullable(),
  /** "wholesale.itsmarsa.com" (also the portal's address for pay and accept links). */
  website: z.string().nullable(),
  /** The WhatsApp number customer messages come from (setting `messages.sender`). */
  whatsapp: z.string().nullable(),
  /** The company logo (setting `business.logo`) as a PNG or JPEG data URI; null: the "M" badge prints. */
  logo: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .default(null),
});
export type DocCompany = z.infer<typeof docCompany>;

/** A name and the lines under it (bill to, ship to, vendor, deliver to). */
export const docAddress = z.object({ name: z.string(), lines: z.array(z.string()) });
export type DocAddress = z.infer<typeof docAddress>;

/** The customer's rep (or the PO's buyer): "Questions: your rep Ez Shaar · [phone] · WhatsApp". */
export const docPerson = z.object({ name: z.string(), phone: z.string().nullable() });

/** The item on a line: "Khamrah 100ml" over "Lattafa · MS-LA-KH-01 · UPC 6291108737194". */
export const docItem = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  sku: z.string(),
  upc: z.string().nullable(),
  /** A word printed after the UPC (a credit line's reason). */
  note: z.string().nullable().default(null),
  /** launch-images: the item's picture as a JPEG data URI (none: the grey placeholder). */
  image: z.string().startsWith("data:image/").nullable().default(null),
});

/** A pay (or accept) link printed with its QR code. */
export const docLink = z.object({ url: z.string(), code: z.string().nullable() });

/** The card fee when the surcharge is on (decision 9); null: the card fee isn't charged, so it isn't printed. */
export const docCardFee = z.object({ percentBp: z.number().int(), fixedCents: z.number().int() }).nullable();

const docBase = {
  company: docCompany,
  rep: docPerson.nullable(),
};

const saleLine = z.object({
  item: docItem,
  quantity: z.number().int(),
  unitPriceCents: cents,
  discountBp: z.number().int(),
  amountCents: money,
  /** L5 (D1286): the line's note for the customer, printed under the item. */
  lineNote: z.string().nullable().default(null),
});

/** DInvoice. */
export const invoiceDocData = z.object({
  ...docBase,
  number: z.string().nullable(),
  status: z.enum(["draft", "posted", "voided", "legacy"]),
  issuedDate: day,
  dueDate: day,
  terms: z.string(),
  billTo: docAddress,
  shipTo: docAddress.nullable(),
  orderNumber: z.string(),
  deliveryNumber: z.string().nullable(),
  customerPo: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  /** A website order's WooCommerce number ("#1004046"), printed as "Website order #1004046" (phase 6 slice 16). */
  websiteOrder: z.string().nullable().optional(),
  lines: z.array(saleLine),
  /**
   * An opening invoice (carried over from the old system, no lines): the one row printed for its amount,
   * "Opening balance — invoice #2000101" (launch). Null or absent: the lines print as they are.
   */
  amountLine: z.string().nullable().optional(),
  itemsCents: money,
  discountCents: money,
  /** W4: the discounts inside discountCents, by name (the rest prints as "Discount"). */
  promotions: z.array(z.object({ label: z.string(), amountCents: money })).optional(),
  /** "Freight, UPS Ground". */
  freightLabel: z.string(),
  freightCents: money,
  /** "Sales tax, Kennewick WA 8.8%". */
  taxLabel: z.string(),
  taxCents: money,
  totalCents: money,
  paidCents: money,
  creditedCents: money,
  balanceCents: money,
  payLink: docLink.nullable(),
  cardFee: docCardFee,
});

/** DQuote. */
export const quoteDocData = z.object({
  ...docBase,
  number: z.string(),
  revision: z.number().int(),
  status: z.enum(["draft", "sent", "accepted", "expired", "rejected"]),
  quoteDate: day,
  sentDate: day.nullable(),
  validUntil: day,
  preparedFor: docAddress,
  customerPo: z.string().nullable(),
  note: z.string().nullable(),
  lines: z.array(saleLine),
  itemsCents: money,
  discountCents: money,
  /** W4: the discounts inside discountCents, by name (the rest prints as "Discount"). */
  promotions: z.array(z.object({ label: z.string(), amountCents: money })).optional(),
  totalCents: money,
  acceptLink: docLink.nullable(),
});

/** DOrderConfirm: what was asked and what was confirmed. */
export const orderConfirmationDocData = z.object({
  ...docBase,
  number: z.string(),
  status: z.enum(["draft", "submitted", "confirmed", "closed", "cancelled"]),
  orderDate: day,
  confirmedDate: day.nullable(),
  customer: docAddress,
  /** "UPS Ground · 2 boxes"; null until a ship method is set. */
  shipBy: z.string().nullable(),
  customerPo: z.string().nullable(),
  requestedDate: day.nullable(),
  /** A website order's WooCommerce number ("#1004046"), printed as "Website order #1004046" (phase 6 slice 16). */
  websiteOrder: z.string().nullable().optional(),
  /** The invoice made at confirm (portal orders) and the day it must be paid by. */
  invoice: z.object({ number: z.string(), payBy: day, paid: z.boolean() }).nullable(),
  lines: z.array(saleLine.extend({ askedQty: z.number().int() })),
  itemsCents: money,
  discountCents: money,
  /** W4: the discounts inside discountCents, by name (the rest prints as "Discount"). */
  promotions: z.array(z.object({ label: z.string(), amountCents: money })).optional(),
  freightLabel: z.string(),
  freightCents: money,
  taxLabel: z.string(),
  taxCents: money,
  totalCents: money,
  note: z.string().nullable(),
});

/** DPackingSlip: no money on it at all. */
export const packingSlipDocData = z.object({
  ...docBase,
  number: z.string(),
  status: z.string(),
  shipDate: day.nullable(),
  carrierService: z.string().nullable(),
  shipTo: docAddress,
  orderNumber: z.string(),
  customerPo: z.string().nullable(),
  boxes: z.number().int().nullable(),
  /** A website order's WooCommerce number ("#1004046"), printed as "Website order #1004046" (phase 6 slice 16). */
  websiteOrder: z.string().nullable().optional(),
  weightGrams: z.number().int().nullable(),
  trackingNumber: z.string().nullable(),
  /** One row a line, or a line and box once the boxes record what they hold ("Packed in": "Box 2"). */
  lines: z.array(
    z.object({
      item: docItem,
      quantity: z.number().int(),
      packedIn: z.string().nullable().optional(),
      /** L5 (D1286, D1641): the order line's note for the customer, printed under the item. */
      lineNote: z.string().nullable().default(null),
    }),
  ),
  units: z.number().int(),
  /** Days after delivery a return can be asked for (returns policy). */
  returnDays: z.number().int(),
});

export const AGING_BUCKETS = ["current", "days_1_30", "days_31_60", "days_61_90", "over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** DStatement: open invoices aged from their due date, as Receivables ages them. */
export const statementDocData = z.object({
  ...docBase,
  asOf: day,
  account: docAddress,
  terms: z.string(),
  creditLimitCents: money,
  aging: z.object({
    current: money,
    days_1_30: money,
    days_31_60: money,
    days_61_90: money,
    over_90: money,
    total: money,
  }),
  rows: z.array(
    z.object({
      date: day,
      number: z.string(),
      orderNumber: z.string().nullable(),
      dueDate: day,
      /** Days past due on the statement date (0 or less: not due yet). */
      daysOverdue: z.number().int(),
      bucket: z.enum(AGING_BUCKETS),
      totalCents: money,
      balanceCents: money,
    }),
  ),
  /** Orders waiting on a credit hold that paying the overdue invoices releases. */
  heldOrders: z.array(z.string()),
  payLink: docLink.nullable(),
  cardFee: docCardFee,
});

/** DCreditNote. */
export const creditNoteDocData = z.object({
  ...docBase,
  number: z.string().nullable(),
  status: z.enum(["draft", "posted", "voided"]),
  issuedDate: day,
  invoiceNumber: z.string().nullable(),
  customer: docAddress,
  /** A website order's WooCommerce number ("#1004046"), printed as "Website order #1004046" (phase 6 slice 16). */
  websiteOrder: z.string().nullable().optional(),
  /** "Damaged in transit". */
  reason: z.string(),
  reasonNote: z.string().nullable(),
  returnNumber: z.string().nullable(),
  lines: z.array(saleLine),
  /**
   * The one row printed for a credit with no lines (by amount, or any credit on an opening invoice):
   * "Opening balance — invoice #2000101" or "Credit on INV-00012" (launch). Null or absent: the lines only.
   */
  amountLine: z.string().nullable().optional(),
  subtotalCents: money,
  discountCents: money,
  freightCents: money,
  taxLabel: z.string(),
  taxCents: money,
  totalCents: money,
  /** Applied to invoices (its own on posting, then any applied later). */
  appliedCents: money,
  /** Kept as credit on the account, not yet used or refunded. */
  keptCents: money,
  refundedCents: money,
  /** The invoice's balance before and after this credit (posted against its own invoice). */
  invoiceBalance: z.object({ beforeCents: money, afterCents: money }).nullable(),
});

/** DPurchaseOrder (vendor-facing): the agreed unit costs, only for someone who may see them. */
export const purchaseOrderDocData = z.object({
  ...docBase,
  number: z.string(),
  status: z.string(),
  issuedDate: day,
  vendor: docAddress,
  deliverTo: docAddress,
  expectedDate: day.nullable(),
  terms: z.string(),
  vendorReference: z.string().nullable(),
  noteToVendor: z.string().nullable(),
  /** False for someone without cost.view: the PDF prints quantities only. */
  showsPrices: z.boolean(),
  lines: z.array(
    z.object({
      item: docItem,
      quantity: z.number().int(),
      unitCostCents: cents.nullable(),
      amountCents: money.nullable(),
      noCharge: z.boolean(),
    }),
  ),
  subtotalCents: money.nullable(),
  discountCents: money.nullable(),
  freightCents: money.nullable(),
  totalCents: money.nullable(),
});

/**
 * DRemittance (vendor-facing payment advice). `showsAmounts` false is the supplier portal's variant (owner
 * decision, 22 Oct 2026: suppliers see no money): every amount is null and the PDF prints the bills, dates and
 * references only. Control's payment advice and the emailed one keep their amounts.
 */
export const remittanceDocData = z.object({
  ...docBase,
  number: z.string().nullable(),
  status: z.string(),
  paidDate: day,
  method: z.string(),
  bankReference: z.string().nullable(),
  memo: z.string().nullable(),
  vendor: docAddress,
  showsAmounts: z.boolean().default(true),
  bills: z.array(
    z.object({
      number: z.string().nullable(),
      vendorInvoiceNo: z.string(),
      pos: z.array(z.string()),
      billDate: day,
      billAmountCents: money.nullable(),
      creditUsedCents: money.nullable(),
      paidNowCents: money.nullable(),
      stillOwedCents: money.nullable(),
    }),
  ),
  credits: z.array(z.object({ number: z.string().nullable(), amountCents: money.nullable() })),
  paidNowCents: money.nullable(),
  creditsUsedCents: money.nullable(),
  settledCents: money.nullable(),
});

/** DCatalogCover + DCatalogPage: active items by brand at the customer's prices. */
export const catalogDocData = z.object({
  ...docBase,
  customerName: z.string(),
  asOf: day,
  validUntil: day,
  minimumOrderCents: money,
  minimumUnitsPerItem: z.number().int(),
  brands: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          sku: z.string(),
          upc: z.string().nullable(),
          priceCents: cents,
          msrpCents: cents.nullable(),
          /** launch-images: the item's picture as a JPEG data URI (none: the grey placeholder). */
          image: z.string().startsWith("data:image/").nullable().default(null),
        }),
      ),
    }),
  ),
});

/**
 * The deposit slip (phase 6 slice 12; drawn from the BatchDeposit board): the checks one by one with their
 * numbers, the cash, and the total the bank line will show. Finance's own document (banking.reconcile).
 */
export const depositSlipDocData = z.object({
  ...docBase,
  number: z.string().nullable(),
  status: z.enum(["draft", "posted", "voided"]),
  depositDate: day,
  reference: z.string().nullable(),
  bankAccount: z.object({ name: z.string(), accountCode: z.string(), last4: z.string().nullable() }),
  checks: z.array(
    z.object({
      paymentNumber: z.string().nullable(),
      customerName: z.string(),
      checkNumber: z.string().nullable(),
      receivedDate: day,
      amountCents: money,
    }),
  ),
  cash: z.array(
    z.object({
      paymentNumber: z.string().nullable(),
      customerName: z.string(),
      receivedDate: day,
      amountCents: money,
    }),
  ),
  checksCents: money,
  cashCents: money,
  totalCents: money,
  preparedBy: z.string().nullable(),
  voidNote: z.string().nullable(),
});

/**
 * DCardFront + DCardBack: a staff member's business card (3.5 × 2 in, front then back). The back's QR code opens
 * the portal's wholesale application. The job title and phone are typed when the card is made (nothing stores
 * them); the phone falls back to the business WhatsApp number.
 */
export const businessCardDocData = z.object({
  company: docCompany,
  name: z.string(),
  jobTitle: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Brands with an active item ("24 brands" on the back). */
  brandCount: z.number().int(),
  /** The portal's apply page ("wholesale.itsmarsa.com/apply"); null: the back prints no QR code. */
  applyLink: z.string().nullable(),
});

/** Why an order chosen for a picking slip printed none (Control shows "2 skipped: closed"). */
export const PICKING_SLIP_SKIP_REASONS = [
  "not_found",
  "legacy",
  "draft",
  "submitted",
  "on_hold",
  "closed",
  "cancelled",
  "nothing_to_pick",
] as const;
export type PickingSlipSkipReason = (typeof PICKING_SLIP_SKIP_REASONS)[number];
export const pickingSlipSkip = z.object({
  id: uuid,
  /** Null: no such order. */
  number: z.string().nullable(),
  reason: z.enum(PICKING_SLIP_SKIP_REASONS),
});
export type PickingSlipSkip = z.infer<typeof pickingSlipSkip>;
/**
 * The response header that lists the skipped orders (URI-encoded JSON of `PickingSlipSkip[]`) next to the PDF
 * bytes, and the one that counts the slips printed.
 */
export const PICKING_SLIPS_SKIPPED_HEADER = "x-picking-slips-skipped";
export const PICKING_SLIPS_PRINTED_HEADER = "x-picking-slips-printed";

/**
 * Picking slips (Ez, 24 Oct 2026; D162): one page per order the warehouse picks from, lines in walking order
 * (bin, then SKU), with what is still to pick (open − shipped) and a tick box. No money on it at all.
 */
export const pickingSlipDocData = z.object({
  company: docCompany,
  /** The business day the slips were printed. */
  printedOn: day,
  slips: z
    .array(
      z.object({
        orderNumber: z.string(),
        websiteOrder: z.string().nullable(),
        customer: z.object({ name: z.string(), number: z.string() }),
        shipTo: docAddress,
        customerPo: z.string().nullable(),
        /** The order's requested (need-by) day. */
        needBy: day.nullable(),
        /** "UPS Ground · 2 boxes"; null: no ship method set. */
        shipMethod: z.string().nullable(),
        /** The order's internal note (for Marsa, never the customer's). */
        note: z.string().nullable(),
        /** Deliveries of the order already in picking ("DL-00042"): the slip says so. */
        inPicking: z.array(z.string()),
        lines: z.array(
          z.object({
            /** The bin to pick from: the picking delivery's, else the bin holding the most; null: none. */
            bin: z.string().nullable(),
            sku: z.string(),
            name: z.string(),
            brand: z.string().nullable(),
            /** "Case of 12 · 100 ml"; null when the item has neither. */
            unit: z.string().nullable(),
            /** The item's picture as a JPEG data URI (none: the grey placeholder). */
            image: z.string().startsWith("data:image/").nullable().default(null),
            /** The brand's logo as a JPEG data URI; null when the brand has none. */
            logo: z.string().startsWith("data:image/").nullable().default(null),
            /** Ordered less cancelled. */
            orderedQty: z.number().int(),
            /** Ordered less cancelled less shipped. */
            toPickQty: z.number().int(),
            /** L5 (D1286): the order line's note for the picker. */
            note: z.string().nullable().default(null),
          }),
        ),
        /** Units still to pick on the slip. */
        units: z.number().int(),
      }),
    )
    .min(1),
});

// ── Labels (catalog-w5, D600–D629; ui-master-plan §4.3 tool 10) ────────

/**
 * Label stock: a shelf tag 2" × 1" (name, brand, price, barcode), an item sticker 1.25" × 0.75" (barcode, SKU,
 * short name) and a box label 4" × 2" (the case or box barcode with its pack quantity). One label a page, the
 * page the size of the label, for a label printer.
 */
export const LABEL_SIZES = ["shelf", "item", "box", "badge"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];
export const LABEL_SIZE_TEXT: Record<LabelSize, string> = {
  shelf: 'Shelf tag 2" × 1"',
  item: 'Item sticker 1.25" × 0.75"',
  box: 'Box label 4" × 2"',
  /** Marsa Time P8 (D1935): a kiosk badge, card size, printed only from Settings › Time clock. */
  badge: 'Kiosk badge 3.375" × 2.125"',
};
/** The price a label prints: none, or one of the item's prices (a blank tier is filled from the tier before). */
export const LABEL_PRICES = ["none", "retail", "standard", "tier1", "tier2", "tier3"] as const;
export type LabelPrice = (typeof LABEL_PRICES)[number];
export const BARCODE_SYMBOLOGIES = ["upc_a", "ean_13", "code128"] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

/** The GS1 check digit of the digits before it (UPC-A, EAN-13, EAN-8 alike). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * How a code is drawn: 12 digits with a good check digit as UPC-A, 13 as EAN-13, anything else (8 or 14
 * digits, a bad check digit, a SKU) as Code 128, which carries any text a scanner reads back as typed.
 */
export function barcodeSymbology(value: string): BarcodeSymbology {
  const ok = (v: string) => gs1CheckDigit(v.slice(0, -1)) === Number(v.slice(-1));
  if (/^\d{12}$/.test(value) && ok(value)) return "upc_a";
  if (/^\d{13}$/.test(value) && ok(value)) return "ean_13";
  return "code128";
}

export const labelsDocData = z.object({
  size: z.enum(LABEL_SIZES),
  labels: z
    .array(
      z.object({
        name: z.string(),
        sku: z.string(),
        brand: z.string().nullable(),
        /** "100 ml"; null when the item has none. */
        sizeText: z.string().nullable(),
        /** What the bars carry (a UPC, a case or box barcode, else the SKU) and how they are drawn. */
        barcode: z.object({ value: z.string().min(1).max(48), symbology: z.enum(BARCODE_SYMBOLOGIES) }),
        /** Units one scan of the barcode counts: 1, or the case or box's pack ("Case of 12" on a box label). */
        units: z.number().int().min(1),
        /** The price printed, in cents, and which price it is ("Retail"); null: no price on the label. */
        priceCents: z.number().int().nullable(),
        priceLabel: z.string().nullable(),
        /** How many of this label to print. */
        copies: z.number().int().min(1).max(500),
        /** P8 (D1935), badges: a second line under the name ("Picker · Main warehouse"). */
        subtitle: z.string().nullable().default(null),
        /** P8 (D1935), badges: the link the QR carries (opens the kiosk with the number filled in). */
        qrText: z.string().max(300).nullable().default(null),
      }),
    )
    .min(1)
    .max(1000),
});

/** The data schema of each PDF; the renderer parses its input with it. */
/** D2252: a straight bill of lading (VICS-style fields) for a pallet shipment, drawn by Control. */
const bolParty = z.object({
  name: z.string(),
  company: z.string().nullable(),
  lines: z.array(z.string()),
  phone: z.string().nullable(),
});
export const bolDocData = z.object({
  ...docBase,
  number: z.string(),
  bolNumber: z.string().nullable(),
  proNumber: z.string().nullable(),
  date: day,
  pickupDate: day.nullable(),
  carrier: z.string(),
  orderNumber: z.string(),
  customerPo: z.string().nullable(),
  shipper: bolParty,
  consignee: bolParty,
  billTo: bolParty,
  freightTerms: z.enum(["prepaid", "collect", "third_party"]),
  handlingUnits: z.array(
    z.object({
      quantity: z.number().int(),
      type: z.string(),
      weightLb: z.number(),
      lengthIn: z.number(),
      widthIn: z.number(),
      heightIn: z.number(),
      freightClass: z.string().nullable(),
      nmfc: z.string().nullable(),
      hazmat: z.boolean(),
      description: z.string(),
      pieces: z.number().int().nullable(),
    }),
  ),
  specialInstructions: z.string().nullable(),
});

export const PDF_DATA = {
  invoice: invoiceDocData,
  quote: quoteDocData,
  order_confirmation: orderConfirmationDocData,
  packing_slip: packingSlipDocData,
  statement: statementDocData,
  credit_note: creditNoteDocData,
  purchase_order: purchaseOrderDocData,
  remittance: remittanceDocData,
  catalog: catalogDocData,
  deposit_slip: depositSlipDocData,
  business_card: businessCardDocData,
  picking_slip: pickingSlipDocData,
  labels: labelsDocData,
  bill_of_lading: bolDocData,
} as const satisfies Record<PdfKind, z.ZodTypeAny>;
/** What core builds for a kind (money as cents strings). */
export type PdfDataInput<K extends PdfKind> = z.input<(typeof PDF_DATA)[K]>;
/** What the renderer reads for a kind. */
export type PdfData<K extends PdfKind> = z.output<(typeof PDF_DATA)[K]>;

// ── Phase 5: PDF routes ─────────────────────────────────────────────────

/**
 * A PDF answers `application/pdf` bytes, not JSON: the Control screens open the path in a new tab (Print) or
 * with `?download=1` (saved as a file), so it is never called through the typed client. Readable by whoever
 * may read the document (every signed-in person, as the record's own GET); what the person may not see
 * (a PO's unit costs without cost.view) isn't printed, and no PDF ever carries a cost.
 */
const pdfBytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected PDF bytes");
const pdfQuery = z.object({ download: boolQuery });

function pdfRoute(id: string, path: string, query: z.AnyZodObject = pdfQuery) {
  return route({
    id,
    method: "GET",
    path,
    access: { self: true },
    params: idParams,
    query,
    response: pdfBytes,
  });
}

export const invoicePdf = pdfRoute("documents.invoice_pdf", "/v1/invoices/:id/pdf");
/** D2252: the BOL of a pallet shipment. */
export const bolPdf = pdfRoute("documents.bol_pdf", "/v1/ltl-shipments/:id/bol.pdf");
export const quotePdf = pdfRoute("documents.quote_pdf", "/v1/quotes/:id/pdf");
export const creditNotePdf = pdfRoute("documents.credit_note_pdf", "/v1/credit-notes/:id/pdf");
export const purchaseOrderPdf = pdfRoute("documents.purchase_order_pdf", "/v1/purchase-orders/:id/pdf");
export const orderConfirmationPdf = pdfRoute(
  "documents.order_confirmation_pdf",
  "/v1/sales-orders/:id/confirmation.pdf",
);
export const packingSlipPdf = pdfRoute("documents.packing_slip_pdf", "/v1/deliveries/:id/packing-slip.pdf");
export const remittancePdf = pdfRoute("documents.remittance_pdf", "/v1/vendor-payments/:id/remittance.pdf");
/** The customer's statement on a day (default today): open invoices aged from their due date. */
export const statementPdf = pdfRoute(
  "documents.statement_pdf",
  "/v1/customers/:id/statement.pdf",
  pdfQuery.extend({ asOf: day.optional() }),
);
/** The catalog at the customer's price list: active items by brand, with MSRP and the valid-until day. */
export const catalogPdf = pdfRoute("documents.catalog_pdf", "/v1/customers/:id/catalog.pdf");

/**
 * DCardFront + DCardBack for a staff member: anyone for their own card, users.manage for someone else's. The
 * title and phone are printed as typed (not stored).
 */
export const businessCardPdf = route({
  id: "documents.business_card_pdf",
  method: "GET",
  path: "/v1/users/:id/business-card.pdf",
  access: { self: true },
  params: idParams,
  query: pdfQuery.extend({
    title: z.string().trim().max(60).optional(),
    phone: z.string().trim().max(30).optional(),
  }),
  response: pdfBytes,
});

/**
 * Picking slips for the orders ticked on Sales orders (Ez, 24 Oct 2026; D162): one PDF, one page per order
 * that has something to pick. Orders that don't (draft, on hold, closed, legacy, all shipped) are skipped and
 * listed in the `x-picking-slips-skipped` header; none left: 422 nothing_to_pick. It reads, so no
 * Idempotency-Key; POST only because 100 ids don't fit a link. Warehouse permission, as picking itself.
 */
export const pickingSlipsPdf = route({
  id: "documents.picking_slips_pdf",
  method: "POST",
  path: "/v1/sales-orders/picking-slips.pdf",
  access: { permission: "stock.move" },
  query: pdfQuery,
  body: z.object({ ids: z.array(uuid).min(1).max(100) }).strict(),
  response: pdfBytes,
});

/**
 * Labels (catalog-w5): shelf tags, item stickers or box labels for the items picked, `qty` of each (the item
 * list's bulk action, the item page, a receipt's received units, the handheld's Look up and Labels), and bin
 * labels (U8). Each item prints its
 * UPC (shelf and item) or its case / box barcode (box), else another of its barcodes, else its SKU as Code 128;
 * `barcode` picks one of the item's own codes instead. At most 1,000 labels a PDF. It reads, so no
 * Idempotency-Key; POST because the list doesn't fit a link. Every signed-in person, as the items themselves.
 */
export const labelsPdf = route({
  id: "documents.labels_pdf",
  method: "POST",
  path: "/v1/labels.pdf",
  access: { self: true },
  query: pdfQuery,
  body: z
    .object({
      size: z.enum(LABEL_SIZES).default("shelf"),
      price: z.enum(LABEL_PRICES).default("retail"),
      items: z
        .array(
          z
            .object({
              productId: uuid,
              qty: z.number().int().min(1).max(500),
              barcode: z
                .string()
                .trim()
                .regex(/^\d{8,14}$/)
                .optional(),
            })
            .strict(),
        )
        .max(200)
        .default([]),
      /**
       * U8 (D1467): bin labels — the bin's code as Code 128 (what the floor scans to set a bin), its name and
       * warehouse; `qty` copies each. A PDF needs at least one item or bin.
       */
      bins: z
        .array(z.object({ binId: uuid, qty: z.number().int().min(1).max(500) }).strict())
        .max(200)
        .default([]),
      /**
       * Marsa Time P8 (D1935): kiosk badges — the person's number as Code 128 (a wedge scanner types it into the
       * kiosk) and as a QR link that opens the kiosk with the number filled in; name, job and site. Size `badge`,
       * alone (no items or bins), for people who look after time (time.approve / time.manage).
       */
      badges: z
        .array(z.object({ employeeId: uuid, qty: z.number().int().min(1).max(20) }).strict())
        .max(200)
        .default([]),
    })
    .strict(),
  response: pdfBytes,
});

export const sendDocumentResult = z.object({
  /** Held: no email on file (the message waits on Home with the reason). */
  held: z.boolean(),
  messageIds: z.array(uuid),
});

/**
 * Send statement: the customer's statement and pay link by email (and WhatsApp when slice 2 adds it); the
 * PDF is rendered when the message is sent, from the open invoices at that moment. statements.send (Ez #40):
 * Finance sends statements without documents.sales.edit.
 */
export const sendStatement = route({
  id: "documents.send_statement",
  method: "POST",
  path: "/v1/customers/:id/send-statement",
  access: { permission: "statements.send" },
  idempotency: "optional",
  params: idParams,
  body: z.object({}).strict(),
  response: sendDocumentResult,
});

/** Send catalog: the catalog PDF at the customer's prices by email. */
export const sendCatalog = route({
  id: "documents.send_catalog",
  method: "POST",
  path: "/v1/customers/:id/send-catalog",
  access: { permission: "documents.sales.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({}).strict(),
  response: sendDocumentResult,
});

/** The phase-5 document routes, which `CONTRACTS` spreads in (design §3.3). */
// ── W7: the email log on sales documents (D1510) ────────────────────────

/** The documents that keep an email log: every send of theirs is an outbox message with this source. */
export const EMAIL_LOG_TYPES = ["quote", "sales_order", "invoice", "statement", "credit_note"] as const;
export type EmailLogType = (typeof EMAIL_LOG_TYPES)[number];

export const documentEmailRow = z.object({
  id: uuid,
  template: z.string(),
  recipient: z.string(),
  status: z.enum(["pending", "sent", "failed", "held", "dead"]),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: isoTime,
  sentAt: isoTime.nullable(),
  /** Opens are not tracked (no pixel; D1510), so this is always null today. */
  openedAt: isoTime.nullable(),
  /** The message carried a one-time link that was removed once sent: it can't be resent. */
  resendable: z.boolean(),
});

export const listDocumentEmails = route({
  id: "sales.emails.list",
  method: "GET",
  path: "/v1/documents/:type/:id/emails",
  access: { self: true },
  params: z.object({ type: z.enum(EMAIL_LOG_TYPES), id: uuid }),
  response: z.object({ rows: z.array(documentEmailRow) }),
});

/** Queues the same message again (same template, recipient and content, a fresh key); the log gets a new row. */
export const resendDocumentEmail = route({
  id: "sales.emails.resend",
  method: "POST",
  path: "/v1/documents/:type/:id/emails/:messageId/resend",
  access: { permission: ["statements.send", "documents.sales.edit"] },
  idempotency: "required",
  status: 201,
  params: z.object({ type: z.enum(EMAIL_LOG_TYPES), id: uuid, messageId: uuid }),
  body: z
    .object({ to: z.string().trim().email().max(200).optional() })
    .strict()
    .optional(),
  response: documentEmailRow,
});

export const ROUTES = {
  invoicePdf,
  quotePdf,
  creditNotePdf,
  purchaseOrderPdf,
  orderConfirmationPdf,
  packingSlipPdf,
  remittancePdf,
  statementPdf,
  catalogPdf,
  sendStatement,
  sendCatalog,
  businessCardPdf,
  pickingSlipsPdf,
  labelsPdf,
  bolPdf,
  // W7 (D1510): the email log on sales documents, with Resend.
  listDocumentEmails,
  resendDocumentEmail,
} satisfies Record<string, RouteContract>;
