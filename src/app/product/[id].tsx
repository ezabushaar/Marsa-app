import { Stack, useLocalSearchParams } from "expo-router";
import { FlatList, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { AddToCart, type CatalogItem, ProductCard, stockTone } from "@/components/ProductCard";
import { ProductImage } from "@/components/ProductImage";
import { Card, ErrorState, Loading, Pill, Row, Screen, Section, T } from "@/components/ui";
import { day, money, percentBp } from "@/lib/format";
import { space } from "@/theme";

export default function Product() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.catalogItemRoute, { params: { productId: id } });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const rules = shop.qtyRules(p);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: p.brand.name }} />
      <ProductImage url={p.photos[0]?.url ?? p.imageUrl} name={p.name} style={{ borderRadius: 20 }} />

      <View style={{ gap: space.xs }}>
        <T variant="small">{p.brand.name.toUpperCase()}</T>
        <T variant="title">{p.name}</T>
        <T variant="small">
          SKU {p.sku}
          {p.upc ? ` · UPC ${p.upc}` : ""}
          {p.size ? ` · ${p.size}` : ""}
        </T>
      </View>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" }}>
          <T style={{ fontSize: 28, fontWeight: "700" }}>{money(p.priceCents)}</T>
          <T variant="muted">your price</T>
          {p.marginAtMsrpBp != null ? <Pill tone="pos" label={`You keep ${percentBp(p.marginAtMsrpBp)} at MSRP`} /> : null}
        </View>
        {p.contract ? (
          <T variant="muted">
            Contract price {money(p.contract.unitPriceCents)} from {p.contract.minQty} units
            {p.contract.endsOn ? ` · to ${day(p.contract.endsOn)}` : ""}
          </T>
        ) : null}
        {p.msrpCents ? <Row label="MSRP" value={money(p.msrpCents)} /> : null}
        <Row label="Stock" value={<T style={{ color: stockTone(p.stock), fontWeight: "600" }}>{p.stockLabel}</T>} />
        <Row label="Minimum" value={`${rules.min} units`} />
        {rules.step > 1 ? <Row label="Sold in packs of" value={String(rules.step)} /> : null}
        {p.casePack ? <Row label="Case pack" value={String(p.casePack)} /> : null}
        {rules.max != null ? <Row label="Most per order" value={String(rules.max)} /> : null}
        {p.lastOrdered ? (
          <Row
            label="Last ordered"
            value={`${p.lastOrdered.quantity} on ${day(p.lastOrdered.date, false)} (${p.lastOrdered.orderNumber})`}
          />
        ) : null}
        <AddToCart item={p} wide />
      </Card>

      {p.notes ? (
        <Section title="About this fragrance">
          <Card>
            <T>{p.notes}</T>
            {p.categoryName ? <T variant="small">{p.categoryName}</T> : null}
          </Card>
        </Section>
      ) : null}

      {p.sellsWellWith.length > 0 ? <Shelf title="Sells well with" rows={p.sellsWellWith} /> : null}
      {p.moreFromBrand.length > 0 ? <Shelf title={`More from ${p.brand.name}`} rows={p.moreFromBrand} /> : null}
    </Screen>
  );
}

function Shelf({ title, rows }: { title: string; rows: CatalogItem[] }) {
  return (
    <Section title={title}>
      <FlatList
        horizontal
        data={rows}
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.md }}
        renderItem={({ item }) => (
          <View style={{ width: 172 }}>
            <ProductCard item={item} />
          </View>
        )}
      />
    </Section>
  );
}
