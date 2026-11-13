import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as auth from "@contracts/routes/portal/auth";
import type { ResponseOf } from "@contracts/http";
import type { PortalCapability } from "@contracts/portal";
import { ApiError, call, onUnauthenticated } from "./client";

export type PortalMe = ResponseOf<typeof auth.me>;

interface Session {
  /** Undefined while the first check runs (or it couldn't reach Marsa); null when signed out. */
  me: PortalMe | null | undefined;
  loading: boolean;
  /** The session check couldn't reach Marsa (no connection, server down): neither signed in nor out yet. */
  unreachable: unknown;
  recheck: () => void;
  can: (cap: PortalCapability) => boolean;
  signIn: (email: string, password: string, keepSignedIn: boolean) => Promise<PortalMe>;
  signOut: () => Promise<void>;
  /** After a sign-in route that answers the person (set password, reset). */
  adopt: (me: PortalMe) => void;
}

const SessionContext = createContext<Session | null>(null);
export const ME_KEY = ["portal.me"] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await call(auth.me);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    // A network error (status 0) or a 5xx may pass; a 4xx won't.
    retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 3,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 5000),
  });

  const clear = useCallback(() => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
    qc.setQueryData(ME_KEY, null);
  }, [qc]);

  useEffect(() => onUnauthenticated(clear), [clear]);

  const adopt = useCallback((me: PortalMe) => qc.setQueryData(ME_KEY, me), [qc]);

  const signIn = useCallback(
    async (email: string, password: string, keepSignedIn: boolean) => {
      const me = await call(auth.login, { body: { email: email.trim(), password, keepSignedIn } });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      adopt(me);
      return me;
    },
    [qc, adopt],
  );

  const signOut = useCallback(async () => {
    try {
      await call(auth.logout);
    } finally {
      clear();
    }
  }, [clear]);

  const me = meQuery.data;
  const value = useMemo<Session>(
    () => ({
      me: meQuery.isPending || (meQuery.isError && me === undefined) ? undefined : (me ?? null),
      loading: meQuery.isPending,
      unreachable: meQuery.isError && me === undefined ? meQuery.error : null,
      recheck: () => void meQuery.refetch(),
      can: (cap) => !!me?.caps.includes(cap),
      signIn,
      signOut,
      adopt,
    }),
    [me, meQuery.isPending, meQuery.isError, meQuery.error, meQuery.refetch, signIn, signOut, adopt],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
