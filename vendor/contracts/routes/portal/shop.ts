import { z } from "zod";
import {
  type RouteContract,
  boolQuery,
  centsString,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  route,
  uuid,
} from "../../http.js";
import { categoryCode } from "../products.js";
import { promotionPreview } from "../promotions.js";
import { SO_PAYMENT_STATUSES, SO_STATUSES } from "../sales.js";

/**
 * The portal's shop (docs/phases/phase-5-design.md §3.2, §6 slice 6 `p5-portal-ordering`): the catalog at the
 * customer's own prices with live stock, the quick-order sheet, the cart and sending it (a Submitted order:
 * nothing reserved, nothing charged), orders, quotes, saved lists and restock follows; and three public routes
 * (brands, the price-less catalog, the restock alert's stop link).
 *
 * Every signed-in route reads the session's customer only: a record of another customer and a random id answer
 * the same 404 `not_found`, body for body; an item the portal doesn't sell (discontinued, hidden) is the same
 * 404 as a random product id. No price list name, cost, margin floor or other customer's price is ever in an
 * answer. A Buyer (shop only) never sees payment states or invoices: those fields are null for them.
 *
 * Refusals the screens show in plain words: `cart_not_ready` (details.lines[] {productId, sku, code, message}
 * and details.minimum), `cart_empty`, `terms_paused` / `terms_not_offered` (Net terms while an invoice is
 * overdue, row 2), `order_not_ready` (a change under the minimums), `already_confirmed` (change or cancel after
 * Marsa confirmed: ask for changes), `staff_editing` (someone at Marsa is editing it), `stale_version`,
 * `below_quote`, `quote_expired`, `in_stock` (follow an item that is in stock), `list_exists`,
 * `items_unavailable` (details.productIds), `too_many_lines`, `nothing_to_reorder`.
 */

export const STOCK_STATES = ["in_stock", "low", "out_of_stock"] as const;
/**
 * UX S2 (SHOP-4, D853): "relevance" ranks a search (exact SKU or barcode, then the name starting with it, then
 * the name holding it, then every word in the name, then every word anywhere, then best sellers); it is the
 * default while `q` is set, best sellers otherwise.
 */
export const CATALOG_SORTS = [
  "relevance",
  "best_sellers",
  "newest",
  "price_asc",
  "price_desc",
  "name",
] as const;
export const PREFERRED_PAYMENTS = ["ach", "card", "terms"] as const;
export const SHIP_METHODS = [
  "freight_quote_later",
  "ups_ground",
  "ltl_freight",
  "local_pickup",
  "other",
] as const;
/**
 * The shipping methods a customer may pick at checkout (launch, cut-over blocker Portal 9); pick up is the
 * `pickup` choice, and staff can still change the method at confirm (`PATCH sales-orders/:id/portal`).
 */
export const PORTAL_SHIP_METHODS = ["freight_quote_later", "ups_ground", "ltl_freight"] as const;
export const PORTAL_ORDER_STAGES = [
  "waiting_for_marsa",
  "ready_to_pay",
  "on_credit_hold",
  "confirmed",
  "shipped",
  "closed",
  "cancelled",
] as const;
/** "delivered": every shipment of the order delivered (portal gaps; Shipped still lists them too). */
export const PORTAL_ORDER_TABS = ["all", "open", "to_pay", "shipped", "delivered"] as const;
export const PORTAL_QUOTE_STATUSES = ["waiting_for_you", "accepted", "declined", "expired"] as const;
export const CART_PROBLEMS = [
  "unavailable",
  "out_of_stock",
  "below_minimum",
  // line-item L3 (D700–D719): more than the item's most per order.
  "above_maximum",
  // Decision 85: a line added from Clearance whose item left it, or over the per-store limit.
  "clearance_ended",
  "clearance_limit",
  // UX S2 (SHOP-7, D857): not a whole number of the item's packs.
  "not_multiple",
] as const;
export const LOOKUP_PROBLEMS = [
  "not_found",
  "not_sold",
  "no_quantity",
  "below_minimum",
  "above_maximum",
  "out_of_stock",
  // UX S2 (SHOP-7, D857).
  "not_multiple",
] as const;
export const CART_STATUSES = ["live", "abandoned", "recovered", "submitted", "cleared"] as const;
/**
 * UX S3 (CART-3, D910): the one-tap fix a problem line offers: take it off the cart, or set the quantity the cart
 * can send (raise to the minimum, round to whole packs, lower to the most or to what clearance has left).
 */
export const CART_FIXES = ["remove", "set_quantity"] as const;
/** UX S3 (CART-2, D912): what the cart knows of the freight before checkout. */
export const FREIGHT_ESTIMATES = ["charged", "free", "quoted"] as const;
/** UX S3 (CART-15, D914): what the cart knows of the sales tax before checkout. */
export const TAX_ESTIMATES = ["exempt", "estimated", "at_confirm"] as const;
/** UX S3 (CART-10, D917): where the order sheet took a quantity nobody typed. */
export const QUANTITY_DEFAULTS = ["last_ordered", "case_pack", "minimum"] as const;

const quantity = z.number().int().min(1).max(1_000_000);
const version = z.number().int().min(1);
const productParams = z.object({ productId: uuid });
const idParams = z.object({ id: uuid });

// ── Quantity rules and the margin (UX S2, SHOP-6/7/8) ───────────────────

/** What a portal stepper needs of an item to know its quantity rules. */
export interface QtyRuleItem {
  minQty: number;
  maxQty?: number | null;
  sellMultiple?: number | null;
  casePack?: number | null;
  available?: number;
  lastOrderedQty?: number | null;
}

