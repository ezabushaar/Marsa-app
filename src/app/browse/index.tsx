import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { call } from "@/api/client";
import { useApi } from "@/api/hooks";
import { EmptyState, Skeleton } from "@/components/kit";
import { ProductImage } from "@/components/ProductImage";
import { Banner, Button, Chip, ErrorState } from "@/components/ui";
import { colors, radius, space } from "@/theme";

const PAGE = 24;

/** The public catalog: every item the portal sells, no prices, "In stock" or "Restocking". */
export default function Browse() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [brandId, setBrandId] = useState<string | undefined>();
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const landing = useApi(shop.publicLanding);
  const open = landing.data?.catalogOpen ?? true;
  const brands = useApi(shop.publicBrands, undefined, { enabled: open });
  const list = useInfiniteQuery({
    queryKey: [shop.publicCatalog.id, q, brandId, open],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      call(shop.publicCatalog, {
        query: open ? { q: q || undefined, brandId, limit: PAGE, offset: pageParam } : { limit: PAGE },
      }),
    getNextPageParam: (last, all) => {
      if (!open) return undefined;
      const seen = all.reduce((n, p) => n + p.rows.length, 0);
      return seen < last.total ? seen : undefined;
    },
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      columnWrapperStyle={{ gap: space.md }}
      numColumns={2}
      data={rows}
      keyExtractor={(i) => i.id}
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        <View style={{ gap: space.md, paddingBottom: space.sm }}>
          <Banner tone="info">Prices and ordering open once your store is approved for wholesale.</Banner>
          {open ? (
            <>
              <View style={s.search}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Search fragrances or brands"
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, fontSize: 16, color: colors.ink }}
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search the catalog"
                />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                <Chip label="All brands" active={!brandId} onPress={() => setBrandId(undefined)} />
                {brands.data?.rows.map((b) => (
                  <Chip key={b.id} label={b.name} active={brandId === b.id} onPress={() => setBrandId(b.id)} />
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={s.card}
          disabled={!open}
          onPress={() => router.push({ pathname: "/browse/[id]", params: { id: item.id } })}
          accessibilityLabel={`${item.brand.name} ${item.name}`}
        >
          <ProductImage url={item.imageUrl} name={item.name} />
          <Text style={s.brand} numberOfLines={1}>
            {item.brand.name}
          </Text>
          <Text style={s.name} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={[s.stock, { color: item.stock === "in_stock" ? colors.pos : colors.warn }]}>
            {item.stock === "in_stock" ? "In stock" : "Restocking"}
          </Text>
        </Pressable>
      )}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      ListEmptyComponent={
        list.isPending ? (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Skeleton style={{ flex: 1, height: 220 }} />
            <Skeleton style={{ flex: 1, height: 220 }} />
          </View>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <EmptyState icon="search" title="Nothing matches" body="Try another word or brand." />
        )
      }
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <ActivityIndicator color={colors.accent} />
        ) : !open && rows.length > 0 ? (
          <View style={{ paddingTop: space.lg }}>
            <Button title="Sign in to see the full catalog" onPress={() => router.push("/sign-in")} />
          </View>
        ) : undefined
      }
    />
  );
}

const s = StyleSheet.create({
  search: {
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
  card: {
    flex: 1,
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  brand: { fontSize: 11, color: colors.muted, fontWeight: "700", letterSpacing: 0.4, marginTop: 4 },
  name: { fontSize: 14, color: colors.ink, fontWeight: "600", minHeight: 36 },
  stock: { fontSize: 12, fontWeight: "600" },
});
