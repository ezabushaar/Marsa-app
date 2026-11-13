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
  uuid,
} from "../http.js";
import { approvalRow } from "./documents.js";

// ── Shared field schemas ────────────────────────────────────────────────

/** A unit price in integer cents (fits a Postgres integer: at most $21,474,836.47). */
export const priceCents = z.number().int().min(1, "Prices are above zero").max(2_147_483_647);
/** A percentage in basis points, 0-99.99% (15% = 1500). */
export const marginBp = z.number().int().min(0).max(9999);
/** UPC or case barcode: 8 to 14 digits (the check digit is not enforced; live data carries bad ones). */
export const barcode = z
  .string()
  .trim()
  .regex(/^\d{8,14}$/, "Barcodes are 8 to 14 digits");
export const sku = z.string().trim().min(1, "Enter a SKU").max(64, "SKUs are at most 64 characters");
export const brandCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9]{2,6}$/, "Brand codes are 2 to 6 letters or digits"));
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url("Enter a full image address")
  .refine((u) => u.startsWith("https://"), "Image addresses start with https://");
const reason = z.string().trim().max(500);

export const PRODUCT_STATUSES = ["active", "hidden", "discontinued"] as const;
/**
 * The three categories the item record had before the tree (migration 0043); since catalog-w5 (migration 0200)
 * they are the first top-level categories of `product_categories`, with these codes. Categories are now read
 * from `categories.list`; these stay for the labels of old links and saved reports.
 */
export const PRODUCT_CATEGORIES = ["fragrance", "body_care", "accessories"] as const;
export const PRODUCT_CATEGORY_LABELS: Record<(typeof PRODUCT_CATEGORIES)[number], string> = {
  fragrance: "Fragrance",
  body_care: "Body care",
  accessories: "Accessories",
};
/** A category's code: lower-case letters, digits, - and _, at most 40 (`fragrance`, `oud-oils`). */
export const categoryCode = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Category codes are lower-case letters, digits, - and _"),
  );
/** The deepest a category may sit (0 = top level), as the server holds it. */
export const MAX_CATEGORY_DEPTH = 4;

/** An extra barcode of an item (catalog-w5): an alternate UPC (1 unit a scan) or a box (its units a scan). */
export const extraBarcode = z.object({
  code: barcode,
  units: z.number().int().min(1).max(100_000),
  /** "Inner box", "Old packaging". */
  label: z.string().trim().max(60).nullable(),
});

export const PRODUCT_ISSUES = ["no_upc", "no_cost", "no_image", "tiers_rise"] as const;
/** The Items board's stock chips: In stock, Low (at or under the reorder point), Out. */
export const PRODUCT_STOCK_STATES = ["in_stock", "low", "out"] as const;
/** The Items list's chip counts: All, the stock states, the issues (No cost only with cost.view), Discontinued. */
export const PRODUCT_TABS = ["all", ...PRODUCT_STOCK_STATES, ...PRODUCT_ISSUES, "discontinued"] as const;
/** `cost` needs cost.view and `margin` needs cost.view and margin.view (the server refuses them otherwise). */
export const PRODUCT_SORTS = [
  "name",
  "sku",
  "brand",
  "upc",
  "cost",
  "margin",
  "standard",
  "tier1",
  "tier2",
  "tier3",
  "retail",
  "status",
  "updatedAt",
  // A7 (UX audit IN-3, D1466): the stock columns, in the warehouse filtered (else every active one).
  "onHand",
  "reserved",
  "available",
] as const;

// ── Brands ──────────────────────────────────────────────────────────────

export const brandRow = z.object({
  id: uuid,
  name: z.string(),
  code: z.string(),
  /** The number the next MS-<code>- SKU gets. */
  nextSkuSeq: z.number().int(),
  active: z.boolean(),
  productCount: z.number().int(),
  version: z.number().int(),
  /** launch-images: the brand's logo (an image path), or null. */
  logoUrl: z.string().nullable().optional(),
});

export const listBrands = route({
  id: "brands.list",
  method: "GET",
  path: "/v1/brands",
  access: { self: true },
  query: z.object({ includeInactive: boolQuery }),
  response: z.object({ rows: z.array(brandRow) }),
});