export interface QtyRules {
  /** The fewest units: the item's minimum, rounded up to a whole pack. */
  min: number;
  /** The most units (a whole number of packs when that still reaches the minimum); null: no limit. */
  max: number | null;
  /** The pack: steps go up and down by it (1 without a pack rule). */
  step: number;
  /** Where a stepper starts: the last ordered quantity, else the case pack, else the minimum (D856). */
  start: number;
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/**
 * D856/D857: one quantity rule for every portal stepper (cards, product page, cart, lists). The server checks the
 * same rules on the cart's lines (below_minimum, above_maximum, not_multiple), so a quantity the stepper offers is
 * one the cart can send.
 */
export function qtyRules(item: QtyRuleItem): QtyRules {
  const step = item.sellMultiple && item.sellMultiple > 1 ? item.sellMultiple : 1;
  const min = roundUp(Math.max(1, item.minQty), step);
  let max: number | null = null;
  if (item.maxQty != null) {
    const whole = Math.floor(item.maxQty / step) * step;
    max = whole >= min ? whole : item.maxQty;
  }
  const base: QtyRules = { min, max, step, start: min };
  const wanted =
    item.lastOrderedQty != null && item.lastOrderedQty > 0
      ? item.lastOrderedQty
      : Math.max(min, item.casePack ?? 0);
  let start = snapQty(wanted, base);
  // Never start above what is in stock (when the minimum fits in it).
  if (item.available !== undefined && item.available >= min && start > item.available) {
    start = Math.max(min, Math.floor(item.available / step) * step);
  }
  return { ...base, start };
}

/** The allowed quantity at or above `n`: at least the minimum, a whole number of packs, at most the most. */
export function snapQty(n: number, rules: Pick<QtyRules, "min" | "max" | "step">): number {
  const whole = Number.isFinite(n)
    ? Math.max(rules.min, roundUp(Math.max(1, Math.floor(n)), rules.step))
    : rules.min;
  return rules.max !== null && whole > rules.max ? Math.max(rules.min, rules.max) : whole;
}

/** One pack more (from a quantity off the grid: the next whole pack). */
export function stepUp(n: number, rules: Pick<QtyRules, "min" | "max" | "step">): number {
  return snapQty(Math.floor(n / rules.step) * rules.step + rules.step, rules);
}

/** One pack less, never under the minimum (from over the most: the most). */
export function stepDown(n: number, rules: Pick<QtyRules, "min" | "max" | "step">): number {
  if (rules.max !== null && n > rules.max) return Math.max(rules.min, rules.max);
  const down = Math.ceil(n / rules.step) * rules.step - rules.step;
  return Math.max(rules.min, down);
}

/**
 * "You keep 35% at MSRP": (MSRP − your price) ÷ MSRP in basis points; null without an MSRP above the price. The
 * product page's figure, used by every card too (D855).
 */
export function marginAtMsrpBp(msrpCents: number | null | undefined, priceCents: number): number | null {
  if (!msrpCents || msrpCents <= priceCents) return null;
  return Math.round(((msrpCents - priceCents) * 10_000) / msrpCents);
}

// ── Shapes ──────────────────────────────────────────────────────────────

export const brandCount = z.object({
  id: uuid,
  name: z.string(),
  itemCount: z.number().int(),
  /** launch-images: the brand's logo (a public image path), or null. */
  logoUrl: z.string().nullable().optional(),
});

/** An item as the signed-in portal shows it: the customer's own price, MSRP, the minimum and live stock. */
export const catalogItem = z.object({
  id: uuid,
  sku: z.string(),
  upc: z.string().nullable(),
  name: z.string(),
  brand: z.object({ id: uuid, name: z.string() }),
  imageUrl: z.string().nullable(),
  /** The customer's price at one unit: a contract step from one unit (A3, D1710), else their list price. */
  priceCents: z.number().int(),
  /** The customer's list price (Standard or their tier) without any contract; `priceCents` when left out. */
  listPriceCents: z.number().int().optional(),
  /**
   * A3 (D1710): the customer's lowest-minimum live contract price for the item ("Your price $18.40 from 12 units ·
   * to Jan 31, 2027"); null (or left out) without one. The server prices every line by its quantity.
   */
  contract: z
    .object({ unitPriceCents: z.number().int(), minQty: z.number().int(), endsOn: day.nullable() })
    .nullable()
    .optional(),
  msrpCents: z.number().int().nullable(),
  /** The fewest units of the item an order takes: the portal's minimum per item, or the item's own when higher. */
  minQty: z.number().int(),
  /** line-item L3: the most units of the item an order takes (null: no limit) and its pack size (null: any). */
  maxQty: z.number().int().nullable().optional(),
  sellMultiple: z.number().int().nullable().optional(),
  casePack: z.number().int().nullable(),
  /** Sellable − reserved in the portal's warehouse, never below 0. */
  available: z.number().int(),
  stock: z.enum(STOCK_STATES),
  /** "83 available", "Only 10 left" (at portal.policy.lowStockBadgeUnits or fewer), "Out of stock". */
  stockLabel: z.string(),
  following: z.boolean(),
  inCart: z.number().int(),
  /**
   * UX S2 (SHOP-8, D856): the units of it on the customer's newest order that counts (submitted, confirmed or
   * closed); the cards' stepper starts there. Null: never ordered.
   */
  lastOrderedQty: z.number().int().nullable().optional(),
});

const minimum = z.object({ orderCents: centsString, unitsPerItem: z.number().int() });

export const catalogPage = z.object({
  rows: z.array(catalogItem),
  total: z.number().int(),
  sizes: z.array(z.string()),
  /** An exact SKU, UPC or case barcode in `q`: that item (jump straight to it). */
  match: uuid.nullable(),
  /**
   * catalog-w5: the categories the portal shows (active, portal-visible, under visible parents) in tree order,
   * with the active items in each branch; the Category filter is built from these.
   */
  categories: z
    .array(
      z.object({
        code: z.string(),
        name: z.string(),
        parentCode: z.string().nullable(),
        depth: z.number().int(),
        items: z.number().int(),
      }),
    )
    .default([]),
  minimum,
  /**
   * UX S2 (SHOP-2, D852): no item has every word, so these are the closest by spelling ("khamra" → Khamrah),
   * best first. False for an ordinary answer.
   */
  fuzzy: z.boolean().default(false),
  /** UX S2 (SHOP-3, D854): the search spelled as the catalog spells it, when that differs ("lataffa" → "lattafa"). */
  didYouMean: z.string().nullable().default(null),
});

const lastOrdered = z.object({ quantity: z.number().int(), date: day, orderNumber: z.string() });

export const productPage = catalogItem.extend({
  /** "You keep 35% at MSRP", in basis points; null without an MSRP above the price. */
  marginAtMsrpBp: z.number().int().nullable(),
  lastOrdered: lastOrdered.nullable(),
  moreFromBrand: z.array(catalogItem),
  // Portal gaps (WProduct "About this fragrance"): from the item record (migration 0043) and real sales.
  /** catalog-w5: the item's category code, name and top-level category code (`fragrance`). */
  category: z.string(),
  categoryName: z.string().default(""),
  categoryTop: z.string().default("fragrance"),
  /** "Top: bergamot · Heart: rose · Base: musk"; null when not filled in. */
  notes: z.string().nullable(),
  /** "200 ml · Eau de Parfum", else the size in the name ("200 ml"), else null. */
  size: z.string().nullable(),
  /**
   * Items most often on the same orders over the last 180 days (every customer's orders, counted, never shown:
   * no customer, quantity or count leaves the server), still sold, up to 3.
   */
  sellsWellWith: z.array(catalogItem),
  /** The box and case photos, for "Download product photos for your store". */
  photos: z.array(
    z.object({
      /** launch-images: `gallery` is any picture of the item's gallery after its first (`box`). */
      kind: z.enum(["box", "case", "gallery"]),
      url: z.string(),
      thumbUrl: z.string().optional(),
    }),
  ),
});

export const publicItem = z.object({
  id: uuid,
  sku: z.string(),
  upc: z.string().nullable(),
  name: z.string(),
  brand: z.object({ id: uuid, name: z.string() }),
  imageUrl: z.string().nullable(),
  stock: z.enum(["in_stock", "restocking"]),
});

export const lookupLine = z.object({
  row: z.number().int(),
  code: z.string(),
  quantity: z.number().nullable(),
  item: catalogItem.nullable(),
  totalCents: centsString.nullable(),
  problem: z.object({ code: z.enum(LOOKUP_PROBLEMS), message: z.string() }).nullable(),
  /**
   * UX S3 (CART-10, D917): the line came with no quantity, so the sheet set one (the last ordered quantity, else
   * the case pack, else the minimum); `quantity` holds it. Null: the quantity is the one sent.
   */
  quantitySet: z.enum(QUANTITY_DEFAULTS).nullable().optional(),
  /** UX S3 (CART-12, D918): no item has this code, but the words name one ("Use this"). */
  suggestion: catalogItem.nullable().optional(),
});

export const lookupResult = z.object({
  lines: z.array(lookupLine),
  ready: z.object({ lines: z.number().int(), totalCents: centsString }),
  needAttention: z.number().int(),
});

export const termsView = z.object({
  code: z.string(),
  label: z.string(),
  offered: z.boolean(),
  reason: z.enum(["not_on_terms", "overdue"]).nullable(),
  message: z.string().nullable(),
  /** Owners and Accounts only (null for a Buyer). */
  overdueCents: centsString.nullable(),
  overdueInvoice: z.object({ id: uuid, number: z.string() }).nullable(),
});

/** UX S3 (CART-3, D910): a problem line's one-tap fix ("Remove", "Make it 6", "Round to 12", "Lower to 36"). */
export const cartFix = z.object({
  action: z.enum(CART_FIXES),
  /** The quantity `set_quantity` sets; null for `remove`. */
  quantity: z.number().int().nullable(),
  label: z.string(),
});

export const cartLine = z.object({
  productId: uuid,
  item: catalogItem,
  quantity: z.number().int(),
  totalCents: centsString,
  problem: z
    .object({ code: z.enum(CART_PROBLEMS), message: z.string(), fix: cartFix.nullable().optional() })
    .nullable(),
  /**
   * UX S3 (CART-6, D916): more asked than is available (but some is): "Only 10 available: we'll confirm or
   * backorder the rest". A note, never a problem: the line can be sent.
   */
  stockNote: z.string().nullable().optional(),
  /** Added from Clearance (decision 85): the clearance price, the per-store limit and what is left of it. */
  clearance: z
    .object({
      priceCents: z.number().int(),
      limitPerStore: z.number().int().nullable(),
      left: z.number().int().nullable(),
    })
    .nullable(),
});

export const cartSummary = z.object({
  lines: z.number().int(),
  validLines: z.number().int(),
  units: z.number().int(),
  itemsCents: centsString,
  minimum: minimum.extend({ reached: z.boolean(), shortCents: centsString }),
  problems: z.number().int(),
  canSubmit: z.boolean(),
  blockers: z.array(z.string()),
});

export const checkoutAddress = z.object({
  id: uuid,
  kind: z.enum(["billing", "ship_to"]),
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  isDefault: z.boolean(),
});

/**
 * UX S3 (CART-2, CART-8, CART-15; D912–D915): what the order will cost as far as the cart can tell: the sendable
 * items after discounts, the cheapest delivered shipping method Marsa shows on the portal (its charge on these
 * items, or "quoted" when Marsa quotes it) with the nearest free-freight threshold, and the sales tax when it is
 * known (exempt, or the default ship-to's own rate under the built-in tax provider). Nothing is charged by it; the
 * order's figures are set when Marsa confirms.
 */
export const cartEstimate = z.object({
  itemsCents: centsString,
  discountCents: centsString,
  freight: z.object({
    status: z.enum(FREIGHT_ESTIMATES),
    /** The cheapest delivered method (null: none set up, Marsa quotes the freight). */
    method: z.object({ id: uuid, name: z.string() }).nullable(),
    /** Null while quoted. */
    cents: centsString.nullable(),
    /** The lowest free-freight threshold of a charged method: how far the items are from it. */
    freeOver: z
      .object({
        methodId: uuid,
        methodName: z.string(),
        thresholdCents: centsString,
        shortCents: centsString,
        reached: z.boolean(),
      })
      .nullable(),
    /** A pickup method is shown on the portal (no freight). */
    pickup: z.boolean(),
  }),
  tax: z.object({
    status: z.enum(TAX_ESTIMATES),
    /** Parts per million (88000 = 8.8%) when estimated. */
    ratePpm: z.number().int().nullable(),
    /** Null while worked out at confirm. */
    cents: centsString.nullable(),
    /** "Tax exempt (certificate on file)", "8.8% · Kennewick WA", "Added when we confirm". */
    label: z.string(),
  }),
  /** Items − discounts + the freight and tax that are known. */
  totalCents: centsString,
  /** Freight or tax is still to be added (the total is "before freight and tax" or "before tax"). */
  partial: z.boolean(),
});

export const cartView = z.object({
  id: uuid.nullable(),
  status: z.enum(CART_STATUSES).nullable(),
  version: z.number().int().nullable(),
  lastActivityAt: isoTime.nullable(),
  lines: z.array(cartLine),
  summary: cartSummary,
  terms: termsView,
  /** How the customer chose to pay on their last portal order; checkout preselects it (UX audit 2026-11 CART-1). */
  lastPayment: z.enum(PREFERRED_PAYMENTS).nullable().default(null),
  /** W4: the portal's discounts on the lines that can be sent (by line index); the minimum is before them. */
  promotions: promotionPreview.default({ lines: [], totalCents: "0", notes: [], coupon: null }),
  /** UX S3 (D912–D915): freight, tax and the estimated total. */
  estimate: cartEstimate.nullable().default(null),
});

/** The cart with what WCheckout needs: the customer's addresses (Buyers read them here). */
export const cartWithCheckout = cartView.extend({ addresses: z.array(checkoutAddress) });

export const submittedOrder = z.object({
  order: z.object({
    id: uuid,
    number: z.string(),
    status: z.enum(SO_STATUSES),
    itemsCents: centsString,
    units: z.number().int(),
    lines: z.number().int(),
  }),
});

const invoiceRef = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  dueDate: day,
  totalCents: centsString,
  balanceCents: centsString,
  overdue: z.boolean(),
});

