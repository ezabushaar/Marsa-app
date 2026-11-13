import { z } from "zod";
import type { Permission } from "./permissions.js";
import type { PortalAccess } from "./portal.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Who may call a route. `public`: anyone (sign-in, signed webhooks). `self`: any signed-in person, for their
 * own data or data every role may read. `permission`: one permission, or any of several when the exact one
 * depends on the record (the service then checks precisely). `portal` (phase 5): a signed-in portal user
 * holding that capability (`any`: every portal user); only `/v1/portal/` routes declare it, and they declare
 * it or `public`, nothing else (design §3.1).
 */
export type Access =
  | { readonly public: true }
  | { readonly self: true }
  | { readonly permission: Permission | readonly Permission[] }
  | { readonly portal: PortalAccess }
  /**
   * Phase 7: a signed-in supplier portal user (a vendor's person). Only `/v1/supplier/` routes declare it, and
   * they declare it or `public`; the vendor comes only from the `marsa_supplier` session.
   */
  | { readonly supplier: true }
  /**
   * The creator portal: a signed-in creator. Only `/v1/creator/` routes declare it, and they declare it or `public`;
   * the creator comes only from the `marsa_creator` session.
   */
  | { readonly creator: true }
  /**
   * Marsa Time T5: an enrolled site kiosk (a tablet paired by a manager), by its device token in the
   * `x-kiosk-token` header. Only `/v1/kiosk/` routes declare it, and they declare it or `public`; the token is
   * scoped to punching at its site and is read nowhere else.
   */
  | { readonly kiosk: true };

/** Every portal route lives under this prefix; nothing else does. */
export const PORTAL_PATH_PREFIX = "/v1/portal/";

/** Phase 7: every supplier portal route lives under this prefix; nothing else does. */
export const SUPPLIER_PATH_PREFIX = "/v1/supplier/";

/** The creator portal: every creator portal route lives under this prefix; nothing else does. */
export const CREATOR_PATH_PREFIX = "/v1/creator/";

/** Marsa Time T5: every site kiosk route lives under this prefix; nothing else does. */
export const KIOSK_PATH_PREFIX = "/v1/kiosk/";
/**
 * D1606: the Control app names the surface a request comes from; the floor (`/h`) sends `handheld`, and the API
 * refuses it (403 `handheld_off`) for a person whose handheld access is off. No route is handheld-only, so this is
 * the API's only hold on the device: an honest client is stopped on the server, a dishonest one has the same
 * permissions at the desk anyway.
 */
export const SURFACE_HEADER = "x-marsa-surface";
export const SURFACE_HANDHELD = "handheld";

export interface RouteContract<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Stable name, also the idempotency scope, e.g. "settings.update". */
  readonly id: string;
  readonly method: HttpMethod;
  /** Fastify-style path, e.g. "/v1/settings/:key". */
  readonly path: string;
  readonly access: Access;
  /** "required" for creates; "optional" for other writes (a replay returns the first result). */
  readonly idempotency?: "required" | "optional";
  /**
   * Top-level body fields that are secrets (bank numbers). The idempotency fingerprint stores them only as a
   * keyed HMAC, never as a plain hash a database reader could brute-force.
   */
  readonly secretFields?: readonly string[];
  readonly params: P;
  readonly query: Q;
  readonly body: B;
  readonly response: R;
  /** The handler reads the raw request body itself (signed webhooks); `body` is not parsed. */
  readonly rawBody?: boolean;
  /** Answer with no body (204). */
  readonly noContent?: boolean;
  /** Success status when it isn't 200 (e.g. 202 for a request that is always accepted). */
  readonly status?: number;
}

const none = z.object({}).strict();
const anyQuery = z.object({}).passthrough();

/** Fills in empty schemas so every contract has params, query, body and response. */
export function route<
  P extends z.ZodTypeAny = typeof none,
  Q extends z.ZodTypeAny = typeof anyQuery,
  B extends z.ZodTypeAny = z.ZodUnknown,
  R extends z.ZodTypeAny = z.ZodUnknown,
>(c: {
  id: string;
  method: HttpMethod;
  path: string;
  access: Access;
  idempotency?: "required" | "optional";
  secretFields?: readonly string[];
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  rawBody?: boolean;
  noContent?: boolean;
  status?: number;
}): RouteContract<P, Q, B, R> {
  return {
    ...c,
    params: (c.params ?? none) as P,
    query: (c.query ?? anyQuery) as Q,
    body: (c.body ?? z.unknown()) as B,
    response: (c.response ?? z.unknown()) as R,
  };
}

export type ParamsOf<C extends RouteContract> = z.output<C["params"]>;
export type QueryOf<C extends RouteContract> = z.output<C["query"]>;
export type BodyOf<C extends RouteContract> = z.output<C["body"]>;
export type BodyInputOf<C extends RouteContract> = z.input<C["body"]>;
export type ResponseOf<C extends RouteContract> = z.output<C["response"]>;
export type ResponseInputOf<C extends RouteContract> = z.input<C["response"]>;

/** Body of every refusal: a stable code and a plain-language message to show next to the button. */
export const errorBody = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof errorBody>;

// ── Shared field schemas ────────────────────────────────────────────────
export const uuid = z.string().uuid();
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");
/** A sum of cents, returned as a string because it may exceed the safe integer range. */
export const centsString = z.string().regex(/^-?\d+$/);
export const isoTime = z.string();
export const userRef = z.object({ id: uuid, name: z.string() });

export const limitQuery = z.coerce.number().int().min(1).max(200).default(50);
export const offsetQuery = z.coerce.number().int().min(0).default(0);
export const boolQuery = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();

/**
 * A list column's own search (W2 column-header filters, D282): the text a person typed in the column's header,
 * matched anywhere in that column only.
 */
export const columnSearch = z.string().trim().max(100).optional();

/**
 * A list column's value filter (W2, D282): one or more of the column's values, comma-separated in the link
 * ("draft,sent"); the server gets the list.
 */
export function csvEnum<const V extends readonly [string, ...string[]]>(values: V) {
  return z
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
    .pipe(z.array(z.enum(values)).min(1))
    .optional();
}

export function page<T extends z.ZodTypeAny>(row: T) {
  return z.object({ rows: z.array(row), total: z.number().int() });
}

/**
 * A page with the board's tab counts: how many rows each tab would list with the other filters applied (one
 * query on the server). Optional so a reader that ignores the tabs needn't send them.
 */
export function countedPage<T extends z.ZodTypeAny, const V extends readonly [string, ...string[]]>(
  row: T,
  tabs: V,
) {
  return page(row).extend({ counts: z.record(z.enum(tabs), z.number().int()).optional() });
}
