import { z } from "zod";
import {
  type RouteContract,
  centsString,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  page,
  route,
  uuid,
} from "../http.js";
import type { Permission } from "../permissions.js";

/**
 * Orders from before cut-over (Customer › "Before cut-over"; phase-6-design.md §2.5, §9). Read-only history in
 * the `legacy` schema, never posted.
 *
 * Filled by slice 5 `p6-history` (the reads) and slice 9 `p6-legacy-after-cutover` (the history refund).
 * Slice 1 lands the file, its shapes and its empty route map so the slices that fill it never touch `index.ts`:
 * every contract added here goes into `ROUTES`, which `CONTRACTS` spreads in (and the API's route-table test
 * then expects it served). The portal's "Earlier orders" go in `routes/portal/history.ts`.
 *
 * - `GET /v1/history/orders` (customer, number, dates), `GET /v1/history/orders/:id` — sales or finance
 *   (`HISTORY_READ`: Sales, Finance, Manager, Admin, Owner; not Warehouse or Viewer — cut-over blocker History 7)
 * - `POST /v1/history/orders/:id/refund-review/:reviewId` (Finance posts the history refund) — `credit_notes.post`
 * - `POST /v1/history/orders/:id/returns` (slice 9: a return of a sale from before cut-over, restock and credit)
 *   — `stock.move` and `credit_notes.post`
 */
/** Where a history order came from: the database export, or the read-only WooCommerce import. */
export const HISTORY_ORIGINS = ["snapshot", "woocommerce"] as const;

export const historyOrderRow = z.object({
  id: uuid,
  /** The website number ("1004133"). */
  number: z.string(),
  createdOn: isoTime.nullable(),
  paidAt: isoTime.nullable(),
  status: z.string(),
  gateway: z.string().nullable(),
  /** The gateway as the shopper saw it ("Credit card (Stripe)"); WooCommerce import only. */
  gatewayTitle: z.string().nullable(),
  currency: z.string().nullable(),
  totalCents: centsString,
  /** The refunds' sum (positive). */
  refundedCents: centsString,
  origin: z.enum(HISTORY_ORIGINS),
  oldInvoiceNumber: z.string().nullable(),
  dueDate: day.nullable(),
  poNumber: z.string().nullable(),
  customer: z.object({ id: uuid, number: z.string(), name: z.string() }).nullable(),
  /** WooCommerce admin link for staff ("Open in WooCommerce"). */
  wooUrl: z.string().nullable(),
  /** Staff: the billing name and email as WooCommerce had them (the order may match no customer here). */
  billingName: z.string().nullable(),
  billingEmail: z.string().nullable(),
  /** Staff: the website ingest captured this order too ("also in Control"): its sales order. */
  alsoInControl: z.object({ id: uuid, number: z.string() }).nullable(),
});

/** A line a refund gave back (WooCommerce import). */
export const historyRefundLine = z.object({
  sku: z.string().nullable(),
  name: z.string(),
  quantity: z.number().int(),
  totalCents: centsString,
});

export const historyOrderLineRow = z.object({
  id: uuid,
  productId: uuid.nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  quantity: z.number().int(),
  unitPriceCents: centsString,
  lineTotalCents: centsString,
  taxCents: centsString,
});

export const historyRefundRow = z.object({
  id: uuid,
  amountCents: centsString,
  refundedAt: isoTime.nullable(),
  reason: z.string().nullable(),
  lines: z.array(historyRefundLine),
});

export const historyOrderDetail = historyOrderRow.extend({
  completedAt: isoTime.nullable(),
  transactionId: z.string().nullable(),
  subtotalCents: centsString,
  discountCents: centsString,
  shippingCents: centsString,
  taxCents: centsString,
  lines: z.array(historyOrderLineRow),
  refunds: z.array(historyRefundRow),
});

/** A payment the old system recorded against the order (§2.5 `legacy.payments`), with what it applied here. */
export const historyPaymentRow = z.object({
  id: uuid,
  method: z.string().nullable(),
  amountCents: centsString,
  /** The part of the payment the old system applied to this order. */
  appliedCents: centsString,
  paidOn: day.nullable(),
  /** Whether the old ledger posted a journal for it. */
  hasJournal: z.boolean(),
  /** A payment, or a refund given back (WooCommerce import: a negative amount). */
  kind: z.enum(["payment", "refund"]),
  methodTitle: z.string().nullable(),
  transactionId: z.string().nullable(),
  /** The processor's fee from the order's meta; null when none was recorded. */
  feeCents: centsString.nullable(),
});

export const historyOrderView = historyOrderDetail.extend({ payments: z.array(historyPaymentRow) });