export const portalOrderRow = z.object({
  id: uuid,
  number: z.string(),
  externalRef: z.string().nullable(),
  placedOn: day,
  placedAt: isoTime,
  stage: z.enum(PORTAL_ORDER_STAGES),
  stageLabel: z.string(),
  shipping: z.object({ label: z.string(), shippedOn: day.nullable(), deliveredOn: day.nullable() }),
  payment: z.object({ status: z.enum(SO_PAYMENT_STATUSES), label: z.string() }).nullable(),
  invoice: invoiceRef.nullable(),
  lines: z.number().int(),
  units: z.number().int(),
  totalCents: centsString,
  canChange: z.boolean(),
  /**
   * On credit hold (UX audit 2026-11 ORD-1): why, what to pay so it ships and the invoices that pays (oldest
   * first); amount null and no invoices for a Buyer; payable false when only the rep can help.
   */
  hold: z
    .object({
      reason: z.enum(["overdue", "over_limit"]),
      amountCents: centsString.nullable(),
      invoiceIds: z.array(uuid),
      payable: z.boolean(),
    })
    .nullable(),
});

export const portalOrderLine = z.object({
  id: uuid,
  productId: uuid,
  name: z.string(),
  sku: z.string(),
  upc: z.string().nullable(),
  brand: z.string().nullable(),
  imageUrl: z.string().nullable(),
  askedQty: z.number().int(),
  /** Null while Submitted. */
  confirmedQty: z.number().int().nullable(),
  shippedQty: z.number().int(),
  unitPriceCents: z.number().int(),
  totalCents: centsString,
});

