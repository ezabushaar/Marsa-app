import { z } from "zod";
import {
  type RouteContract,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  page,
  route,
  userRef,
  uuid,
} from "../http.js";
import { PRICE_LISTS } from "../settings.js";
import { approvalRow } from "./documents.js";
import { catalogItem } from "./portal/shop.js";
import { PRODUCT_STATUSES, priceCents } from "./products.js";

/**
 * Price lists (PriceLists board, Settings / Pricing and tiers) and clearance (StockClearance, WClearance).
 *
 * Price lists: the Standard and Tier 1–3 prices of every item that can still be sold, the floor rule as it is
 * enforced (an item's minimum price, and its minimum margin or `pricing.floor`'s default), the price proposals
 * waiting for a Manager (the existing `price_change` approvals) and each item's price history. Prices change
 * through the item's own routes (`PUT /v1/products/:id/prices`, `POST /v1/products/:id/price-proposals`). Cost
 * shows only with cost.view; margins and the floor only with cost.view and margin.view (the keys are absent).
 *
 * Clearance (plan "Clearance", decision 8): items set up with a clearance price, a per-store limit, a channel
 * and an optional last day, Draft → Published (prices.edit). A clearance price under the item's cost (or with no
 * cost on file) waits for someone with documents.price.approve_below_minimum. Published wholesale items show on
 * the portal's Clearance page as final sale; the page is hidden while there are none.
 */

// ── Price lists ─────────────────────────────────────────────────────────

/** The grid's chips: under_floor needs cost.view and margin.view, no_cost needs cost.view. */
export const PRICE_GRID_VIEWS = ["all", "tiers_rise", "under_floor", "no_cost", "waiting"] as const;

export const priceGridRow = z.object({
  id: uuid,
  sku: z.string(),
  upc: z.string().nullable(),
  name: z.string(),
  brand: z.object({ id: uuid, name: z.string() }),
  imageUrl: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  retailPriceCents: z.number().int().nullable(),
  standardPriceCents: z.number().int(),
  tier1PriceCents: z.number().int().nullable(),
  tier2PriceCents: z.number().int().nullable(),
  tier3PriceCents: z.number().int().nullable(),
  /** Tiers with blanks filled from the tier before (what a customer on that list pays). */
  effectivePrices: z.object({ tier1: z.number().int(), tier2: z.number().int(), tier3: z.number().int() }),
  minPriceCents: z.number().int().nullable(),
  msrpCents: z.number().int().nullable(),
  version: z.number().int(),
  /** A tier above the one before it (legacy data): it can't be saved until fixed. */
  tiersRise: z.boolean(),
  /** The pending price proposal for the item, if any. */
  pendingApprovalId: uuid.nullable(),
  /** Only with cost.view: the average cost (layers, else the import fallback); null = no cost on file. */
  costCents: z.number().int().nullable().optional(),
  /** Only with cost.view and margin.view. */
  minMarginBp: z.number().int().nullable().optional(),
  effectiveMinMarginBp: z.number().int().optional(),
  /** Margin at the effective Tier 3 (the lowest list price). */
  marginAtFloorBp: z.number().int().nullable().optional(),
  /** The effective Tier 3 is under the item's minimum price or minimum margin. */
  floorBreaks: z.boolean().optional(),
  floorReason: z.string().nullable().optional(),
});

export const priceListsOverview = route({
  id: "price_lists.overview",
  method: "GET",
  path: "/v1/price-lists",
  access: { self: true },
  response: z.object({
    counts: z.object({
      all: z.number().int(),
      tiersRise: z.number().int(),
      waiting: z.number().int(),
      /** Only with cost.view and margin.view. */
      underFloor: z.number().int().optional(),
      /** Only with cost.view. */
      noCost: z.number().int().optional(),
    }),
    /** The items whose tiers go up (first 20), for the banner. */
    tiersRise: z.array(z.object({ id: uuid, name: z.string(), brand: z.string() })),
    /** Active wholesale customers on each list. */
    customers: z.object({
      standard: z.number().int(),
      tier1: z.number().int(),
      tier2: z.number().int(),
      tier3: z.number().int(),
    }),
    /** `pricing.floor` as enforced; the default minimum margin only with margin.view. */
    floor: z.object({
      enforceOnItemPrices: z.boolean(),
      defaultMinMarginBp: z.number().int().optional(),
    }),
  }),
});

