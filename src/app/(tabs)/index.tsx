import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { type CatalogItem, ProductCard } from "@/components/ProductCard";
import { Button, Card, Chip, Screen, Section, T } from "@/components/ui";
import { money } from "@/lib/format";
import { colors, radius, space } from "@/theme";

function Shelf({ title, rows, more }: { title: string; rows: CatalogItem[]; more?: () => void }) {
  if (rows.length === 0) return null;
  return (
    <Section
      title={title}
      action={
        more ? (
          <Pressable onPress={more} hitSlop={8}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>See all</Text>
          </Pressable>
        ) : undefined
      }
    >
      <FlatList
        horizontal
        data={rows}
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.md }}
        style={{ marginHorizontal: -space.lg }}
        ListHeaderComponent={<View style={{ width: space.lg - space.md }} />}
        ListFooterComponent={<View style={{ width: space.lg - space.md }} />}
        renderItem={({ item }) => (
          <View style={{ width: 172 }}>
            <ProductCard item={item} />
          </View>
        )}
      />
    </Section>
  );
}

export default function ShopHome() {
  const { me, can } = useSession();
  const shops = can("shop");
  const arrivals = useApi(shop.newArrivals, { query: { limit: 12 } }, { enabled: shops });
  const again = useApi(shop.buyAgain, { query: { limit: 12 } }, { enabled: shops });
  const brands = useApi(shop.brands, undefined, { enabled: shops });
  const rep = useApi(shop.rep);
  const cart = useApi(shop.getCart, undefined, { enabled: shops });

  if (!shops) return <Redirect href="/orders" />;

  const refreshing = arrivals.isRefetching || again.isRefetching;
  const refresh = () => {
    void arrivals.refetch();
    void again.refetch();
    void brands.refetch();
    void cart.refetch();
  };
  const minimum = cart.data?.summary.minimum;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: 4 }}>
        <T variant="muted">{me?.customer.name}</T>
        <T variant="title">Hi {me?.user.name.split(" ")[0] ?? "there"}</T>
      </View>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable style={s.search} onPress={() => router.navigate("/catalog")} accessibilityRole="search">
          <Ionicons name="search" size={18} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 15 }}>Search name, brand, SKU or UPC</Text>
        </Pressable>
        <Pressable style={s.scan} onPress={() => router.push("/scan")} accessibilityLabel="Scan a barcode">
          <Ionicons name="barcode-outline" size={24} color="#fff" />
        </Pressable>
      </View>

      {minimum && cart.data && cart.data.lines.length > 0 ? (
        <Pressable onPress={() => router.navigate("/cart")}>
          <Card style={{ backgroundColor: colors.accentTint, borderColor: colors.accentLine }}>
            <T variant="h3">
              Cart: {cart.data.summary.lines} items · {money(cart.data.summary.itemsCents)}
            </T>
            <T variant="muted">
              {minimum.reached
                ? "Order minimum reached. Ready to send."
                : `Add ${money(minimum.shortCents)} more to reach the ${money(minimum.orderCents)} minimum.`}
            </T>
          </Card>
        </Pressable>
      ) : null}

      <Shelf title="Buy again" rows={again.data?.rows ?? []} />
      <Shelf
        title="New arrivals"
        rows={arrivals.data?.rows ?? []}
        more={() => router.navigate({ pathname: "/catalog", params: { sort: "newest" } })}
      />

      {brands.data && brands.data.rows.length > 0 ? (
        <Section title="Brands">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {brands.data.rows.map((b) => (
              <Chip
                key={b.id}
                label={`${b.name} · ${b.itemCount}`}
                onPress={() => router.navigate({ pathname: "/catalog", params: { brandId: b.id, brandName: b.name } })}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {rep.data && (rep.data.rep || rep.data.email || rep.data.whatsappUrl) ? (
        <Card>
          <T variant="h3">{rep.data.rep ? `Your rep is ${rep.data.rep.name}` : "Questions? We're here."}</T>
          <T variant="muted">Ask about volume pricing, new lines or anything on your order.</T>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {rep.data.whatsappUrl ? (
              <Button
                title="WhatsApp"
                kind="secondary"
                style={{ flex: 1 }}
                icon={<Ionicons name="logo-whatsapp" size={18} color={colors.accentDeep} />}
                onPress={() => Linking.openURL(rep.data.whatsappUrl as string)}
              />
            ) : null}
            {rep.data.email ? (
              <Button
                title="Email"
                kind="secondary"
                style={{ flex: 1 }}
                icon={<Ionicons name="mail-outline" size={18} color={colors.accentDeep} />}
                onPress={() => Linking.openURL(`mailto:${rep.data.email}`)}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      <Pressable onPress={() => WebBrowser.openBrowserAsync("https://wholesale.itsmarsa.com")}>
        <T variant="small" style={{ textAlign: "center" }}>
          Need line sheets, quotes or returns? Open the full portal
        </T>
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
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