export const portalOrderView = portalOrderRow.extend({
  version: z.number().int(),
  placedBy: z.object({ name: z.string() }).nullable(),
  customerPo: z.string().nullable(),
  requestedDate: day.nullable(),
  preferredPayment: z.enum(PREFERRED_PAYMENTS).nullable(),
  useStoreCredit: z.boolean(),
  shipMethod: z.enum(SHIP_METHODS).nullable(),
  pickup: z.boolean(),
  boxes: z.number().int().nullable(),
  shipTo: z
    .object({
      label: z.string().nullable(),
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
    })
    .nullable(),
  lineItems: z.array(portalOrderLine),
  /** "UPS Ground": the shipment's carrier service, else the ship method's name; null for a pick-up. */
  shipService: z.string().nullable(),
  /** The rate tax was charged at, "8.8" (percent); null until confirmed or without a rate of ours. */
  taxRatePercent: z.string().nullable(),
  totals: z.object({
    itemsCents: centsString,
    freightCents: centsString.nullable(),
    taxCents: centsString.nullable(),
    totalCents: centsString.nullable(),
  }),
  confirmed: z.object({ by: z.string().nullable(), at: isoTime }).nullable(),
  deliveries: z.array(
    z.object({
      /** For the packing slip (`portal.deliveries.packing_slip`). */
      id: uuid,
      number: z.string(),
      status: z.string(),
      shipDate: day.nullable(),
      deliveredAt: isoTime.nullable(),
      carrierService: z.string().nullable(),
      trackingNumber: z.string().nullable(),
    }),
  ),
  canCancel: z.boolean(),
});

export const portalQuoteRow = z.object({
  id: uuid,
  number: z.string(),
  sentOn: day.nullable(),
  validUntil: day,
  status: z.enum(PORTAL_QUOTE_STATUSES),
  statusLabel: z.string(),
  totalCents: centsString,
  order: z.object({ id: uuid, number: z.string() }).nullable(),
  from: z.string().nullable(),
  version: z.number().int(),
});

export const portalQuoteView = portalQuoteRow.extend({
  note: z.string().nullable(),
  lines: z.array(
    z.object({
      id: uuid,
      productId: uuid,
      name: z.string(),
      sku: z.string(),
      upc: z.string().nullable(),
      brand: z.string().nullable(),
      quantity: z.number().int(),
      usualPriceCents: z.number().int().nullable(),
      quotedPriceCents: z.number().int(),
      totalCents: centsString,
    }),
  ),
  canAccept: z.boolean(),
});

export const listSummary = z.object({
  id: uuid,
  name: z.string(),
  itemCount: z.number().int(),
  version: z.number().int(),
  updatedAt: isoTime,
});

export const listView = listSummary.extend({
  items: z.array(catalogItem.extend({ quantity: z.number().int(), sold: z.boolean() })),
});

export const followView = catalogItem.extend({ followedAt: isoTime, lastAlertOn: day.nullable() });

const changesAsked = z.object({ sent: z.literal(true), to: z.enum(["rep", "desk"]) });

// ── Checkout fields ─────────────────────────────────────────────────────

const checkoutFields = {
  /** One of the customer's addresses; left out, the default ship-to. Ignored with `pickup`. */
  shipToAddressId: uuid.nullable().optional(),
  /** Pick up at the warehouse: no freight; we message you when it's ready. */
  pickup: z.boolean().optional(),
  /** How to ship it (not with `pickup`); left out when sending, freight quoted by Marsa. */
  shipMethod: z.enum(PORTAL_SHIP_METHODS).optional(),
  /**
   * admin-w6 (D655): one of `GET /v1/portal/shipping-methods` (wins over `shipMethod`; a pickup method is a
   * pickup). Marsa confirms the freight; the method's charge and free-over threshold set it.
   */
  shippingMethodId: uuid.optional(),
  customerPo: z.string().trim().max(100).nullable().optional(),
  /** Need it by, today or later. */
  requestedDate: day.nullable().optional(),
  /** Notes for Marsa. */
  notes: z.string().max(2000).nullable().optional(),
  /** Owners and Accounts only (store credit is money). */
  useStoreCredit: z.boolean().optional(),
  /** W4: a coupon code; refused with the reason when it can't be used. */
  couponCode: z.string().trim().max(40).nullable().optional(),
};

/** The session customer's rep (WHome "Your rep is …", WProduct "Ask Ez for a quote"); no rep: the desk. */
export const repView = z.object({
  rep: z.object({ name: z.string(), firstName: z.string() }).nullable(),
  /** The rep's email, else the desk's; null when neither is set. */
  email: z.string().nullable(),
  /** wa.me link to Marsa's WhatsApp number (messages.sender); null until it is set. */
  whatsappUrl: z.string().nullable(),
});

// ── Public ──────────────────────────────────────────────────────────────

export const publicBrands = route({
  id: "portal.public.brands",
  method: "GET",
  path: "/v1/portal/public/brands",
  access: { public: true },
  response: z.object({ rows: z.array(brandCount) }),
});

/**
 * Signed out: the items on the portal with no prices, "In stock" or "Restocking". UX S6 (D1410): while the public
 * catalog is off, only the landing's first page answers (no search, brand or paging).
 */