export const listHistoryOrdersQuery = z.object({
  customerId: uuid.optional(),
  /**
   * The website number ("1004133" or "#1004133"), the old invoice number or the PO number; for staff also the
   * billing name or email.
   */
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
  origin: z.enum(HISTORY_ORIGINS).optional(),
  from: day.optional(),
  to: day.optional(),
  limit: limitQuery,
  offset: offsetQuery,
});

/**
 * Who reads the old orders (cut-over blocker History 7, launch 24 Oct 2026): the roles that read sales or
 * finance — holding `documents.sales.edit` (Sales, Manager) or `invoices.post` (Finance, Sales, Manager); Admin
 * and Owner hold both. Warehouse and Viewer don't see "Before cut-over" or Website history.
 */
export const HISTORY_READ = [
  "documents.sales.edit",
  "invoices.post",
] as const satisfies readonly Permission[];

/** Orders from before cut-over, newest first: by customer, by old number, by dates. */
export const listHistoryOrders = route({
  id: "history.orders.list",
  method: "GET",
  path: "/v1/history/orders",
  access: { permission: HISTORY_READ },
  query: listHistoryOrdersQuery,
  response: page(historyOrderRow),
});

/**
 * Slice 9: a refund made in WooCommerce after cut-over on an order from before it, waiting in the review queue
 * as its history refund (Woo's split), or posted by Finance (Dr 4900 · 4400 · 2100 / Cr 1131).
 */
export const historyRefundReviewRow = z.object({
  id: uuid,
  wooRefundId: z.string(),
  refundedOn: day,
  amountCents: centsString,
  goodsCents: centsString,
  shippingCents: centsString,
  taxCents: centsString,
  status: z.enum(["pending", "posted", "dismissed"]),
  reason: z.string(),
  journalNumber: z.string().nullable(),
  resolvedAt: isoTime.nullable(),
  resolutionNote: z.string().nullable(),
});

/**
 * Slice 9: goods of the order returned after cut-over: restocked at average cost (Dr 1200 / Cr 5000) and
 * credited to the customer (Dr 4900 · 2100 / Cr 2610), the credit kept as store credit.
 */
export const historyReturnRow = z.object({
  id: uuid,
  returnedOn: day,
  units: z.number().int(),
  valueCents: centsString,
  goodsCents: centsString,
  taxCents: centsString,
  creditCents: centsString,
  payment: z.object({ id: uuid, number: z.string().nullable(), unappliedCents: centsString }).nullable(),
  journalNumber: z.string().nullable(),
  lines: z.array(z.object({ lineId: uuid, quantity: z.number().int() })),
});

/** Staff's view: the order as the old system had it, and what happened to it after cut-over. */
export const staffHistoryOrderView = historyOrderView.extend({
  refundReviews: z.array(historyRefundReviewRow),
  returns: z.array(historyReturnRow),
});

/** One order from before cut-over with its lines, refunds and payments, as the old system recorded them. */
export const getHistoryOrder = route({
  id: "history.orders.get",
  method: "GET",
  path: "/v1/history/orders/:id",
  access: { permission: HISTORY_READ },
  params: z.object({ id: uuid }),
  response: staffHistoryOrderView,
});

/** Finance posts the history refund of a Woo refund made after cut-over on an order from before it. */
export const postHistoryRefund = route({
  id: "history.orders.refund_review.post",
  method: "POST",
  path: "/v1/history/orders/:id/refund-review/:reviewId",
  access: { permission: "credit_notes.post" },
  idempotency: "optional",
  params: z.object({ id: uuid, reviewId: uuid }),
  body: z.object({ note: z.string().trim().max(1000).nullish() }).strict(),
  response: historyRefundReviewRow,
});

/** Goods of a sale from before cut-over come back: restocked at average cost and credited (2610). */
export const returnHistoryOrder = route({
  id: "history.orders.return",
  method: "POST",
  path: "/v1/history/orders/:id/returns",
  // The service checks both stock.move and credit_notes.post (Manager, Admin, Owner).
  access: { permission: ["stock.move", "credit_notes.post"] },
  idempotency: "required",
  params: z.object({ id: uuid }),
  body: z
    .object({
      lines: z
        .array(z.object({ lineId: uuid, quantity: z.number().int().min(1).max(1_000_000) }).strict())
        .min(1)
        .max(500),
      returnDate: day.optional(),
      binId: uuid.nullish(),
      note: z.string().trim().max(1000).nullish(),
    })
    .strict(),
  response: historyReturnRow,
  status: 201,
});

export const ROUTES = {
  listHistoryOrders,
  getHistoryOrder,
  postHistoryRefund,
  returnHistoryOrder,
} satisfies Record<string, RouteContract>;