export const createBrand = route({
  id: "brands.create",
  method: "POST",
  path: "/v1/brands",
  access: { permission: "products.edit" },
  idempotency: "required",
  body: z.object({ name: z.string().trim().min(1, "Enter a name").max(100), code: brandCode }).strict(),
  response: brandRow,
});

/** Rename, change the code (only while no MS-<code>- SKU uses it), deactivate or reactivate. */
export const updateBrand = route({
  id: "brands.update",
  method: "PATCH",
  path: "/v1/brands/:id",
  access: { permission: "products.edit" },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      version: z.number().int().min(1),
      name: z.string().trim().min(1).max(100).optional(),
      code: brandCode.optional(),
      active: z.boolean().optional(),
      reason: reason.optional(),
    })
    .strict(),
  response: brandRow,
});

// ── Categories (catalog-w5, D600–D629) ──────────────────────────────────

export const categoryRow = z.object({
  id: uuid,
  /** The category's key in links, report filters and promotion scopes; it never changes. */
  code: z.string(),
  name: z.string(),
  parentId: uuid.nullable(),
  /** "Fragrance › Oud oils". */
  path: z.string(),
  /** 0 for a top-level category. */
  depth: z.number().int(),
  sortOrder: z.number().int(),
  /** Shown in the portal's category filter. */
  portalVisible: z.boolean(),
  active: z.boolean(),
  description: z.string().nullable(),
  /** Items in this category itself, and in its whole branch (discontinued ones too). */
  itemCount: z.number().int(),
  branchItemCount: z.number().int(),
  childCount: z.number().int(),
  version: z.number().int(),
});

/** The tree in display order (each category right after its parent). */
export const listCategories = route({
  id: "categories.list",
  method: "GET",
  path: "/v1/categories",
  access: { self: true },
  query: z.object({ includeInactive: boolQuery }),
  response: z.object({ rows: z.array(categoryRow) }),
});

const categoryName = z.string().trim().min(1, "Enter a name").max(80);
const categoryDescription = z.string().trim().max(1000).nullable();

/** New category at the top level or under an active parent; a blank code is made from the name. */
export const createCategory = route({
  id: "categories.create",
  method: "POST",
  path: "/v1/categories",
  access: { permission: "products.edit" },
  idempotency: "required",
  body: z
    .object({
      name: categoryName,
      code: categoryCode.nullable().optional(),
      parentId: uuid.nullable().optional(),
      description: categoryDescription.optional(),
      sortOrder: z.number().int().min(0).max(100_000).optional(),
      portalVisible: z.boolean().optional(),
    })
    .strict(),
  response: categoryRow,
});

/**
 * Rename, move (not under itself or its own), reorder, show or hide on the portal, deactivate (refused while
 * live items or active sub-categories are in it) or reactivate. The code never changes.
 */
export const updateCategory = route({
  id: "categories.update",
  method: "PATCH",
  path: "/v1/categories/:id",
  access: { permission: "products.edit" },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      version: z.number().int().min(1),
      name: categoryName.optional(),
      parentId: uuid.nullable().optional(),
      description: categoryDescription.optional(),
      sortOrder: z.number().int().min(0).max(100_000).optional(),
      portalVisible: z.boolean().optional(),
      active: z.boolean().optional(),
      reason: reason.optional(),
    })
    .strict(),
  response: categoryRow,
});

// ── Products ────────────────────────────────────────────────────────────

