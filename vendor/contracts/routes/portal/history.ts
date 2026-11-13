import { z } from "zod";
import { type RouteContract, day, limitQuery, offsetQuery, page, route, uuid } from "../../http.js";
import { historyOrderRow, historyOrderView } from "../history.js";
import { reorder, reorderPreview } from "./shop.js";

/**
 * The portal's "Earlier orders" (WOrders; phase-6-design.md §2.5, §9): the partner's own orders from before
 * cut-over with their website number, read through `PortalScope` like every other portal read.
 *
 * Filled by slice 5 `p6-history`. Slice 1 lands the file and its empty route map so the slice that fills it never
 * touches `index.ts`: every contract added here goes into `ROUTES`, which `CONTRACTS` spreads in (and the API's
 * route-table test then expects it served). Portal routes declare portal access (design phase 5 §3.1).
 *
 * - `GET /v1/portal/history/orders`, `GET /v1/portal/history/orders/:id` — portal `shop`
 */

/**
 * An earlier order as the partner sees it: no staff link, no customer block. The old invoice number and the
 * payments come only with pay (a Buyer sees lines and totals, never invoices or payments).
 */
const STAFF_ONLY = {
  customer: true,
  wooUrl: true,
  billingName: true,
  billingEmail: true,
  alsoInControl: true,
} as const;
export const portalHistoryOrderRow = historyOrderRow.omit(STAFF_ONLY);
export const portalHistoryOrderView = historyOrderView.omit(STAFF_ONLY);

export const listPortalHistoryOrders = route({
  id: "portal.history.orders.list",
  method: "GET",
  path: "/v1/portal/history/orders",
  access: { portal: "shop" },
  query: z.object({
    /** The website number ("1004133" or "#1004133"). */
    q: z.string().trim().max(100).optional(),
    from: day.optional(),
    to: day.optional(),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(portalHistoryOrderRow),
});

export const getPortalHistoryOrder = route({
  id: "portal.history.orders.get",
  method: "GET",
  path: "/v1/portal/history/orders/:id",
  access: { portal: "shop" },
  params: z.object({ id: uuid }),
  response: portalHistoryOrderView,
});

/**
 * UX audit ORD-5 (D1646): an earlier order reordered like one placed here — its lines matched to current items by
 * product, else by SKU; the sheet lists what matched nothing (`unmatched`). Same sheet and same add as
 * `portal.orders.reorder`.
 */
export const legacyReorderPreview = route({
  ...reorderPreview,
  id: "portal.history.orders.reorder_sheet",
  path: "/v1/portal/history/orders/:id/reorder",
});

export const legacyReorder = route({
  ...reorder,
  id: "portal.history.orders.reorder",
  path: "/v1/portal/history/orders/:id/reorder",
});

export const ROUTES = {
  listPortalHistoryOrders,
  getPortalHistoryOrder,
  legacyReorderPreview,
  legacyReorder,
} satisfies Record<string, RouteContract>;
