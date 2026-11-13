import { z } from "zod";
import {
  centsString,
  columnSearch,
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
import { approvalRow } from "./documents.js";

/**
 * Purchase orders (PurchaseOrders, PurchaseOrder, PurchaseDialogs boards; phase 2 slice 2). Reads are for
 * every signed-in person; cost-bearing fields (unit costs, totals, the cost card) are present only with
 * cost.view and margins only with margin.view, so they are optional in the schemas.
 */

export const PO_STATUSES = ["draft", "approved", "sent", "closed", "cancelled"] as const;
export const PO_RECEIVING_STATUSES = ["not_received", "partly_received", "received"] as const;
export const PO_BILLING_STATUSES = ["not_billed", "partly_billed", "billed"] as const;
/** The PurchaseOrders board's columns (the actions-by-state table's states). */
export const PO_COLUMNS = [
  "draft",
  "approved",
  "sent",
  "partly_received",
  "received_to_bill",
  "closed",
  "cancelled",
] as const;
export const PO_CANCEL_REASONS = [
  "ordered_elsewhere",
  "price_changed",
  "no_longer_needed",
  "vendor_cannot_supply",
] as const;
export const PO_CREATED_FROM = ["manual", "reorder", "clone", "duplicate", "sales_order"] as const;
export const PO_SORTS = [
  "number",
  "orderDate",
  "vendor",
  "status",
  "received",
  "billing",
  "total",
  "expectedDate",
] as const;
export const PO_ACTIONS = [
  "edit",
  "approve",
  "send",
  "receive",
  "bill",
  "cloneRemaining",
  "closeShort",
  "changeDestination",
  "vendorCredit",
  "duplicate",
  "delete",
  "cancel",
  "reopen",
] as const;

const version = z.number().int().min(1);
const note = z.string().trim().min(1, "Say why").max(500);
/** Whole cents, as a number or a string of digits (totals may exceed the safe integer range). */
const centsInput = z.union([z.number().int().min(0), z.string().regex(/^\d+$/)]);

/** `true`, or the reason the button is disabled (the state, a missing permission, a missing cost ...). */
export const actionAllowed = z.union([z.literal(true), z.object({ reason: z.string() })]);
export const poActions = z.object(
  Object.fromEntries(PO_ACTIONS.map((a) => [a, actionAllowed])) as Record<
    (typeof PO_ACTIONS)[number],
    typeof actionAllowed
  >,
);

const warehouseRef = z.object({ id: uuid, code: z.string(), name: z.string() });

export const poLineRow = z.object({
  id: uuid,
  lineNo: z.number().int(),
  product: z.object({
    id: uuid,
    sku: z.string(),
    name: z.string(),
    upc: z.string().nullable(),
    brand: z.string(),
    status: z.string(),
  }),
  orderedQty: z.number().int(),
  overAcceptedQty: z.number().int(),
  cancelledQty: z.number().int(),
  receivedQty: z.number().int(),
  billedQty: z.number().int(),
  /** ordered + over accepted − cancelled − received. */
  openQty: z.number().int(),
  noCharge: z.boolean(),
  /** The line's own destination when it overrides the PO's. */
  warehouse: warehouseRef.nullable(),
  expectedDate: day.nullable(),
  /** Only with cost.view. */
  unitCostCents: z.number().int().nullable().optional(),
  lineTotalCents: centsString.optional(),
  /** This line's share of the PO freight and vendor discount, spread by value (decided). */
  freightShareCents: centsString.optional(),
  discountShareCents: centsString.optional(),
});

export const poApproval = z.object({
  id: uuid,
  status: z.enum(["pending", "approved", "rejected", "expired", "invalidated"]),
  requestedBy: userRef,
  requestedAt: isoTime,
  decidedBy: userRef.nullable(),
  decidedAt: isoTime.nullable(),
  decisionNote: z.string().nullable(),
  limitCents: z.number().int().nullable(),
});

export const poRow = z.object({
  id: uuid,
  number: z.string(),
  vendor: z.object({ id: uuid, name: z.string(), email: z.string().nullable() }),
  warehouse: warehouseRef,
  status: z.enum(PO_STATUSES),
  receivingStatus: z.enum(PO_RECEIVING_STATUSES),
  billingStatus: z.enum(PO_BILLING_STATUSES),
  column: z.enum(PO_COLUMNS),
  orderDate: day,
  expectedDate: day.nullable(),
  terms: z.object({ code: z.string(), label: z.string() }),
  vendorReference: z.string().nullable(),
  /** Tracking number and vendor invoice number (D302). */
  trackingNumber: z.string().nullable().default(null),
  vendorInvoiceNo: z.string().nullable().default(null),
  noteToVendor: z.string().nullable(),
  internalNote: z.string().nullable(),
  lineCount: z.number().int(),
  unitsOrdered: z.number().int(),
  unitsReceived: z.number().int(),
  sentAt: isoTime.nullable(),
  sentCount: z.number().int(),
  cancelReason: z.enum(PO_CANCEL_REASONS).nullable(),
  cancelNote: z.string().nullable(),
  cancelledAt: isoTime.nullable(),
  cancelledBy: userRef.nullable(),
  closedAt: isoTime.nullable(),
  closedBy: userRef.nullable(),
  closeNote: z.string().nullable(),
  reopenedAt: isoTime.nullable(),
  reopenedBy: userRef.nullable(),
  reopenNote: z.string().nullable(),
  createdFrom: z.enum(PO_CREATED_FROM),
  sourcePo: z.object({ id: uuid, number: z.string() }).nullable(),
  /** The newest po_approval request, when the PO ever needed one. */
  approval: poApproval.nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  createdBy: userRef.nullable(),
  updatedAt: isoTime.nullable(),
  updatedBy: userRef.nullable(),
  /** Only with cost.view. */
  subtotalCents: centsString.optional(),
  discountCents: centsString.optional(),
  freightCents: centsString.optional(),
  totalCents: centsString.optional(),
  freightSpreadCents: centsString.optional(),
  discountSpreadCents: centsString.optional(),
});

/** The PO's receipts and bills with values received and billed (D302); money only with cost.view. */
export const poRelated = z.object({
  receipts: z.array(
    z.object({
      id: uuid,
      number: z.string().nullable(),
      status: z.string(),
      receivedDate: day.nullable(),
      units: z.number().int(),
      valueCents: centsString.optional(),
    }),
  ),
  bills: z.array(
    z.object({
      id: uuid,
      label: z.string(),
      status: z.string(),
      billDate: day,
      vendorInvoiceNo: z.string(),
      totalCents: centsString.optional(),
      poShareCents: centsString.optional(),
      balanceCents: centsString.optional(),
    }),
  ),
  valuesReceivedCents: centsString.optional(),
  billedCents: centsString.optional(),
  receivedNotBilledCents: centsString.optional(),
});

export const poDetail = poRow.extend({
  lines: z.array(poLineRow),
  actions: poActions,
  related: poRelated.default({ receipts: [], bills: [] }),
});

const idParams = z.object({ id: uuid });

export const listPurchaseOrders = route({
  id: "purchase_orders.list",
  method: "GET",
  path: "/v1/purchase-orders",
  access: { self: true },
  query: z.object({
    /** Matches the number, the vendor's name or the vendor reference. */
    search: z.string().trim().max(100).optional(),
    vendorId: uuid.optional(),
    status: z.enum(PO_STATUSES).optional(),
    column: z.enum(PO_COLUMNS).optional(),
    /** Column-header filters (D282): the PO number, the vendor's name, and board columns. */
    number: columnSearch,
    vendor: columnSearch,
    statuses: csvEnum(PO_COLUMNS),
    /** Order dates, inclusive. */
    from: day.optional(),
    to: day.optional(),
    /** Expected dates, inclusive (U4, Home's "Receiving today"); a PO with no expected date never matches. */
    expectedFrom: day.optional(),
    expectedTo: day.optional(),
    /** Newest first by default; `total` needs cost.view. */
    sort: z.enum(PO_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(poRow),
});

export const getPurchaseOrder = route({
  id: "purchase_orders.get",
  method: "GET",
  path: "/v1/purchase-orders/:id",
  access: { self: true },
  params: idParams,
  response: poDetail,
});

const lineInput = z
  .object({
    /** The existing line (edits); a line without an id is added. */
    id: uuid.optional(),
    productId: uuid,
    quantity: z.number().int().min(1).max(1_000_000),
    /** Null while unknown; 0 only with noCharge. */
    unitCostCents: z.number().int().min(0).nullable().optional(),
    noCharge: z.boolean().optional(),
    warehouseId: uuid.nullable().optional(),
    expectedDate: day.nullable().optional(),
  })
  .strict();

const headerFields = {
  warehouseId: uuid.optional(),
  expectedDate: day.nullable().optional(),
  vendorReference: z.string().trim().max(100).nullable().optional(),
  noteToVendor: z.string().trim().max(2000).nullable().optional(),
  internalNote: z.string().trim().max(2000).nullable().optional(),
  discountCents: centsInput.nullable().optional(),
  freightCents: centsInput.nullable().optional(),
};

/** New PO: the number is issued on this first save; status Draft. */
export const createPurchaseOrder = route({
  id: "purchase_orders.create",
  method: "POST",
  path: "/v1/purchase-orders",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  body: z
    .object({
      vendorId: uuid,
      orderDate: day.optional(),
      termsCode: z.string().trim().min(1).max(32).optional(),
      ...headerFields,
      lines: z.array(lineInput).min(1, "Add at least one line").max(500),
    })
    .strict(),
  response: poDetail,
});

/**
 * Edit lines, costs, dates and notes. Approved goes back to Draft; Sent re-notifies the vendor; a received
 * line can't be removed, lowered below what was received or re-costed. `lines` is the full set.
 */
export const updatePurchaseOrder = route({
  id: "purchase_orders.update",
  method: "PATCH",
  path: "/v1/purchase-orders/:id",
  access: { permission: "purchasing.edit" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      ...headerFields,
      lines: z.array(lineInput).min(1, "Add at least one line").max(500).optional(),
    })
    .strict(),
  response: poDetail,
});

/** Tracking number and vendor invoice number: any status but Cancelled, no vendor email (D302). */
export const setPurchaseOrderReferences = route({
  id: "purchase_orders.references",
  method: "PATCH",
  path: "/v1/purchase-orders/:id/references",
  access: { permission: "purchasing.edit" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      trackingNumber: z.string().trim().max(100).nullable().optional(),
      vendorInvoiceNo: z.string().trim().max(100).nullable().optional(),
    })
    .strict(),
  response: poDetail,
});

/**
 * Send (or resend, or "Mark sent"). Over the approval limit the request is opened and the answer is 202
 * waiting_approval; a vendor without an email gets the message held and `warnings: ["vendor_no_email"]`.
 */
export const sendPurchaseOrder = route({
  id: "purchase_orders.send",
  method: "POST",
  path: "/v1/purchase-orders/:id/send",
  access: { permission: ["purchasing.edit", "purchasing.approve"] },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, markOnly: z.boolean().optional() }).strict(),
  response: z.object({
    po: poDetail,
    outcome: z.enum(["sent", "waiting_approval"]),
    warnings: z.array(z.string()),
    approval: approvalRow.nullable(),
  }),
});