export const productRow = z.object({
  id: uuid,
  sku: z.string(),
  upc: z.string().nullable(),
  brand: z.object({ id: uuid, name: z.string(), code: z.string() }),
  name: z.string(),
  imageUrl: z.string().nullable(),
  /**
   * launch-images: the first stored picture, and what lists show (the stored picture's thumb or card, else
   * the website address `imageUrl`, else null).
   */
  imageId: uuid.nullable().optional(),
  thumbUrl: z.string().nullable().optional(),
  cardUrl: z.string().nullable().optional(),
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
  casePack: z.number().int().nullable(),
  caseBarcode: z.string().nullable(),
  /**
   * line-item L3 (D700–D719): sold in packs of this many units, and the fewest and most units on one order.
   * Staff lines warn (the server accepts); the portal cart refuses outside min/max. Null or absent: no rule.
   */
  sellMultiple: z.number().int().nullable().optional(),
  minSellQty: z.number().int().nullable().optional(),
  maxSellQty: z.number().int().nullable().optional(),
  /**
   * The item's category (catalog-w5: the tree): its code, id, name and path ("Fragrance › Oud oils"); and its
   * extra barcodes. What the portal shows about the item (WProduct notes, size and case photo) follows.
   */
  category: z.string(),
  categoryId: uuid.optional(),
  categoryName: z.string().optional(),
  categoryPath: z.string().optional(),
  barcodes: z.array(extraBarcode).default([]),
  scentNotes: z.string().nullable(),
  sizeLabel: z.string().nullable(),
  caseImageUrl: z.string().nullable(),
  /** Stripe product tax code (`txcd_` + 8 digits); null: the account's default code. */
  taxCode: z.string().nullable().optional(),
  reorderPoint: z.number().int(),
  reorderQty: z.number().int(),
  leadTimeDays: z.number().int().nullable(),
  preferredVendor: z.object({ id: uuid, name: z.string() }).nullable(),
  /** Over active warehouses: physical on hand, reserved and sellable − reserved (phase 2). */
  onHand: z.number().int().nullable(),
  reserved: z.number().int().nullable(),
  available: z.number().int().nullable(),
  /** P10 (D1982): the SKUs of the item's substitutes in their order (the Items export's "Substitutes" column). */
  substituteSkus: z.array(z.string()).default([]),
  version: z.number().int(),
  createdAt: isoTime,
  updatedAt: isoTime.nullable(),
  /** Only with cost.view; the keys are absent otherwise. */
  fallbackCostCents: z.number().int().nullable().optional(),
  /**
   * The cost the margins use: the weighted average from cost layers ("layers"), else the import fallback
   * ("fallback"), else null ("none": listed under No cost, never silently zero).
   */
  costCents: z.number().int().nullable().optional(),
  costSource: z.enum(["layers", "fallback", "none"]).optional(),
  averageCostCents: z.number().int().nullable().optional(),
  lastReceiptCostCents: z.number().int().nullable().optional(),
  /** The item's inventory value over the company (ties to 1200 with every other item's). */
  stockValueCents: centsString.optional(),
  stockQuantity: z.number().int().optional(),
  /** Only with cost.view and margin.view; the keys are absent otherwise. */
  minMarginBp: z.number().int().nullable().optional(),
  effectiveMinMarginBp: z.number().int().optional(),
  marginAtStandardBp: z.number().int().nullable().optional(),
  /** The item read alone: its live wholesale clearance (decision 85), which an order line can take. */
  clearance: z
    .object({
      priceCents: z.number().int(),
      limitPerStore: z.number().int().nullable(),
      endsOn: day.nullable(),
    })
    .nullable()
    .optional(),
  marginAtTier3Bp: z.number().int().nullable().optional(),
  marginAtMsrpBp: z.number().int().nullable().optional(),
});

