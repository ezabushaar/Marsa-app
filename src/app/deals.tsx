import { router } from "expo-router";
import { FlatList, View } from "react-native";
import * as priceLists from "@contracts/routes/priceLists";
import { useApi } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { ProductCard } from "@/components/ProductCard";
import { Banner, Button, ErrorState, T } from "@/components/ui";
import { day } from "@/lib/format";
import { colors, space } from "@/theme";

/** Clearance: items at a price under the store's own, while they last (with a per-store limit when set). */
export default function Deals() {
  const q = useApi(priceLists.portalClearance);
  const rows = q.data?.rows ?? [];
  const soonest = rows.map((r) => r.endsOn).filter((d): d is string => !!d).sort()[0];
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
          <View style={{ gap: space.sm, paddingBottom: space.sm }}>
            <Banner tone="info">
              {`Clearance prices while stock lasts${soonest ? `; some end ${day(soonest, false)}` : ""}. Limits per store apply where shown.`}
            </Banner>
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <View style={{ flex: 1, gap: 4 }}>
          <ProductCard
            item={item}
            deal={{ priceCents: item.clearancePriceCents, discountBp: item.discountBp, limitPerStore: item.limitPerStore }}
          />
          {item.limitPerStore ? <T variant="small">Limit {item.limitPerStore} per store</T> : null}
        </View>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState
            icon="pricetags-outline"
            title="No clearance right now"
            body="Deals show up here first. Check back soon."
            action={<Button title="Browse the catalog" kind="secondary" onPress={() => router.navigate("/shop")} />}
          />
        )
      }
    />
  );
}
