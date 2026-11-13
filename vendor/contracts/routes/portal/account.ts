import { z } from "zod";
import { type RouteContract, centsString, day, isoTime, route, uuid } from "../../http.js";

/**
 * Account change requests, addresses and returns on the portal (docs/phases/phase-5-design.md §3.2 Team and
 * Shop, §6 slice 7 `p5-portal-money`; boards WAccount, WAddresses, WReturn).
 *
 * - Team (Owners): change requests (legal name, tax ID, Net terms: reviewed by Marsa) and addresses. A new
 *   ship-to waits for Marsa to set its tax rate (`waitingForRate`; an order to it can't be confirmed until then)
 *   and is exempt only where an approved certificate covers its state. The label, receiving hours and dock change
 *   at once; moving the billing address, or a ship-to whose rate Marsa set, answers with a `changeRequest`
 *   instead (the address stays as it was until approved). Buyers read the addresses at checkout (`GET cart`).
 * - Shop (Owners and Buyers): returns, with the shipments' returnable lines; photos (uploaded first through
 *   `POST files`) are required when anything arrived damaged; a request lands at Marsa as Requested (an RMA
 *   number when approved; after 30 days from delivery it needs the rep's approval).
 *
 * Another customer's record and a random id are the same 404 `not_found`, in the path or the body (a shipment
 * line, a photo). Refusals in plain words: `change_pending`, `invalid_terms`, `invalid_tax_id`, `no_change`,
 * `stale_version`, `billing_address`, `default_address`, `address_in_use`, `not_ship_to`, `invalid_state`,
 * `invalid_postal_code`, `photos_required` (422), `file_in_use`, `over_returned` (details.left), `lines_required`,
 * `unsupported_file_type` (415), `file_too_large` (413).
 */

const version = z.number().int().min(1);
const idParams = z.object({ id: uuid });

export const CHANGE_KINDS = ["legal_name", "tax_id", "terms", "address"] as const;
export const ASKABLE_CHANGES = ["legal_name", "tax_id", "terms"] as const;
export const CHANGE_STATUSES = ["pending", "approved", "rejected"] as const;
export const RETURN_REASONS = [
  "damaged_in_transit",
  "wrong_item",
  "not_as_described",
  "ordered_by_mistake",
] as const;
export const RETURN_OUTCOMES = ["credit", "replacement"] as const;
export const PORTAL_RETURN_STATUSES = [
  "requested",
  "approved",
  "received",
  "inspected",
  "credited",
  "replaced",
  "cancelled",
] as const;
export const UPLOAD_PURPOSES = ["return"] as const;

// ── Shapes ──────────────────────────────────────────────────────────────

export const changeRequestOut = z.object({
  id: uuid,
  kind: z.enum(CHANGE_KINDS),
  kindLabel: z.string(),
  /** What is asked for, in words (an address on one line). */
  after: z.string(),
  status: z.enum(CHANGE_STATUSES),
  note: z.string().nullable(),
  createdAt: isoTime,
  decidedAt: isoTime.nullable(),
});

export const portalAddress = z.object({
  id: uuid,
  kind: z.enum(["billing", "ship_to"]),
  isDefault: z.boolean(),
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  receivingHours: z.string().nullable(),
  dock: z.boolean().nullable(),
  taxStatus: z.enum(["taxable", "exempt"]),
  taxRatePpm: z.number().int().nullable(),
  /** Marsa hasn't set its tax rate yet: an order to it waits for that. */
  waitingForRate: z.boolean(),
  /** A move waiting for Marsa. */
  pendingChange: z.object({ id: uuid, after: z.string() }).nullable(),
  version: z.number().int(),
});

const addressFields = {
  label: z.string().trim().max(100).nullable().optional(),
  line2: z.string().trim().max(200).nullable().optional(),
  receivingHours: z.string().trim().max(100).nullable().optional(),
  dock: z.boolean().nullable().optional(),
};

export const storedFile = z.object({
  id: uuid,
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedAt: isoTime,
});

export const portalReturnRow = z.object({
  id: uuid,
  /** RMA-0001 once Marsa approved it. */
  number: z.string().nullable(),
  status: z.enum(PORTAL_RETURN_STATUSES),
  statusLabel: z.string(),
  orderNumber: z.string(),
  deliveryNumber: z.string(),
  requestedAt: isoTime,
  outcome: z.enum(RETURN_OUTCOMES),
  late: z.boolean(),
  units: z.number().int(),
  /** The credit expected for the units, tax included (issued when the goods are inspected). */
  estimateCents: centsString,
});

export const portalReturn = portalReturnRow.extend({
  note: z.string().nullable(),
  lines: z.array(
    z.object({
      name: z.string(),
      sku: z.string(),
      quantity: z.number().int(),
      reason: z.enum(RETURN_REASONS),
      reasonLabel: z.string(),
      receivedQty: z.number().int(),
    }),
  ),
  photos: z.array(storedFile),
  creditNote: z.object({ number: z.string().nullable(), totalCents: centsString }).nullable(),
});

export const returnable = z.object({
  order: z.object({ id: uuid, number: z.string() }),
  windowDays: z.number().int(),
  deliveries: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      deliveredOn: day,
      /** Returns approved by the window until this day; after it, the rep approves them. */
      openUntil: day,
      late: z.boolean(),
      lines: z.array(
        z.object({
          deliveryLineId: uuid,
          productId: uuid,
          name: z.string(),
          sku: z.string(),
          upc: z.string().nullable(),
          shippedQty: z.number().int(),
          returnedQty: z.number().int(),
          returnableQty: z.number().int(),
        }),
      ),
    }),
  ),
});

