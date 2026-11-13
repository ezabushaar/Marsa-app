import { router } from "expo-router";
import { FlatList, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { ProductCard } from "@/components/ProductCard";
import { Banner, Button, ErrorState } from "@/components/ui";
import { colors, space } from "@/theme";

/** "Tell me when it's back": the items the store follows; the ones back in stock come first. */
export default function Alerts() {
  const q = useApi(shop.listFollows);
  const rows = [...(q.data?.rows ?? [])].sort(
    (a, b) => Number(a.stock === "out_of_stock") - Number(b.stock === "out_of_stock"),
  );
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      columnWrapperStyle={{ gap: space.md }}
      numColumns={2}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      ListHeaderComponent={
        rows.length > 0 ? (
          <View style={{ paddingBottom: space.sm }}>
            <Banner tone="info">We message you when these are back. Tap "Alert on" to stop one.</Banner>
          </View>
        ) : undefined
      }
      renderItem={({ item }) => <ProductCard item={item} />}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState
            icon="notifications-outline"
            title="No restock alerts"
            body={`On any out-of-stock item, tap "Tell me when it's back".`}
            action={<Button title="Browse the catalog" kind="secondary" onPress={() => router.navigate("/shop")} />}
          />
        )
      }
    />
  );
}