export const publicCatalog = route({
  id: "portal.public.catalog",
  method: "GET",
  path: "/v1/portal/public/catalog",
  access: { public: true },
  query: z.object({
    brandId: uuid.optional(),
    q: z.string().trim().max(100).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: z.object({ rows: z.array(publicItem), total: z.number().int() }),
});

/**
 * Signed out (WLanding "Selling through now · Top sellers, last 30 days"): the items with the most units on
 * confirmed and closed orders over the last 30 days, still sold, best first. No prices and no counts, like
 * every public page; empty while nothing sold.
 */
export const publicTopSellers = route({
  id: "portal.public.top_sellers",
  method: "GET",
  path: "/v1/portal/public/top-sellers",
  access: { public: true },
  query: z.object({ limit: z.coerce.number().int().min(1).max(12).default(4) }),
  response: z.object({ rows: z.array(publicItem), days: z.number().int() }),
});

/**
 * Signed out: the wholesale order minimum the public pages state (WLanding, WApply, WAppStatus), read from
 * `sales.minimum_order` so they never drift from the cart's (phase 6 slice 18, cut-over blocker Portal 4).
 */
export const publicMinimum = route({
  id: "portal.public.minimum",
  method: "GET",
  path: "/v1/portal/public/minimum",
  access: { public: true },
  response: minimum,
});

/**
 * Signed out: the name and logo every portal header shows (Settings › Business; the wordmark while no logo is
 * set). `logoUrl` is the public logo path with a version, so a new logo is never served from a cache.
 */
export const publicBranding = route({
  id: "portal.public.branding",
  method: "GET",
  path: "/v1/portal/public/branding",
  access: { public: true },
  response: z.object({ name: z.string(), logoUrl: z.string().nullable() }),
});

/** Signed out: the company logo's bytes (PNG or JPEG); 404 while none is set. Emails link to it too. */
export const publicLogo = route({
  id: "portal.public.logo",
  method: "GET",
  path: "/v1/portal/public/logo",
  access: { public: true },
  query: z.object({ v: z.string().max(64).optional() }),
  response: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected file bytes"),
});

/**
 * UX S6 (W5, D1410–D1411): what the public pages show from Settings › Wholesale portal › Landing. `catalogOpen`
 * is the switch (off by default); every fact is null until someone enters it, and a null fact is not shown.
 */
export const publicLanding = route({
  id: "portal.public.landing",
  method: "GET",
  path: "/v1/portal/public/landing",
  access: { public: true },
  response: z.object({
    catalogOpen: z.boolean(),
    deliveryDays: z.string().nullable(),
    freeShippingCents: centsString.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    hours: z.string().nullable(),
    licenses: z.string().nullable(),
    quotes: z.array(z.object({ text: z.string(), name: z.string(), store: z.string().nullable() })),
  }),
});

/**
 * UX S6 (PUB-1): one item for a visitor who isn't signed in, with no price ("Price after approval"); 404 while
 * the public catalog is off, or for an item not sold on the portal.
 */
export const publicProduct = route({
  id: "portal.public.product",
  method: "GET",
  path: "/v1/portal/public/catalog/:productId",
  access: { public: true },
  params: z.object({ productId: uuid }),
  response: publicItem.extend({
    sizeLabel: z.string().nullable(),
    scentNotes: z.string().nullable(),
    casePack: z.number().int().nullable(),
  }),
});

/** The restock alert's "Stop these alerts" (WhatsApp button → the portal's stop page posts its token). */
export const stopAlerts = route({
  id: "portal.alerts.stop",
  method: "POST",
  path: "/v1/portal/alerts/stop/:token",
  access: { public: true },
  idempotency: "optional",
  params: z.object({ token: z.string().min(1).max(200) }),
  body: z.object({}).strict().optional(),
  response: z.object({ stopped: z.literal(true), productName: z.string() }),
});

// ── Catalog ─────────────────────────────────────────────────────────────

export const brands = route({
  id: "portal.brands",
  method: "GET",
  path: "/v1/portal/brands",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(brandCount) }),
});

