import { useRef } from "react";
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ResponseOf, RouteContract } from "@contracts/http";
import * as shop from "@contracts/routes/portal/shop";
import { type CallInput, call, isRetryable, newIdempotencyKey } from "./client";

/** The query key of a route and its input: the route id first, so one route's queries can be invalidated together. */
export function keyOf<C extends RouteContract>(contract: C, input?: CallInput<C>) {
  return [contract.id, input?.params ?? null, input?.query ?? null] as const;
}

/** A GET route as a query. */
export function useApi<C extends RouteContract>(
  contract: C,
  input?: CallInput<C>,
  opts?: Omit<UseQueryOptions<ResponseOf<C>>, "queryKey" | "queryFn">,
) {
  return useQuery<ResponseOf<C>>({
    queryKey: keyOf(contract, input),
    queryFn: () => call(contract, input),
    ...opts,
  });
}

/**
 * A write route as a mutation. Each press gets its own Idempotency-Key; a retry after an unknown outcome (network
 * error or 5xx) reuses it, so a double send never places two orders.
 */
export function useApiMutation<C extends RouteContract>(
  contract: C,
  opts?: { onSuccess?: (data: ResponseOf<C>) => void; invalidates?: RouteContract[] },
) {
  const qc = useQueryClient();
  const pendingKey = useRef<string | null>(null);
  return useMutation<ResponseOf<C>, unknown, Omit<CallInput<C>, "idempotencyKey">>({
    mutationFn: async (input) => {
      pendingKey.current ??= newIdempotencyKey();
      try {
        const out = await call(contract, { ...input, idempotencyKey: pendingKey.current } as CallInput<C>);
        pendingKey.current = null;
        return out;
      } catch (e) {
        if (!isRetryable(e)) pendingKey.current = null;
        throw e;
      }
    },
    onSuccess: (data) => {
      for (const c of opts?.invalidates ?? []) void qc.invalidateQueries({ queryKey: [c.id] });
      opts?.onSuccess?.(data);
    },
  });
}

/** Routes whose answers change when the cart changes. */
export const CART_DEPENDENTS: RouteContract[] = [
  shop.getCart,
  shop.catalog,
  shop.catalogItemRoute,
  shop.newArrivals,
  shop.buyAgain,
  shop.usualOrder,
];