export const listProducts = route({
  id: "products.list",
  method: "GET",
  path: "/v1/products",
  access: { self: true },
  query: z.object({
    search: z.string().trim().max(100).optional(),
    /**
     * Only these items, comma-separated (at most 200): lines tables fetch the picture, brand and UPC of the
     * items they show in one request. Pair with `limit` at least the number of ids.
     */
    ids: z
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
      .pipe(z.array(uuid).min(1).max(200))
      .optional(),
    brandId: uuid.optional(),
    /** catalog-w5: a category's code; its whole branch (an unknown code is 400 unknown_category). */
    category: categoryCode.optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
    issue: z.enum(PRODUCT_ISSUES).optional(),
    /** Column-header filters (D282): the item's name, SKU and UPC (or case barcode), and statuses. */
    name: columnSearch,
    sku: columnSearch,
    upc: columnSearch,
    statuses: csvEnum(PRODUCT_STATUSES),
    /** In stock, Low or Out, over every warehouse or `warehouseId`'s. */
    stock: z.enum(PRODUCT_STOCK_STATES).optional(),
    /** On hand, reserved and available (and the stock chips) for this warehouse only. */
    warehouseId: uuid.optional(),
    sort: z.enum(PRODUCT_SORTS).default("name"),
    dir: z.enum(["asc", "desc"]).default("asc"),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  /**
   * `counts`: each chip with the search, brand and warehouse applied; `duplicateUpc`: website items the import
   * refused because their UPC is already on another item (open migration exceptions).
   */
  response: countedPage(productRow, PRODUCT_TABS).extend({ duplicateUpc: z.number().int().optional() }),
});

const idParams = z.object({ id: uuid });

export const getProduct = route({
  id: "products.get",
  method: "GET",
  path: "/v1/products/:id",
  access: { self: true },
  params: idParams,
  response: productRow,
});

/**
 * Scanning on any screen: matches a UPC (1 unit per scan), a case barcode (case pack units per scan) or an extra
 * barcode (catalog-w5: `alternate`, its own units per scan, with its label).
 */
export const productByBarcode = route({
  id: "products.by_barcode",
  method: "GET",
  path: "/v1/products/by-barcode/:code",
  access: { self: true },
  params: z.object({ code: z.string().trim().min(1).max(32) }),
  response: z.object({
    product: productRow,
    matched: z.enum(["upc", "case_barcode", "alternate"]),
    unitsPerScan: z.number().int(),
    label: z.string().nullable().default(null),
  }),
});

const sellQuantity = z.number().int().min(1).max(1_000_000).nullable().optional();

const nonPriceFields = {
  upc: barcode.nullable().optional(),
  name: z.string().trim().min(1, "Enter a name").max(200),
  imageUrl: httpsUrl.nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  casePack: z.number().int().min(1).max(100_000).nullable().optional(),
  caseBarcode: barcode.nullable().optional(),
  /** line-item L3: sold in packs of N units; the fewest and most units on one order (min ≤ max). Null: no rule. */
  sellMultiple: sellQuantity,
  minSellQty: sellQuantity,
  maxSellQty: sellQuantity,
  /** catalog-w5: the category by id, or by code; on create, neither puts the item in the first top-level one. */
  categoryId: uuid.optional(),
  category: categoryCode.optional(),
  /** catalog-w5: the item's whole list of extra barcodes (replaces what is there); leave out to keep them. */
  barcodes: z
    .array(
      extraBarcode.extend({
        units: extraBarcode.shape.units.default(1),
        label: extraBarcode.shape.label.optional(),
      }),
    )
    .max(20)
    .optional(),
  /** "Top: bergamot · Heart: rose · Base: musk". */
  scentNotes: z.string().trim().max(500).nullable().optional(),
  /** "200 ml · Eau de Parfum"; blank reads the size from the name. */
  sizeLabel: z.string().trim().max(100).nullable().optional(),
  caseImageUrl: httpsUrl.nullable().optional(),
  /** Stripe Tax's product tax code for the item; null (or blank) uses the account's default. */
  taxCode: z
    .string()
    .trim()
    .regex(/^(txcd_\d{8})?$/i, "A Stripe tax code is txcd_ and 8 digits")
    .nullable()
    .optional(),
  reorderPoint: z.number().int().min(0).max(1_000_000).optional(),
  reorderQty: z.number().int().min(0).max(1_000_000).optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  preferredVendorId: uuid.nullable().optional(),
};

const priceFields = {
  retailPriceCents: priceCents.nullable().optional(),
  tier1PriceCents: priceCents.nullable().optional(),
  tier2PriceCents: priceCents.nullable().optional(),
  tier3PriceCents: priceCents.nullable().optional(),
  minPriceCents: priceCents.nullable().optional(),
  minMarginBp: marginBp.nullable().optional(),
  msrpCents: priceCents.nullable().optional(),
};

/** New item. A blank SKU gets the next MS-<brand code>-NNNN. Needs products.edit and prices.edit. */
export const createProduct = route({
  id: "products.create",
  method: "POST",
  path: "/v1/products",
  access: { permission: "products.edit" },
  idempotency: "required",
  body: z
    .object({
      sku: sku.nullable().optional(),
      brandId: uuid,
      ...nonPriceFields,
      standardPriceCents: priceCents,
      ...priceFields,
    })
    .strict(),
  response: productRow,
});

/** Non-price fields. Sends the version it loaded (409 stale_version otherwise). */
export const updateProduct = route({
  id: "products.update",
  method: "PATCH",
  path: "/v1/products/:id",
  access: { permission: "products.edit" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version: z.number().int().min(1),
      sku: sku.optional(),
      brandId: uuid.optional(),
      ...nonPriceFields,
      name: nonPriceFields.name.optional(),
      reason: reason.optional(),
    })
    .strict(),
  response: productRow,
});

const priceChangeBody = {
  version: z.number().int().min(1),
  standardPriceCents: priceCents.optional(),
  ...priceFields,
};

/** Change prices directly. Under the floor also needs documents.price.approve_below_minimum (409 below_floor). */
export const changeProductPrices = route({
  id: "products.prices.change",
  method: "PUT",
  path: "/v1/products/:id/prices",
  access: { permission: "prices.edit" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ ...priceChangeBody, reason: reason.optional() }).strict(),
  response: productRow,
});