// ── Business profile ────────────────────────────────────────────────────

/**
 * WAccount's business profile (launch, cut-over blocker Portal 6): the store, since when it is a customer (the
 * earlier of the account's creation and its first order before cut-over) and its rep, for every role (the side
 * nav's "Customer since Feb 2026", Your terms' "Your rep"); the legal name, phone and the tax ID's last 4 digits
 * only for Owners (team), else `business` is null. The full tax ID never leaves the server.
 */
export const businessProfile = z.object({
  storeName: z.string(),
  customerNumber: z.string(),
  customerSince: isoTime,
  /** The customer's active sales rep; null without one (the desk answers). */
  rep: z.object({ name: z.string() }).nullable(),
  business: z
    .object({
      legalName: z.string(),
      phone: z.string().nullable(),
      taxIdLast4: z.string().nullable(),
    })
    .nullable(),
});

export const getProfile = route({
  id: "portal.account.profile",
  method: "GET",
  path: "/v1/portal/account/profile",
  access: { portal: "any" },
  response: businessProfile,
});

// ── Change requests ─────────────────────────────────────────────────────

export const listChangeRequests = route({
  id: "portal.account.change_requests.list",
  method: "GET",
  path: "/v1/portal/account/change-requests",
  access: { portal: "team" },
  response: z.object({ rows: z.array(changeRequestOut) }),
});

/** Ask Marsa to change the legal name, the tax ID (the 9-digit EIN) or the payment terms (a Net term). */
export const requestChange = route({
  id: "portal.account.change_requests.create",
  method: "POST",
  path: "/v1/portal/account/change-requests",
  access: { portal: "team" },
  idempotency: "required",
  status: 201,
  body: z.object({ kind: z.enum(ASKABLE_CHANGES), value: z.string().trim().min(1).max(200) }).strict(),
  response: changeRequestOut,
});

// ── Addresses ───────────────────────────────────────────────────────────

export const listAddresses = route({
  id: "portal.addresses.list",
  method: "GET",
  path: "/v1/portal/addresses",
  access: { portal: "team" },
  response: z.object({ rows: z.array(portalAddress) }),
});

export const addAddress = route({
  id: "portal.addresses.create",
  method: "POST",
  path: "/v1/portal/addresses",
  access: { portal: "team" },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      ...addressFields,
      line1: z.string().trim().min(1).max(200),
      city: z.string().trim().min(1).max(100),
      state: z.string().trim().length(2),
      postalCode: z.string().trim().min(5).max(10),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  response: portalAddress,
});

export const updateAddress = route({
  id: "portal.addresses.update",
  method: "PATCH",
  path: "/v1/portal/addresses/:id",
  access: { portal: "team" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      ...addressFields,
      line1: z.string().trim().min(1).max(200).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      state: z.string().trim().length(2).optional(),
      postalCode: z.string().trim().min(5).max(10).optional(),
    })
    .strict(),
  response: z.object({ address: portalAddress, changeRequest: changeRequestOut.nullable() }),
});

export const defaultAddress = route({
  id: "portal.addresses.default",
  method: "POST",
  path: "/v1/portal/addresses/:id/default",
  access: { portal: "team" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: portalAddress,
});

export const deactivateAddress = route({
  id: "portal.addresses.deactivate",
  method: "POST",
  path: "/v1/portal/addresses/:id/deactivate",
  access: { portal: "team" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: z.object({ rows: z.array(portalAddress) }),
});

// ── Returns (shop) ──────────────────────────────────────────────────────

export const listReturns = route({
  id: "portal.returns.list",
  method: "GET",
  path: "/v1/portal/returns",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(portalReturnRow) }),
});

export const getReturn = route({
  id: "portal.returns.get",
  method: "GET",
  path: "/v1/portal/returns/:id",
  access: { portal: "shop" },
  params: idParams,
  response: portalReturn,
});

/** WReturn: per shipment of the order, what can still come back and until when. */
export const returnableLines = route({
  id: "portal.orders.returnable",
  method: "GET",
  path: "/v1/portal/orders/:id/returnable",
  access: { portal: "shop" },
  params: idParams,
  response: returnable,
});

export const requestReturn = route({
  id: "portal.returns.request",
  method: "POST",
  path: "/v1/portal/returns",
  access: { portal: "shop" },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      orderId: uuid,
      lines: z
        .array(
          z
            .object({
              deliveryLineId: uuid,
              quantity: z.number().int().min(1).max(1_000_000),
              reason: z.enum(RETURN_REASONS),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      outcome: z.enum(RETURN_OUTCOMES).optional(),
      note: z.string().trim().max(1000).nullable().optional(),
      photoFileIds: z.array(uuid).max(20).optional(),
    })
    .strict(),
  response: z.object({ returns: z.array(portalReturnRow) }),
});

/** A photo or PDF (its bytes as the body, with its own Content-Type) for a return request. */
export const uploadFile = route({
  id: "portal.files.upload",
  method: "POST",
  path: "/v1/portal/files",
  access: { portal: "shop" },
  idempotency: "optional",
  rawBody: true,
  status: 201,
  query: z.object({ purpose: z.enum(UPLOAD_PURPOSES), name: z.string().trim().min(1).max(200) }),
  response: storedFile,
});

export const ROUTES = {
  listChangeRequests,
  requestChange,
  listAddresses,
  addAddress,
  updateAddress,
  defaultAddress,
  deactivateAddress,
  listReturns,
  getReturn,
  returnableLines,
  requestReturn,
  uploadFile,
  getProfile,
} satisfies Record<string, RouteContract>;
