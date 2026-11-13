import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { ProductImage } from "@/components/ProductImage";
import { Banner, Button, Card, ErrorState, Loading, Pill, Row, Screen, T } from "@/components/ui";
import { PORTAL_URL } from "@/config";
import { track } from "@/lib/analytics";
import { space } from "@/theme";

/** One item for a visitor: no price ("Price after approval"), the scent notes and the case pack. */
export default function PublicProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.publicProduct, { params: { productId: id } });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: p.brand.name }} />
      <ProductImage url={p.imageUrl} name={p.name} style={{ borderRadius: 20 }} />
      <View style={{ gap: space.xs }}>
        <T variant="small">{p.brand.name.toUpperCase()}</T>
        <T variant="title">{p.name}</T>
        <T variant="small">
          SKU {p.sku}
          {p.sizeLabel ? ` · ${p.sizeLabel}` : ""}
        </T>
      </View>
      <Card>
        <Pill tone={p.stock === "in_stock" ? "pos" : "warn"} label={p.stock === "in_stock" ? "In stock" : "Restocking"} />
        {p.casePack ? <Row label="Case pack" value={`${p.casePack} units`} /> : null}
        {p.upc ? <Row label="UPC" value={p.upc} /> : null}
        {p.scentNotes ? <T>{p.scentNotes}</T> : null}
      </Card>
      <Banner tone="info">Wholesale price shows after your store is approved.</Banner>
      <Button title="Sign in to order" onPress={() => router.push("/sign-in")} />
      <Button
        title="Apply for a wholesale account"
        kind="secondary"
        onPress={() => {
          track("public_apply_click", { from: "product", product_id: p.id });
          void WebBrowser.openBrowserAsync(`${PORTAL_URL}/apply?utm_source=app&utm_medium=public_product`);
        }}
      />
    </Screen>
  );
}