/** Propose prices: becomes a price_change approval for a Manager (Products board "Propose price change"). */
export const proposeProductPrices = route({
  id: "products.prices.propose",
  method: "POST",
  path: "/v1/products/:id/price-proposals",
  access: { permission: ["prices.propose", "prices.edit"] },
  idempotency: "required",
  params: idParams,
  body: z.object({ ...priceChangeBody, note: z.string().trim().min(1, "Say why").max(2000) }).strict(),
  response: approvalRow,
});

// ── Line item L4: substitutes (D1170–D1199, migration 0340) ─────────────

/** Why an item stands in for another. */
export const SUBSTITUTE_REASONS = [
  "other_size",
  "tester",
  "similar_scent",
  "new_packaging",
  "other",
] as const;
export type SubstituteReason = (typeof SUBSTITUTE_REASONS)[number];

/** One substitute of an item: the other item, why, a note, and whether it lists this item back (two-way). */
export const substituteRow = z.object({
  substitute: z.object({
    id: uuid,
    sku: z.string(),
    name: z.string(),
    status: z.enum(PRODUCT_STATUSES),
    thumbUrl: z.string().nullable(),
  }),
  reason: z.enum(SUBSTITUTE_REASONS),
  note: z.string().nullable(),
  sort: z.number().int(),
  twoWay: z.boolean(),
  /** Available over every active warehouse. */
  available: z.number().int(),
});

const substitutesOut = z.object({ rows: z.array(substituteRow) });

/** At most this many substitutes on one item. */
export const MAX_SUBSTITUTES = 20;

/** The item's substitutes (Inventory › Item), in the order they are offered. */
export const listSubstitutes = route({
  id: "products.substitutes.list",
  method: "GET",
  path: "/v1/products/:id/substitutes",
  access: { self: true },
  params: idParams,
  response: substitutesOut,
});

/** Adds a substitute (at the end); `twoWay` lists this item on the substitute too. */
export const addSubstitute = route({
  id: "products.substitutes.add",
  method: "POST",
  path: "/v1/products/:id/substitutes",
  access: { permission: "products.edit" },
  idempotency: "required",
  params: idParams,
  body: z
    .object({
      substituteId: uuid,
      reason: z.enum(SUBSTITUTE_REASONS).default("other"),
      note: z.string().trim().max(200).nullable().optional(),
      twoWay: z.boolean().optional(),
    })
    .strict(),
  response: substitutesOut,
});

/**
 * P10 (D1982): a CSV paste of substitutes across items, `sku,substitute_sku,reason,note,two_way` (header optional;
 * the first two columns are enough). Rows that read are added through the same rule as "Add substitute" (a pair
 * already listed is skipped, not an error); a row that can't be read is reported by line and nothing is saved.
 */
export const importSubstitutes = route({
  id: "products.substitutes.import",
  method: "POST",
  path: "/v1/products/substitutes/import",
  access: { permission: "products.edit" },
  idempotency: "required",
  body: z.object({ text: z.string().min(1).max(200_000) }).strict(),
  response: z.object({
    added: z.number().int(),
    skipped: z.number().int(),
    rows: z.array(
      z.object({
        line: z.number().int(),
        sku: z.string(),
        substituteSku: z.string(),
        ok: z.boolean(),
        problem: z.string().nullable(),
      }),
    ),
  }),
});

/** Takes a substitute off; `both` also takes this item off the substitute's list. */
export const removeSubstitute = route({
  id: "products.substitutes.remove",
  method: "DELETE",
  path: "/v1/products/:id/substitutes/:substituteId",
  access: { permission: "products.edit" },
  params: z.object({ id: uuid, substituteId: uuid }),
  query: z.object({ both: boolQuery.optional() }),
  response: substitutesOut,
});
