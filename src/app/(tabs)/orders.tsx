import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { call } from "@/api/client";
import { Chip, Empty, ErrorState, Loading, Pill, T, styles } from "@/components/ui";
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

export default function Orders() {
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
      }
      renderItem={({ item: o }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })}
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
          <Loading />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Empty title="No orders here yet" />
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
    />
  );
}
