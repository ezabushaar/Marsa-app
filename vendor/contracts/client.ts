import type { z } from "zod";
import type { ErrorBody, ResponseOf, RouteContract } from "./http.js";

/**
 * The one typed client. Every call names its contract, so the path, the method, what is sent and what comes
 * back are the server's own definitions and can't drift. The Control app wraps it in React context; the
 * API's contract test drives the same client over `app.inject`.
 */

export interface CallInput<C extends RouteContract> {
  params?: z.input<C["params"]>;
  query?: Partial<z.input<C["query"]>>;
  body?: z.input<C["body"]>;
  /** Sent as the Idempotency-Key header: one per user action, reused when that action is retried. */
  idempotencyKey?: string;
  /** Extra request headers (the site kiosk's device token, T5). */
  headers?: Record<string, string>;
}

/** A refusal from the server: its status, stable code and the plain-language message to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  call<C extends RouteContract>(contract: C, input?: CallInput<C>): Promise<ResponseOf<C>>;
}

export function buildPath(path: string, params: Record<string, unknown> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) throw new Error(`Missing path parameter "${name}"`);
    return encodeURIComponent(String(value));
  });
}

export function buildQuery(query: Record<string, unknown> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface HttpClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The session is gone (401 unauthenticated): send the person to Sign in. */
  onUnauthenticated?: () => void;
  /** A permission was refused (403): the person's permissions may have changed, so reload /v1/me. */
  onForbidden?: () => void;
}

export function createHttpClient(opts: HttpClientOptions = {}): ApiClient {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return {
    async call(contract, input = {}) {
      const url =
        (opts.baseUrl ?? "") +
        buildPath(contract.path, input.params as Record<string, unknown>) +
        buildQuery(input.query as Record<string, unknown>);
      const headers: Record<string, string> = { accept: "application/json" };
      const hasBody = contract.method !== "GET" && input.body !== undefined;
      // A raw-body route (an upload) sends the file as it is, with its own type; everything else is JSON.
      const raw =
        hasBody &&
        contract.rawBody === true &&
        typeof Blob !== "undefined" &&
        (input.body as unknown) instanceof Blob;
      if (hasBody)
        headers["content-type"] = raw
          ? (input.body as unknown as Blob).type || "application/octet-stream"
          : "application/json";
      if (input.idempotencyKey) headers["idempotency-key"] = input.idempotencyKey;
      for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: contract.method,
          headers,
          credentials: "include",
          body: raw ? (input.body as unknown as Blob) : hasBody ? JSON.stringify(input.body) : undefined,
        });
      } catch {
        throw new ApiError(0, "network", "Can't reach Marsa Control. Check the connection and try again.");
      }
      if (res.status === 204) return undefined as never;
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const err = (json ?? {}) as Partial<ErrorBody>;
        const error = new ApiError(
          res.status,
          err.code ?? "http_error",
          err.message ?? `Something went wrong (${res.status})`,
          err.details,
        );
        if (res.status === 401 && error.code === "unauthenticated") opts.onUnauthenticated?.();
        if (res.status === 403) opts.onForbidden?.();
        throw error;
      }
      return json as never;
    },
  };
}

/** True when a retry with the same Idempotency-Key is the right thing (the outcome is unknown). */
export function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
}