export const priceGrid = route({
  id: "price_lists.grid",
  method: "GET",
  path: "/v1/price-lists/items",
  access: { self: true },
  query: z.object({
    view: z.enum(PRICE_GRID_VIEWS).default("all"),
    search: z.string().trim().max(100).optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(priceGridRow),
});

/** One tier of a proposal: what the list charges now and what is asked. */
export const proposalTier = z.object({
  tier: z.enum(PRICE_LISTS),
  currentCents: z.number().int(),
  proposedCents: z.number().int(),
  /** Only with cost.view and margin.view: the margin at the proposed price. */
  marginBp: z.number().int().nullable().optional(),
});

export const priceProposalRow = z.object({
  approval: approvalRow,
  item: z.object({
    id: uuid,
    sku: z.string(),
    upc: z.string().nullable(),
    name: z.string(),
    brand: z.string(),
  }),
  /** Only the tiers the proposal changes (after blanks fall back to the tier before). */
  tiers: z.array(proposalTier),
});

/** Pending price proposals the caller may decide or asked for (Waiting for approval). */
export const priceProposals = route({
  id: "price_lists.proposals",
  method: "GET",
  path: "/v1/price-lists/proposals",
  access: { self: true },
  response: z.object({ rows: z.array(priceProposalRow) }),
});

/** A price field as the history shows it: whole cents, or basis points for the minimum margin. */
const priceValues = z.record(z.string(), z.number().int().nullable());

export const priceHistoryRow = z.object({
  id: z.number().int(),
  at: isoTime,
  by: userRef.nullable(),
  /** created = the item's first prices; changed = a direct change or an approved proposal. */
  action: z.enum(["created", "changed"]),
  /** The approved proposal that made the change. */
  approvalId: uuid.nullable(),
  reason: z.string().nullable(),
  /** Only the price fields of the change; the minimum margin only with cost.view and margin.view. */
  before: priceValues,
  after: priceValues,
});

export const priceHistory = route({
  id: "price_lists.history",
  method: "GET",
  path: "/v1/products/:id/price-history",
  access: { self: true },
  params: z.object({ id: uuid }),
  response: z.object({ rows: z.array(priceHistoryRow) }),
});

// ── Clearance ───────────────────────────────────────────────────────────

export const CLEARANCE_STATUSES = ["draft", "waiting_approval", "published", "ended"] as const;
export const CLEARANCE_CHANNELS = ["wholesale", "retail", "both"] as const;

export const clearanceRow = z.object({
  id: uuid,
  item: z.object({
    id: uuid,
    sku: z.string(),
    upc: z.string().nullable(),
    name: z.string(),
    brand: z.string(),
    imageUrl: z.string().nullable(),
    status: z.enum(PRODUCT_STATUSES),
  }),
  standardPriceCents: z.number().int(),
  clearancePriceCents: z.number().int().nullable(),
  /** Off Standard, in basis points (1 − clearance ÷ Standard), rounded down; null while no price is set. */
  discountBp: z.number().int().nullable(),
  limitPerStore: z.number().int().nullable(),
  channel: z.enum(CLEARANCE_CHANNELS),
  endsOn: day.nullable(),
  /** `ended` also when a published item's last day has passed. */
  status: z.enum(CLEARANCE_STATUSES),
  /** Sellable − reserved over active warehouses. */
  available: z.number().int(),
  approvalId: uuid.nullable(),
  publishedAt: isoTime.nullable(),
  publishedBy: userRef.nullable(),
  endedAt: isoTime.nullable(),
  version: z.number().int(),
  /** Only with cost.view. */
  costCents: z.number().int().nullable().optional(),
  /** Only with cost.view: the clearance price is under cost, or there is no cost to compare (needs a Manager). */
  needsApproval: z.boolean().optional(),
  /** Only with cost.view and margin.view. */
  marginBp: z.number().int().nullable().optional(),
});

export const listClearance = route({
  id: "clearance.list",
  method: "GET",
  path: "/v1/clearance",
  access: { self: true },
  query: z.object({ state: z.enum(["current", "ended"]).default("current") }),
  response: z.object({ rows: z.array(clearanceRow) }),
});

/** Add items as drafts (StockClearance "Add items"). */
export const addClearanceItems = route({
  id: "clearance.add",
  method: "POST",
  path: "/v1/clearance",
  access: { permission: "prices.edit" },
  idempotency: "required",
  body: z.object({ productIds: z.array(uuid).min(1, "Pick at least one item").max(100) }).strict(),
  response: z.object({ rows: z.array(clearanceRow) }),
});

/** Save draft: price, limit, channel, last day. A new price on a published item takes it back to Draft. */
export const updateClearanceItem = route({
  id: "clearance.update",
  method: "PATCH",
  path: "/v1/clearance/:id",
  access: { permission: "prices.edit" },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      version: z.number().int().min(1),
      clearancePriceCents: priceCents.nullable().optional(),
      limitPerStore: z.number().int().min(1).max(100_000).nullable().optional(),
      channel: z.enum(CLEARANCE_CHANNELS).optional(),
      endsOn: day.nullable().optional(),
    })
    .strict(),
  response: clearanceRow,
});

/** Publish clearance: every draft (or the ones named). Under cost without the permission: waits for a Manager. */
export const publishClearance = route({
  id: "clearance.publish",
  method: "POST",
  path: "/v1/clearance/publish",
  access: { permission: "prices.edit" },
  idempotency: "optional",
  body: z.object({ ids: z.array(uuid).min(1).max(200).optional() }).strict(),
  response: z.object({
    published: z.number().int(),
    waiting: z.number().int(),
    rows: z.array(clearanceRow),
  }),
});

/** End clearance: a published item goes back to its normal price; a draft is removed. */
export const endClearanceItem = route({
  id: "clearance.end",
  method: "POST",
  path: "/v1/clearance/:id/end",
  access: { permission: "prices.edit" },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z.object({ version: z.number().int().min(1) }).strict(),
  response: z.object({ removed: z.boolean(), row: clearanceRow.nullable() }),
});

// ── Portal: WClearance ──────────────────────────────────────────────────

export const portalClearanceItem = catalogItem.extend({
  clearancePriceCents: z.number().int(),
  /** Off the customer's own price, in basis points, rounded down. */
  discountBp: z.number().int(),
  limitPerStore: z.number().int().nullable(),
  endsOn: day.nullable(),
});

/** The published wholesale clearance items, at prices under the customer's own; empty hides the page. */
export const portalClearance = route({
  id: "portal.catalog.clearance",
  method: "GET",
  path: "/v1/portal/clearance",
  access: { portal: "shop" },
  response: z.object({ rows: z.array(portalClearanceItem) }),
});

export const ROUTES = {
  priceListsOverview,
  priceGrid,
  priceProposals,
  priceHistory,
  listClearance,
  addClearanceItems,
  updateClearanceItem,
  publishClearance,
  endClearanceItem,
} satisfies Record<string, RouteContract>;

/** The portal route, listed with the other portal maps for the portal contract tests. */
export const PORTAL_ROUTES = { portalClearance } satisfies Record<string, RouteContract>;