export const catalog = route({
  id: "portal.catalog.list",
  method: "GET",
  path: "/v1/portal/catalog",
  access: { portal: "shop" },
  query: z.object({
    brandId: uuid.optional(),
    /** "200ml". */
    size: z.string().trim().max(20).optional(),
    inStock: boolQuery,
    /** Name, SKU, UPC, case barcode or brand. */
    q: z.string().trim().max(100).optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
    /** Portal gaps (WCatalog "Category"). */
    /** catalog-w5: a category's code; its whole branch (unknown: 400 unknown_category). */
    category: categoryCode.optional(),
    /** WCatalog "Your price" $ min / $ max, in cents, on the customer's own price. */
    priceMinCents: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
    priceMaxCents: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: catalogPage,
});

export const catalogItemRoute = route({
  id: "portal.catalog.get",
  method: "GET",
  path: "/v1/portal/catalog/:productId",
  access: { portal: "shop" },
  params: productParams,
  response: productPage,
});

/**
 * WProduct "Ordering this in volume? Ask Ez for a quote": the customer's words, with the item and the quantity,
 * to their rep (email and a notification), or to the desk without one.
 */
export const askQuote = route({
  id: "portal.catalog.ask_quote",
  method: "POST",
  path: "/v1/portal/catalog/:productId/ask-quote",
  access: { portal: "shop" },
  idempotency: "optional",
  params: productParams,
  body: z
    .object({
      quantity: quantity.nullable().optional(),
      message: z.string().trim().max(2000).nullable().optional(),
    })
    .strict(),
  response: changesAsked,
});

/** The order sheet: typed, scanned, pasted or CSV lines (SKU, UPC or case barcode, then a quantity). */
export const lookup = route({
  id: "portal.catalog.lookup",
  method: "POST",
  path: "/v1/portal/catalog/lookup",
  access: { portal: "shop" },
  idempotency: "optional",
  body: z
    .object({
      lines: z
        .array(
          z.object({ code: z.string().trim().max(64), quantity: z.number().nullable().optional() }).strict(),
        )
        .max(1000)
        .optional(),
      /** Pasted text or a CSV file's contents: one line each, "SKU or UPC, quantity". */
      text: z.string().max(200_000).nullable().optional(),
    })
    .strict(),
  response: lookupResult,
});

export const newArrivals = route({
  id: "portal.catalog.new_arrivals",
  method: "GET",
  path: "/v1/portal/new-arrivals",
  access: { portal: "shop" },
  query: z.object({ limit: limitQuery, offset: offsetQuery }),
  response: z.object({ rows: z.array(catalogItem.extend({ arrivedOn: day })), total: z.number().int() }),
});

export const buyAgain = route({
  id: "portal.catalog.buy_again",
  method: "GET",
  path: "/v1/portal/buy-again",
  access: { portal: "shop" },
  query: z.object({ limit: limitQuery, offset: offsetQuery }),
  response: z.object({ rows: z.array(catalogItem.extend({ lastOrdered })), total: z.number().int() }),
});

export const usualOrder = route({
  id: "portal.catalog.usual_order",
  method: "GET",
  path: "/v1/portal/usual-order",
  access: { portal: "shop" },
  response: z.object({
    rows: z.array(catalogItem.extend({ usualQty: z.number().int(), timesOrdered: z.number().int() })),
  }),
});

// ── Cart ────────────────────────────────────────────────────────────────

export const getCart = route({
  id: "portal.cart.get",
  method: "GET",
  path: "/v1/portal/cart",
  access: { portal: "shop" },
  response: cartWithCheckout,
});

export const setCartLine = route({
  id: "portal.cart.lines.set",
  method: "PUT",
  path: "/v1/portal/cart/lines/:productId",
  access: { portal: "shop" },
  idempotency: "optional",
  params: productParams,
  /** `clearance: true` from WClearance (its clearance price); false back to the customer's price. */
  body: z.object({ quantity, clearance: z.boolean().optional() }).strict(),
  response: cartView,
});

export const removeCartLine = route({
  id: "portal.cart.lines.remove",
  method: "DELETE",
  path: "/v1/portal/cart/lines/:productId",
  access: { portal: "shop" },
  idempotency: "optional",
  params: productParams,
  body: z.object({}).strict().optional(),
  response: cartView,
});

/** Several items at once (the sheet, a list, buy again, the usual order), added to what the cart holds. */
export const addCartLines = route({
  id: "portal.cart.lines.add",
  method: "POST",
  path: "/v1/portal/cart/lines",
  access: { portal: "shop" },
  idempotency: "required",
  body: z
    .object({
      lines: z
        .array(z.object({ productId: uuid, quantity }).strict())
        .min(1)
        .max(500),
    })
    .strict(),
  response: cartView,
});

/**
 * UX S3 (CART-3, D910): applies the problem lines' one-tap fixes (each worked out again here, never taken from the
 * browser): every problem line, or only the lines of these items or with these problems. Answers the cart and how
 * many lines were removed and changed; a cart with nothing to fix answers it unchanged.
 */
export const fixCart = route({
  id: "portal.cart.fix",
  method: "POST",
  path: "/v1/portal/cart/fix",
  access: { portal: "shop" },
  idempotency: "optional",
  body: z
    .object({
      productIds: z.array(uuid).max(500).optional(),
      problems: z.array(z.enum(CART_PROBLEMS)).max(CART_PROBLEMS.length).optional(),
    })
    .strict(),
  response: cartView.extend({
    fixed: z.object({ removed: z.number().int(), changed: z.number().int() }),
  }),
});

/** WCheckout "Apply": the cart with a coupon tried on it (nothing saved; the code goes with the order). */
export const previewCartCoupon = route({
  id: "portal.cart.coupon",
  method: "POST",
  path: "/v1/portal/cart/coupon",
  access: { portal: "shop" },
  idempotency: "optional",
  body: z.object({ couponCode: z.string().trim().max(40).nullable() }).strict(),
  response: cartView,
});

/** Send the order to Marsa: one Submitted order, nothing reserved, nothing charged. */
export const submitCart = route({
  id: "portal.cart.submit",
  method: "POST",
  path: "/v1/portal/cart/submit",
  access: { portal: "shop" },
  idempotency: "required",
  status: 201,
  body: z.object({ ...checkoutFields, preferredPayment: z.enum(PREFERRED_PAYMENTS) }).strict(),
  response: submittedOrder,
});

// ── Orders ──────────────────────────────────────────────────────────────

/** Every portal role reads its orders; payment states and invoices only with pay (Owners, Accounts). */
export const listOrders = route({
  id: "portal.orders.list",
  method: "GET",
  path: "/v1/portal/orders",
  access: { portal: "any" },
  query: z.object({ tab: z.enum(PORTAL_ORDER_TABS).optional(), limit: limitQuery, offset: offsetQuery }),
  response: z.object({
    rows: z.array(portalOrderRow),
    total: z.number().int(),
    counts: z.object({
      all: z.number().int(),
      open: z.number().int(),
      to_pay: z.number().int(),
      shipped: z.number().int(),
      delivered: z.number().int(),
    }),
  }),
});

export const getOrder = route({
  id: "portal.orders.get",
  method: "GET",
  path: "/v1/portal/orders/:id",
  access: { portal: "any" },
  params: idParams,
  response: portalOrderView,
});

/** Change a Submitted order (refused once Marsa confirmed it, or while someone at Marsa is editing it). */
export const updateOrder = route({
  id: "portal.orders.update",
  method: "PATCH",
  path: "/v1/portal/orders/:id",
  access: { portal: "shop" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version,
      ...checkoutFields,
      preferredPayment: z.enum(PREFERRED_PAYMENTS).optional(),
      lines: z
        .array(z.object({ productId: uuid, quantity }).strict())
        .min(1)
        .max(500)
        .optional(),
    })
    .strict(),
  response: portalOrderView,
});

/**
 * Cancel a Submitted order (shop). Declared for every portal role: slice 7 adds cancelling after invoicing
 * (pay), which voids the invoice and releases the stock.
 */
export const cancelOrder = route({
  id: "portal.orders.cancel",
  method: "POST",
  path: "/v1/portal/orders/:id/cancel",
  access: { portal: "any" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version, note: z.string().max(500).nullable().optional() }).strict(),
  response: portalOrderView,
});

export const REORDER_GROUPS = ["in_stock", "short", "discontinued"] as const;
export const REORDER_MODES = ["add", "replace"] as const;