export const cancelPurchaseOrder = route({
  id: "purchase_orders.cancel",
  method: "POST",
  path: "/v1/purchase-orders/:id/cancel",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      version,
      reason: z.enum(PO_CANCEL_REASONS),
      note,
      /** Defaults to true when the PO was sent. */
      emailVendor: z.boolean().optional(),
      /** Discard receipts in progress instead of refusing. */
      discardReceipts: z.boolean().optional(),
    })
    .strict(),
  response: poDetail,
});

export const closePurchaseOrderShort = route({
  id: "purchase_orders.close_short",
  method: "POST",
  path: "/v1/purchase-orders/:id/close-short",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, note, discardReceipts: z.boolean().optional() }).strict(),
  response: poDetail,
});

/** Partly received only: a new draft with the undelivered units at the same costs. */
export const clonePurchaseOrderRemaining = route({
  id: "purchase_orders.clone_remaining",
  method: "POST",
  path: "/v1/purchase-orders/:id/clone-remaining",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({}).strict().optional(),
  response: poDetail,
});

/** Any state: a new draft with the same lines at the vendor's last paid cost (default) or the source's. */
export const duplicatePurchaseOrder = route({
  id: "purchase_orders.duplicate",
  method: "POST",
  path: "/v1/purchase-orders/:id/duplicate",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ useLastCost: z.boolean().optional() }).strict().optional(),
  response: poDetail,
});

