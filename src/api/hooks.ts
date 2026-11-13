import { useRef } from "react";
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ResponseOf, RouteContract } from "@contracts/http";
import * as shop from "@contracts/routes/portal/shop";
import * as priceLists from "@contracts/routes/priceLists";
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
 * A write route as a mutation. Each call gets its own Idempotency-Key; only a retry of the SAME request after an
 * unknown outcome (network error or 5xx) reuses it, so a double send never places two orders while two different
 * quick taps (6 → 12 → 18) are two requests.
 */
export function useApiMutation<C extends RouteContract>(
  contract: C,
  opts?: { onSuccess?: (data: ResponseOf<C>) => void; invalidates?: RouteContract[] },
) {
  const qc = useQueryClient();
  /** The key of a request whose outcome is unknown, kept only for an identical retry. */
  const unsure = useRef<{ sig: string; key: string } | null>(null);
  return useMutation<ResponseOf<C>, unknown, Omit<CallInput<C>, "idempotencyKey">>({
    mutationFn: async (input) => {
      const sig = JSON.stringify(input ?? null);
      const key = unsure.current?.sig === sig ? unsure.current.key : newIdempotencyKey();
      try {
        const out = await call(contract, { ...input, idempotencyKey: key } as CallInput<C>);
        if (unsure.current?.key === key) unsure.current = null;
        return out;
      } catch (e) {
        if (isRetryable(e)) unsure.current = { sig, key };
        else if (unsure.current?.key === key) unsure.current = null;
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
  shop.listFollows,
  shop.getList,
  priceLists.portalClearance,
];