/** UX S4 (ORD-2, D975): the reorder sheet: the order's items as Reorder adds them, priced today. */
export const reorderSheet = z.object({
  order: z.object({ id: uuid, number: z.string(), placedOn: day }),
  lines: z.array(
    z.object({
      productId: uuid,
      name: z.string(),
      sku: z.string(),
      brand: z.string().nullable(),
      imageUrl: z.string().nullable(),
      /** in_stock; short (some or none in stock); discontinued (no longer sold on the portal). */
      group: z.enum(REORDER_GROUPS),
      orderedQty: z.number().int(),
      /** What Reorder adds (the item's rules applied today); 0 when nothing can go in. */
      quantity: z.number().int(),
      priceCents: z.number().int().nullable(),
      lineCents: centsString,
      available: z.number().int(),
      stockLabel: z.string(),
      following: z.boolean(),
      addable: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
  counts: z.object({
    inStock: z.number().int(),
    short: z.number().int(),
    discontinued: z.number().int(),
    addable: z.number().int(),
  }),
  totalCents: centsString,
  /** Lines already in the cart: the sheet asks "Add to cart" or "Replace cart". */
  cartLines: z.number().int(),
  /**
   * ORD-5 (D1646): an earlier order's lines that match no current item (no product and no SKU on the catalog),
   * listed so nothing is silently dropped. Always empty for an order placed here.
   */
  unmatched: z
    .array(z.object({ name: z.string(), sku: z.string().nullable(), quantity: z.number().int() }))
    .default([]),
});

export const reorderPreview = route({
  id: "portal.orders.reorder_sheet",
  method: "GET",
  path: "/v1/portal/orders/:id/reorder",
  access: { portal: "shop" },
  params: idParams,
  response: reorderSheet,
});

/**
 * The order's items into the cart at today's prices and quantities (UX S4, ORD-2): `mode` add (default) or
 * replace, `productIds` the sheet's ticked items (default: every item that can go in). Out of stock and no longer
 * sold come back in `skipped`. The key is required, so a second press of the same sheet replays the first.
 */
export const reorder = route({
  id: "portal.orders.reorder",
  method: "POST",
  path: "/v1/portal/orders/:id/reorder",
  access: { portal: "shop" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      mode: z.enum(REORDER_MODES).optional(),
      productIds: z.array(uuid).min(1).max(500).optional(),
    })
    .strict()
    .optional(),
  response: z.object({
    cart: cartView,
    skipped: z.array(z.object({ productId: uuid, name: z.string(), reason: z.string() })),
    mode: z.enum(REORDER_MODES),
    added: z.number().int(),
  }),
});

/** "Ask for changes" (WOrder, WReviewPay): the customer's words to their rep. */
export const askOrderChanges = route({
  id: "portal.orders.ask_changes",
  method: "POST",
  path: "/v1/portal/orders/:id/ask-changes",
  access: { portal: "any" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ message: z.string().trim().min(1, "Say what you'd like changed").max(2000) }).strict(),
  response: changesAsked,
});

const pdfBytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected PDF bytes");

/**
 * WOrder "Packing slip · Download": DPackingSlip of one of the customer's shipments. It has no money on it at
 * all (no price, cost or total), so every portal role may read it; another customer's shipment is the same 404.
 */
export const packingSlipPdf = route({
  id: "portal.deliveries.packing_slip",
  method: "GET",
  path: "/v1/portal/deliveries/:id/packing-slip",
  access: { portal: "any" },
  params: idParams,
  query: z.object({ download: boolQuery }),
  response: pdfBytes,
});

/**
 * Line sheet "Download catalog (PDF)": DCatalogCover + DCatalogPage at the customer's own prices (the PDF Send
 * catalog emails). Shop roles only: an Accounts user sees no prices.
 */
export const catalogPdf = route({
  id: "portal.catalog.pdf",
  method: "GET",
  path: "/v1/portal/catalog.pdf",
  access: { portal: "shop" },
  query: z.object({ download: boolQuery }),
  response: pdfBytes,
});

/** WHome "Your rep is Ez Shaar · WhatsApp · Email". */
export const rep = route({
  id: "portal.rep",
  method: "GET",
  path: "/v1/portal/rep",
  access: { portal: "any" },
  response: repView,
});

/** admin-w6 (D655): the shipping methods Marsa shows on the portal, in its order. */
export const portalShippingMethod = z.object({
  id: uuid,
  name: z.string(),
  kind: z.string(),
  /** Null: Marsa quotes the freight. */
  chargeCents: centsString.nullable(),
  freeOverCents: centsString.nullable(),
  description: z.string().nullable(),
  pickup: z.boolean(),
});

export const shippingMethods = route({
  id: "portal.shipping_methods",
  method: "GET",
  path: "/v1/portal/shipping-methods",
  access: { portal: "any" },
  response: z.object({ rows: z.array(portalShippingMethod) }),
});

// ── Quotes ──────────────────────────────────────────────────────────────

export const listQuotes = route({
  id: "portal.quotes.list",
  method: "GET",
  path: "/v1/portal/quotes",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(portalQuoteRow) }),
});

/** The quote PDF's "Accept online" link opens `/quotes/<id>` on the portal, which reads this. */
export const getQuote = route({
  id: "portal.quotes.get",
  method: "GET",
  path: "/v1/portal/quotes/:id",
  access: { portal: "shop" },
  params: idParams,
  response: portalQuoteView,
});

/** "Accept and order": a Submitted order at the quoted prices; less than quoted refused, more at the usual price. */
export const acceptQuote = route({
  id: "portal.quotes.accept",
  method: "POST",
  path: "/v1/portal/quotes/:id/accept",
  access: { portal: "shop" },
  idempotency: "required",
  status: 201,
  params: idParams,
  body: z
    .object({
      ...checkoutFields,
      preferredPayment: z.enum(PREFERRED_PAYMENTS),
      lines: z
        .array(z.object({ quoteLineId: uuid, quantity }).strict())
        .max(500)
        .optional(),
    })
    .strict(),
  response: submittedOrder,
});

export const declineQuote = route({
  id: "portal.quotes.decline",
  method: "POST",
  path: "/v1/portal/quotes/:id/decline",
  access: { portal: "shop" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ reason: z.string().max(500).nullable().optional() }).strict(),
  response: portalQuoteView,
});

/**
 * ORD-6 (D1647): the quote as a PDF (DQuote), the same document the rep sent, for the customer's own quote. Shop
 * roles (the quote carries prices).
 */
export const quotePdf = route({
  id: "portal.quotes.pdf",
  method: "GET",
  path: "/v1/portal/quotes/:id/pdf",
  access: { portal: "shop" },
  params: idParams,
  query: z.object({ download: boolQuery }),
  response: pdfBytes,
});

/**
 * Finish-everything 21 (D1648): a held order with nothing invoiced yet (over the credit limit) can be paid ahead:
 * the order's pay link at the processor (made now, or the pending one), so "contact us" isn't the only way out.
 * Refusals: `not_on_hold` (nothing to pay ahead), `invoiced` (pay the invoices instead), `payments_unavailable`.
 */
export const orderPayLink = route({
  id: "portal.orders.pay_link",
  method: "POST",
  path: "/v1/portal/orders/:id/pay-link",
  access: { portal: "pay" },
  idempotency: "optional",
  params: idParams,
  body: z.object({}).strict().optional(),
  response: z.object({ url: z.string(), amountCents: centsString, expiresAt: isoTime }),
});

export const askQuoteChanges = route({
  id: "portal.quotes.ask_changes",
  method: "POST",
  path: "/v1/portal/quotes/:id/ask-changes",
  access: { portal: "shop" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ message: z.string().trim().min(1, "Say what you'd like changed").max(2000) }).strict(),
  response: changesAsked,
});

// ── Saved lists ─────────────────────────────────────────────────────────

const listItems = z.array(z.object({ productId: uuid, quantity: quantity.optional() }).strict()).max(500);

export const listLists = route({
  id: "portal.lists.list",
  method: "GET",
  path: "/v1/portal/lists",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(listSummary) }),
});

/** A new list from items, or from the cart ("Save as a list"). */
export const createList = route({
  id: "portal.lists.create",
  method: "POST",
  path: "/v1/portal/lists",
  access: { portal: "shop" },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      name: z.string().trim().min(1, "Name the list").max(100),
      items: listItems.optional(),
      fromCart: z.boolean().optional(),
    })
    .strict(),
  response: listView,
});

export const getList = route({
  id: "portal.lists.get",
  method: "GET",
  path: "/v1/portal/lists/:id",
  access: { portal: "shop" },
  params: idParams,
  response: listView,
});