export const changePurchaseOrderDestination = route({
  id: "purchase_orders.destination",
  method: "POST",
  path: "/v1/purchase-orders/:id/destination",
  access: { permission: "purchasing.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, warehouseId: uuid, lineIds: z.array(uuid).min(1).optional() }).strict(),
  response: poDetail,
});

export const reopenPurchaseOrder = route({
  id: "purchase_orders.reopen",
  method: "POST",
  path: "/v1/purchase-orders/:id/reopen",
  access: { permission: "purchasing.edit" },
  idempotency: "required",
  params: idParams,
  body: z.object({ version, note }).strict(),
  response: poDetail,
});

/** Delete a draft that was never sent; anything else answers 409 use_cancel. */
export const deletePurchaseOrder = route({
  id: "purchase_orders.delete",
  method: "DELETE",
  path: "/v1/purchase-orders/:id",
  access: { permission: "purchasing.edit" },
  params: idParams,
  query: z.object({ version: z.coerce.number().int().min(1) }),
  noContent: true,
});

export const purchaseHistoryRow = z.object({
  vendorId: uuid,
  vendorName: z.string(),
  date: day,
  poNumber: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  units: z.number().int(),
  unitCostCents: z.number().int(),
});

/** The cost card on a PO line (cost.view; margins with margin.view): posted receipts only. */
export const costCard = route({
  id: "purchasing.cost_card",
  method: "GET",
  path: "/v1/purchasing/cost-card",
  access: { permission: "cost.view" },
  query: z.object({
    productId: uuid,
    vendorId: uuid,
    unitCostCents: z.coerce.number().int().min(0).optional(),
    quantity: z.coerce.number().int().min(0).default(0),
  }),
  response: z.object({
    product: z.object({ id: uuid, sku: z.string(), name: z.string() }),
    vendor: z.object({ id: uuid, name: z.string() }),
    thisCostCents: z.number().int().nullable(),
    quantity: z.number().int(),
    lastCostCents: z.number().int().nullable(),
    changeCents: z.number().int().nullable(),
    changeLabel: z.enum(["first_purchase", "same", "up", "down", "no_cost"]),
    averageNowCents: z.number().int().nullable(),
    averageSource: z.enum(["layers", "fallback", "none"]),
    onHand: z.number().int(),
    averageAfterCents: z.number().int().nullable(),
    sellsAtStandardCents: z.number().int(),
    minimumPriceCents: z.number().int().nullable(),
    marginAtStandardBp: z.number().int().nullable().optional(),
    marginAtMinimumBp: z.number().int().nullable().optional(),
    thisVendor: z.array(purchaseHistoryRow),
    otherVendors: z.array(purchaseHistoryRow),
  }),
});
