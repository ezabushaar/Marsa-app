import { z } from "zod";
import {
  type RouteContract,
  centsString,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  route,
  uuid,
} from "../http.js";

/**
 * Discounts & promotions (W4; study 02 §23; decisions D320–D339). Percent or amount off items, order discounts
 * over a minimum, and buy X get Y (from the same items or a set), automatic or by coupon code, with dates,
 * where they apply (staff orders, the portal, the counter; never website orders), customer types or named
 * customers, use limits, stacking and priority, and the contra-revenue account they post to.
 *
 * Reads are open to staff; managing needs prices.edit; letting one go under item floors needs
 * documents.price.approve_below_minimum. A discount that applied to a document can't be deleted, only switched
 * off; documents keep what it gave (frozen on their lines).
 */

export const PROMOTION_KINDS = [
  "percent_items",
  "amount_items",
  "order_percent",
  "order_amount",
  "buy_x_get_y",
] as const;
export const PROMOTION_CHANNELS = ["desk", "portal", "counter"] as const;
export const PROMOTION_STATUSES = ["active", "scheduled", "expired", "inactive"] as const;
export const PROMOTION_CUSTOMER_KINDS = ["wholesale", "retail", "walk_in"] as const;
/** The three first top-level category codes (catalog-w5: any category's code is accepted now). */
export const PROMOTION_CATEGORIES = ["fragrance", "body_care", "accessories"] as const;

/** A category code (catalog-w5): the category and everything under it. */
const scopeCategory = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Unknown category"));

export const promotionScope = z.object({
  items: z.array(uuid).max(500).default([]),
  brands: z.array(uuid).max(500).default([]),
  categories: z.array(scopeCategory).max(200).default([]),
});

/** The scope as stored (categories as text). */
const promotionScopeOut = z.object({
  items: z.array(uuid),
  brands: z.array(uuid),
  categories: z.array(z.string()),
});

export const promotionRow = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(PROMOTION_KINDS),
  /** Basis points (percent kinds and buy X get Y's discount on the Y units, 10000 = free) or cents. */
  value: centsString,
  minSubtotalCents: centsString.nullable(),
  buyQty: z.number().int().nullable(),
  getQty: z.number().int().nullable(),
  getFromSet: z.boolean(),
  scope: promotionScopeOut,
  getScope: promotionScopeOut.nullable(),
  channels: z.array(z.enum(PROMOTION_CHANNELS)),
  customerKinds: z.array(z.enum(PROMOTION_CUSTOMER_KINDS)),
  customerIds: z.array(uuid),
  /** catalog-w5: only customers in these groups (or whose parent account is in one); empty = all. */
  customerGroupIds: z.array(uuid).default([]),
  autoApply: z.boolean(),
  couponCode: z.string().nullable(),
  startsOn: day,
  endsOn: day.nullable(),
  maxUsesTotal: z.number().int().nullable(),
  maxUsesPerCustomer: z.number().int().nullable(),
  stackable: z.boolean(),
  priority: z.number().int(),
  active: z.boolean(),
  account: z.object({ id: uuid, code: z.string(), name: z.string() }).nullable(),
  belowFloorApproved: z.boolean(),
  status: z.enum(PROMOTION_STATUSES),
  /** "Buy 6 Hawas Fire, get 1 free". */
  summary: z.string(),
  labels: z.object({
    items: z.array(z.object({ id: uuid, name: z.string(), sku: z.string() })),
    brands: z.array(z.object({ id: uuid, name: z.string() })),
    customers: z.array(z.object({ id: uuid, name: z.string() })),
    /** catalog-w5: the names of the scope's categories and of the customer groups. */
    categories: z.array(z.object({ code: z.string(), name: z.string() })).default([]),
    customerGroups: z.array(z.object({ id: uuid, name: z.string() })).default([]),
  }),
  /** Sales orders (not cancelled) carrying it. */
  uses: z.number().int(),
  customers: z.number().int(),
  /** On posted invoices. */
  discountGivenCents: centsString,
  salesCents: centsString,
  version: z.number().int(),
  createdAt: isoTime,
});

const promotionBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    kind: z.enum(PROMOTION_KINDS),
    value: z.union([z.number().int().min(0), z.string().regex(/^\d+$/)]),
    minSubtotalCents: z
      .union([z.number().int().min(0), z.string().regex(/^\d+$/)])
      .nullable()
      .optional(),
    buyQty: z.number().int().min(1).max(10_000).nullable().optional(),
    getQty: z.number().int().min(1).max(10_000).nullable().optional(),
    getFromSet: z.boolean().optional(),
    scope: promotionScope.partial().optional(),
    getScope: promotionScope.partial().nullable().optional(),
    channels: z.array(z.enum(PROMOTION_CHANNELS)).min(1).max(3).optional(),
    customerKinds: z.array(z.enum(PROMOTION_CUSTOMER_KINDS)).max(3).optional(),
    customerIds: z.array(uuid).max(500).optional(),
    customerGroupIds: z.array(uuid).max(100).optional(),
    autoApply: z.boolean().optional(),
    couponCode: z.string().trim().max(40).nullable().optional(),
    startsOn: day,
    endsOn: day.nullable().optional(),
    maxUsesTotal: z.number().int().min(1).nullable().optional(),
    maxUsesPerCustomer: z.number().int().min(1).nullable().optional(),
    stackable: z.boolean().optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    active: z.boolean().optional(),
    accountId: uuid.nullable().optional(),
    allowBelowFloor: z.boolean().optional(),
  })
  .strict();