/** Rename and/or replace the items. */
export const updateList = route({
  id: "portal.lists.update",
  method: "PATCH",
  path: "/v1/portal/lists/:id",
  access: { portal: "shop" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({ version, name: z.string().trim().min(1).max(100).optional(), items: listItems.optional() })
    .strict(),
  response: listView,
});

export const deleteList = route({
  id: "portal.lists.delete",
  method: "DELETE",
  path: "/v1/portal/lists/:id",
  access: { portal: "shop" },
  idempotency: "optional",
  params: idParams,
  body: z.object({}).strict().optional(),
  noContent: true,
});

// ── Restock follows ─────────────────────────────────────────────────────

export const listFollows = route({
  id: "portal.follows.list",
  method: "GET",
  path: "/v1/portal/follows",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(followView) }),
});

/** "Tell me when it's back" (an out-of-stock item only; following again answers the same follow). */
export const follow = route({
  id: "portal.follows.follow",
  method: "POST",
  path: "/v1/portal/follows/:productId",
  access: { portal: "shop" },
  idempotency: "optional",
  params: productParams,
  body: z.object({}).strict().optional(),
  response: followView,
});

export const unfollow = route({
  id: "portal.follows.unfollow",
  method: "DELETE",
  path: "/v1/portal/follows/:productId",
  access: { portal: "shop" },
  idempotency: "optional",
  params: productParams,
  body: z.object({}).strict().optional(),
  noContent: true,
});

// ── Search suggestions and measurement (UX S2) ─────────────────────────

/**
 * UX S2 (SHOP-13, D858): the header search's typeahead, same matching as the catalog (each word somewhere, then
 * close spellings): up to 6 items and 3 brands. No prices (the cards and the item page carry them).
 */
export const searchSuggest = route({
  id: "portal.search.suggest",
  method: "GET",
  path: "/v1/portal/search/suggest",
  access: { portal: "shop" },
  query: z.object({ q: z.string().trim().min(2).max(100) }),
  response: z.object({
    items: z.array(
      z.object({
        id: uuid,
        name: z.string(),
        sku: z.string(),
        brand: z.string(),
        imageUrl: z.string().nullable(),
      }),
    ),
    brands: z.array(z.object({ id: uuid, name: z.string() })),
    fuzzy: z.boolean(),
  }),
});

/**
 * W6a (02-portal.md §7, D860–D866): the events `track()` sends. The browser sends only these names; `order_submitted`
 * is recorded by the server where the order is sent (never accepted from a browser).
 */
export const PORTAL_EVENTS = [
  // Acquisition and sign-in.
  "landing_view",
  "apply_start",
  "apply_step_done",
  "apply_error",
  "apply_submitted",
  "signin_view",
  "signin_ok",
  "signin_fail",
  // Discovery.
  "search",
  "search_suggestion_click",
  "search_result_click",
  "did_you_mean_click",
  "ask_rep_click",
  "filter_change",
  "product_view",
  "notify_me",
  // Cart and checkout.
  "add_to_cart",
  "cart_view",
  "cart_line_change",
  // UX S3 (D919): a problem line shown, a fix tapped, the free-freight bar, usuals added under the minimum, a
  // coupon tried at checkout.
  "cart_problem_shown",
  "cart_fix_applied",
  "freight_bar_shown",
  "usuals_added",
  "coupon_apply",
  "checkout_view",
  "order_submit_error",
  // Retention.
  "reorder_click",
  // UX S4 (D978): the reorder sheet opened, its items added.
  "reorder_sheet_open",
  "reorder_added",
  "usual_order_add",
  "list_add",
  // Pay.
  "invoices_view",
  "pay_view",
  "checkout_redirect",
  "payment_returned",
  "pay_link_closed_view",
  // UX S4 (D978): the selection changed on the pay page, Pay pressed with a saved method, the receipt shown.
  "pay_select_change",
  "pay_saved_method",
  "payment_receipt_view",
  // Errors.
  "page_error",
  // UX S6 (W5, D1410): the public catalog seen signed out, Apply tapped from it, the resume link copied.
  "public_catalog_view",
  "public_apply_click",
  "apply_link_copied",
] as const;
export type PortalEventName = (typeof PORTAL_EVENTS)[number];
/**
 * Recorded by the server only. UX S6 (ACC-1, D1412): the automatic abandoned-cart email sent, and a cart that was
 * abandoned sent as an order (`cart_recovered`, with whether the email had gone).
 */
export const SERVER_PORTAL_EVENTS = ["order_submitted", "cart_abandoned_sent", "cart_recovered"] as const;
export const PORTAL_DEVICES = ["phone", "tablet", "desktop"] as const;

/** An event's small facts: at most 20, each a short string, a number, true/false or null. */
export const portalEventProps = z
  .record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]),
  )
  .refine((o) => Object.keys(o).length <= 20, "At most 20 facts on one event");

/**
 * W6a: a batch of portal events (signed in or out; public, 120 a minute per address). The customer, person and
 * role come from the session cookie when there is one, never from the body; `sessionId` is the tab's random id.
 * Answers how many were kept. A refused body is 400 like any other.
 */
export const trackEvents = route({
  id: "portal.events.track",
  method: "POST",
  path: "/v1/portal/events",
  access: { public: true },
  // A beacon can't send headers, so a key is optional (a repeated batch is two batches; counts are by tab).
  idempotency: "optional",
  body: z
    .object({
      sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      device: z.enum(PORTAL_DEVICES),
      events: z
        .array(
          z
            .object({
              name: z.enum(PORTAL_EVENTS),
              at: z.string().datetime({ offset: true }).optional(),
              route: z.string().max(200).optional(),
              props: portalEventProps.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  response: z.object({ accepted: z.number().int() }),
});

export const ROUTES = {
  publicBrands,
  publicCatalog,
  publicLanding,
  publicProduct,
  publicMinimum,
  stopAlerts,
  brands,
  catalog,
  catalogItemRoute,
  lookup,
  newArrivals,
  buyAgain,
  usualOrder,
  getCart,
  setCartLine,
  removeCartLine,
  addCartLines,
  submitCart,
  previewCartCoupon,
  fixCart,
  listOrders,
  getOrder,
  updateOrder,
  cancelOrder,
  reorderPreview,
  reorder,
  askOrderChanges,
  listQuotes,
  getQuote,
  acceptQuote,
  declineQuote,
  askQuoteChanges,
  quotePdf,
  orderPayLink,
  listLists,
  createList,
  getList,
  updateList,
  deleteList,
  listFollows,
  follow,
  unfollow,
  publicTopSellers,
  askQuote,
  packingSlipPdf,
  catalogPdf,
  rep,
  shippingMethods,
  publicBranding,
  publicLogo,
  searchSuggest,
  trackEvents,
} satisfies Record<string, RouteContract>;
