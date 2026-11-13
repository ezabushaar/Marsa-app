import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { call } from "@/api/client";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { CardSkeletons, EmptyState, Segmented } from "@/components/kit";
import { Button, Chip, ErrorState, Pill, T, styles } from "@/components/ui";
import { day, money, plural } from "@/lib/format";
import { stageTone } from "@/lib/orders";
import { colors, space } from "@/theme";

type Tab = (typeof shop.PORTAL_ORDER_TABS)[number];
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "to_pay", label: "To pay" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
];

function OrdersList({ header }: { header: React.ReactElement }) {
  const [tab, setTab] = useState<Tab>("all");
  const list = useInfiniteQuery({
    queryKey: [shop.listOrders.id, tab],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => call(shop.listOrders, { query: { tab, limit: 25, offset: pageParam } }),
    getNextPageParam: (last, all) => {
      const seen = all.reduce((n, p) => n + p.rows.length, 0);
      return seen < last.total ? seen : undefined;
    },
  });
  const counts = list.data?.pages[0]?.counts;
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={rows}
      keyExtractor={(o) => o.id}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {header}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {TABS.map((t) => (
              <Chip
                key={t.value}
                label={counts ? `${t.label} ${counts[t.value]}` : t.label}
                active={tab === t.value}
                onPress={() => setTab(t.value)}
              />
            ))}
          </ScrollView>
        </View>
      }
      renderItem={({ item: o }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })}
          accessibilityRole="button"
          accessibilityLabel={`Order ${o.number}, ${o.stageLabel}, ${money(o.totalCents)}`}
        >
          <View style={styles.row}>
            <T variant="h3" style={{ flex: 1 }}>
              {o.number}
            </T>
            <Pill label={o.stageLabel} tone={stageTone(o.stage)} />
          </View>
          <View style={styles.row}>
            <T variant="muted" style={{ flex: 1 }}>
              {day(o.placedOn)} · {plural(o.units, "unit")}
            </T>
            <T variant="h3">{money(o.totalCents)}</T>
          </View>
          <T variant="small">
            {o.shipping.label}
            {o.payment ? ` · ${o.payment.label}` : ""}
          </T>
        </Pressable>
      )}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      refreshing={list.isRefetching && !list.isFetchingNextPage}
      onRefresh={() => void list.refetch()}
      ListEmptyComponent={
        list.isPending ? (
          <CardSkeletons />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <EmptyState
            icon="receipt-outline"
            title={tab === "all" ? "No orders yet" : "Nothing here right now"}
            body={tab === "all" ? "Your orders show here as soon as you send one." : undefined}
            action={tab === "all" ? <Button title="Start shopping" onPress={() => router.navigate("/shop")} /> : undefined}
          />
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
    />
  );
}

function QuotesList({ header }: { header: React.ReactElement }) {
  const q = useApi(shop.listQuotes);
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={q.data?.rows ?? []}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={header}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      renderItem={({ item: r }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: "/quote/[id]", params: { id: r.id } })}
          accessibilityRole="button"
        >
          <View style={styles.row}>
            <T variant="h3" style={{ flex: 1 }}>
              {r.number}
            </T>
            <Pill
              label={r.statusLabel}
              tone={r.status === "waiting_for_you" ? "warn" : r.status === "accepted" ? "pos" : "neutral"}
            />
          </View>
          <View style={styles.row}>
            <T variant="muted" style={{ flex: 1 }}>
              {r.from ? `From ${r.from} · ` : ""}valid to {day(r.validUntil, false)}
            </T>
            <T variant="h3">{money(r.totalCents)}</T>
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons count={2} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState
            icon="document-text-outline"
            title="No quotes"
            body="Ordering in volume? Ask for a quote from any product page and it lands here."
          />
        )
      }
    />
  );
}

export default function Orders() {
  const { can } = useSession();
  const [view, setView] = useState<"orders" | "quotes">("orders");
  const header = can("shop") ? (
    <Segmented
      value={view}
      onChange={setView}
      options={[
        { value: "orders", label: "Orders" },
        { value: "quotes", label: "Quotes" },
      ]}
    />
  ) : (
    <View />
  );
  return view === "orders" ? <OrdersList header={header} /> : <QuotesList header={header} />;
}