const idParams = z.object({ id: uuid });

export const listPromotions = route({
  id: "promotions.list",
  method: "GET",
  path: "/v1/promotions",
  access: { self: true },
  query: z.object({
    status: z.enum([...PROMOTION_STATUSES, "all"]).default("active"),
    search: z.string().trim().max(100).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: z.object({
    rows: z.array(promotionRow),
    total: z.number().int(),
    counts: z.object({
      active: z.number().int(),
      scheduled: z.number().int(),
      expired: z.number().int(),
      inactive: z.number().int(),
    }),
  }),
});

export const getPromotion = route({
  id: "promotions.get",
  method: "GET",
  path: "/v1/promotions/:id",
  access: { self: true },
  params: idParams,
  response: promotionRow,
});

export const createPromotion = route({
  id: "promotions.create",
  method: "POST",
  path: "/v1/promotions",
  access: { permission: "prices.edit" },
  idempotency: "required",
  // 201 on create, 200 for a replay of the same Idempotency-Key (the route sets it).
  body: promotionBody,
  response: promotionRow,
});

export const updatePromotion = route({
  id: "promotions.update",
  method: "PUT",
  path: "/v1/promotions/:id",
  access: { permission: "prices.edit" },
  params: idParams,
  body: promotionBody.extend({ version: z.number().int() }).strict(),
  response: promotionRow,
});

/** Switch off (no new or re-saved document takes it) or back on. */
export const setPromotionActive = route({
  id: "promotions.set_active",
  method: "POST",
  path: "/v1/promotions/:id/active",
  access: { permission: "prices.edit" },
  params: idParams,
  body: z.object({ version: z.number().int(), active: z.boolean() }).strict(),
  response: promotionRow,
});

/** Only a discount that never applied to a document (409 promotion_used otherwise). */
export const deletePromotion = route({
  id: "promotions.delete",
  method: "DELETE",
  path: "/v1/promotions/:id",
  access: { permission: "prices.edit" },
  params: idParams,
  body: z.object({}).strict().optional(),
  response: z.object({ deleted: z.literal(true) }),
});

export const promotionPreview = z.object({
  lines: z.array(
    z.object({
      index: z.number().int(),
      discountCents: centsString,
      promotions: z.array(
        z.object({
          promotionId: uuid,
          name: z.string(),
          reason: z.string(),
          amountCents: centsString,
          freeQty: z.number().int(),
          level: z.enum(["line", "order"]),
        }),
      ),
    }),
  ),
  totalCents: centsString,
  notes: z.array(
    z.object({
      promotionId: z.string(),
      name: z.string(),
      kind: z.enum(["removed", "capped", "hint", "not_eligible"]),
      message: z.string(),
    }),
  ),
  coupon: z
    .object({
      code: z.string(),
      status: z.enum(["applied", "not_found", "not_eligible", "no_effect"]),
      promotionId: uuid.nullable(),
      message: z.string(),
    })
    .nullable(),
});

/**
 * What the discounts would give on these lines for this customer, channel and date, written nowhere (the
 * order and quote editors before saving, the create page's live example). The price is the customer's.
 */
export const evaluatePromotions = route({
  id: "promotions.evaluate",
  method: "POST",
  path: "/v1/promotions/evaluate",
  access: { permission: "documents.sales.edit" },
  body: z
    .object({
      customerId: uuid,
      channel: z.enum(PROMOTION_CHANNELS).default("desk"),
      date: day.optional(),
      couponCode: z.string().trim().max(40).nullable().optional(),
      removed: z
        .array(z.object({ promotionId: uuid, reason: z.string().max(300) }).strict())
        .max(50)
        .optional(),
      /** The order being edited: its own use of a limited discount doesn't count against it. */
      orderId: uuid.nullable().optional(),
      lines: z
        .array(
          z
            .object({
              productId: uuid,
              quantity: z.number().int().min(1).max(1_000_000),
              unitPriceCents: z.number().int().min(0),
              discountBp: z.number().int().min(0).max(10_000).optional(),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
  response: promotionPreview,
});

/** The discount and coupon utilisation report (reports library): one row per discount in the period. */
export const promotionUtilisation = route({
  id: "promotions.utilisation",
  method: "GET",
  path: "/v1/promotions/utilisation",
  access: { self: true },
  query: z.object({ from: day.optional(), to: day.optional() }),
  response: z.object({
    from: day.nullable(),
    to: day.nullable(),
    rows: z.array(
      z.object({
        id: uuid,
        name: z.string(),
        couponCode: z.string().nullable(),
        kind: z.enum(PROMOTION_KINDS),
        status: z.enum(PROMOTION_STATUSES),
        uses: z.number().int(),
        customers: z.number().int(),
        discountCents: centsString,
        salesCents: centsString,
      }),
    ),
    totals: z.object({
      uses: z.number().int(),
      discountCents: centsString,
      salesCents: centsString,
    }),
  }),
});

export const ROUTES = {
  listPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  setPromotionActive,
  deletePromotion,
  evaluatePromotions,
  promotionUtilisation,
} satisfies Record<string, RouteContract>;
