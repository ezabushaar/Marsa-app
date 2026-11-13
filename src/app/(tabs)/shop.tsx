import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { call } from "@/api/client";
import { track } from "@/lib/analytics";
import { useApi } from "@/api/hooks";
import { ProductCard } from "@/components/ProductCard";
import { Chip, Empty, ErrorState, Loading, T } from "@/components/ui";
import { plural } from "@/lib/format";
import { colors, radius, space } from "@/theme";

type Sort = (typeof shop.CATALOG_SORTS)[number];
const SORTS: { value: Sort; label: string }[] = [
  { value: "best_sellers", label: "Best sellers" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "name", label: "A–Z" },
];
const PAGE = 24;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Shop() {
  // `at` changes on every arrival from another screen, so tapping the same brand twice still applies it.
  const params = useLocalSearchParams<{ q?: string; brandId?: string; sort?: Sort; at?: string }>();
  const [text, setText] = useState(params.q ?? "");
  const [brandId, setBrandId] = useState<string | undefined>(params.brandId);
  const [sort, setSort] = useState<Sort | undefined>(params.sort);
  const [inStock, setInStock] = useState(false);
  const [category, setCategory] = useState<string | undefined>();
  const [cats, setCats] = useState<{ code: string; name: string }[]>([]);
  const jumped = useRef<string | null>(null);
  const q = useDebounced(text.trim());

  // Arriving from Home with a brand or a sort picks it, even when the tab was already open.
  useEffect(() => {
    if (params.brandId !== undefined) setBrandId(params.brandId || undefined);
    if (params.sort !== undefined) setSort(params.sort);
    if (params.q !== undefined) setText(params.q);
  }, [params.brandId, params.sort, params.q, params.at]);

  // A new search may jump to its exact match again.
  useEffect(() => {
    jumped.current = null;
  }, [q]);

  const brands = useApi(shop.brands);
  const query = {
    q: q || undefined,
    brandId,
    category,
    sort: sort ?? (q ? "relevance" : "best_sellers"),
    inStock: inStock ? "true" : undefined,
  } as const;

  const list = useInfiniteQuery({
    queryKey: [shop.catalog.id, query],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      call(shop.catalog, { query: { ...query, limit: PAGE, offset: pageParam } }),
    getNextPageParam: (last, all) => {
      const seen = all.reduce((n, p) => n + p.rows.length, 0);
      return seen < last.total ? seen : undefined;
    },
  });

  const first = list.data?.pages[0];

  // One "search" per settled search (not per keystroke), with how many came back.
  const searched = useRef<string | null>(null);
  useEffect(() => {
    if (!q || !first || searched.current === q) return;
    searched.current = q;
    track("search", { q, results: first.total, fuzzy: first.fuzzy, exact: !!first.match });
  }, [q, first]);
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];

  // An exact SKU or barcode match: straight to the item (once per search, so Back returns to the list).
  useEffect(() => {
    if (first?.match && q && jumped.current !== q) {
      jumped.current = q;
      router.push({ pathname: "/product/[id]", params: { id: first.match } });
    }
  }, [first?.match, q]);

  // The top-level categories, kept from the first answer so the row doesn't jump while filtering.
  useEffect(() => {
    const top = (first?.categories ?? []).filter((c) => c.depth === 0 && c.items > 0);
    if (top.length > 1 && cats.length === 0) setCats(top.map((c) => ({ code: c.code, name: c.name })));
  }, [first?.categories, cats.length]);

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Name, brand, SKU or UPC"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 16, color: colors.ink }}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search the catalog"
          />
        </View>
        <Pressable style={s.scan} onPress={() => router.push("/scan")} accessibilityLabel="Scan a barcode">
          <Ionicons name="barcode-outline" size={24} color="#fff" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        <Chip label="In stock" active={inStock} onPress={() => setInStock(!inStock)} />
        {SORTS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            active={(sort ?? (q ? "relevance" : "best_sellers")) === o.value}
            onPress={() => setSort(o.value)}
          />
        ))}
      </ScrollView>
      {cats.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          <Chip label="Everything" active={!category} onPress={() => setCategory(undefined)} />
          {cats.map((c) => (
            <Chip key={c.code} label={c.name} active={category === c.code} onPress={() => setCategory(c.code)} />
          ))}
        </ScrollView>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        <Chip label="All brands" active={!brandId} onPress={() => setBrandId(undefined)} />
        {brands.data?.rows.map((b) => (
          <Chip key={b.id} label={b.name} active={brandId === b.id} onPress={() => setBrandId(b.id)} />
        ))}
      </ScrollView>
      {first ? (
        <T variant="small">
          {first.didYouMean ? `Showing results for "${first.didYouMean}" · ` : ""}
          {first.fuzzy ? "Closest matches · " : ""}
          {plural(first.total, "item")}
        </T>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      columnWrapperStyle={{ gap: space.md }}
      numColumns={2}
      data={rows}
      keyExtractor={(i) => i.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      renderItem={({ item }) => <ProductCard item={item} />}
      onEndReachedThreshold={0.6}
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
          <Empty title="Nothing matches" body="Try another word, or clear the filters." />
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
    />
  );
}

const s = StyleSheet.create({
  searchRow: { flexDirection: "row", gap: space.sm },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 48,
  },
  scan: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
