import { randomUUID } from "expo-crypto";
import {
  type ApiClient,
  ApiError,
  type CallInput,
  createHttpClient,
  isRetryable,
} from "@contracts/client";
import type { ResponseOf, RouteContract } from "@contracts/http";
import { API_URL, PORTAL_ORIGIN } from "@/config";

export { ApiError, isRetryable, type ApiClient, type CallInput };

export const NETWORK_MESSAGE = "Can't reach Marsa right now. Check your connection and try again.";

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();

/** Called when the API says the session is gone (401), so the app goes back to Sign in. */
export function onUnauthenticated(fn: Listener): () => void {
  unauthenticatedListeners.add(fn);
  return () => unauthenticatedListeners.delete(fn);
}

/**
 * The one typed client from Marsa ERP's contracts, pointed at the portal API. The native networking layer keeps
 * the `marsa_portal` cookie (iOS NSHTTPCookieStorage, Android's cookie jar), so sessions survive restarts when the
 * person chose "Keep me signed in". Every request carries the portal's Origin so cookie-signed writes pass the
 * API's origin rule.
 */
const inner = createHttpClient({
  baseUrl: API_URL,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), origin: PORTAL_ORIGIN },
    }),
  onUnauthenticated: () => {
    for (const fn of unauthenticatedListeners) fn();
  },
});

export const api: ApiClient = {
  async call(contract, input) {
    try {
      return await inner.call(contract, input);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) throw new ApiError(0, "network", NETWORK_MESSAGE);
      throw e;
    }
  },
};

/** Calls a route; shorthand for components. */
export function call<C extends RouteContract>(contract: C, input?: CallInput<C>): Promise<ResponseOf<C>> {
  return api.call(contract, input);
}

/** A fresh Idempotency-Key: one per user action, reused only when retrying that action. */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/** The plain-words message of any refusal. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}
