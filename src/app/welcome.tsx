import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { ProductImage } from "@/components/ProductImage";
import { Button, T } from "@/components/ui";
import { LEGAL, PORTAL_URL } from "@/config";
import { money } from "@/lib/format";
import { colors, radius, space } from "@/theme";

const PERKS: { icon: "pricetags-outline" | "barcode-outline" | "cube-outline" | "card-outline"; text: string }[] = [
  { icon: "pricetags-outline", text: "Your wholesale prices and live stock" },
  { icon: "barcode-outline", text: "Scan a shelf barcode to reorder in seconds" },
  { icon: "cube-outline", text: "Track every order and delivery" },
  { icon: "card-outline", text: "See invoices and pay by card or bank" },
];

/** The first screen for someone not signed in: what the app is, a look at the catalog, sign in or apply. */
export default function Welcome() {
  const top = useApi(shop.publicTopSellers, { query: { limit: 8 } });
  const minimum = useApi(shop.publicMinimum);
  const landing = useApi(shop.publicLanding);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        <SafeAreaView edges={["top"]} style={s.hero}>
          <Text style={s.eyebrow}>MARSA WHOLESALE</Text>
          <Text style={s.title}>Fragrance your customers ask for, restocked in minutes.</Text>
          <Text style={s.lead}>
            The ordering app for stores that buy from Marsa: perfumes, colognes and gift sets at wholesale.
          </Text>
          <View style={{ gap: space.sm, marginTop: space.lg }}>
            {PERKS.map((p) => (
              <View key={p.text} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
                <Ionicons name={p.icon} size={20} color={colors.panelMint} />
                <Text style={{ color: colors.panelInk, fontSize: 15 }}>{p.text}</Text>
              </View>
            ))}
          </View>
        </SafeAreaView>

        <View style={{ padding: space.lg, gap: space.md, marginTop: -space.xl }}>
          <View style={s.card}>
            <Button title="Sign in" onPress={() => router.push("/sign-in")} />
            <Button
              title="Apply for a wholesale account"
              kind="secondary"
              onPress={() => WebBrowser.openBrowserAsync(`${PORTAL_URL}/apply`)}
            />
            <Pressable onPress={() => router.push("/browse")} style={{ alignSelf: "center", padding: space.sm }}>
              <Text style={{ color: colors.accent, fontWeight: "600", fontSize: 15 }}>
                Browse the catalog first
              </Text>
            </Pressable>
            {minimum.data ? (
              <T variant="small" style={{ textAlign: "center" }}>
                Orders start at {money(minimum.data.orderCents)}. Prices show once your store is approved.
              </T>
            ) : null}
          </View>

          {top.data && top.data.rows.length > 0 ? (
            <View style={{ gap: space.md, marginTop: space.md }}>
              <T variant="h2">Selling through now</T>
              <FlatList
                horizontal
                data={top.data.rows}
                keyExtractor={(i) => i.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.md }}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.tile}
                    onPress={() =>
                      landing.data?.catalogOpen
                        ? router.push({ pathname: "/browse/[id]", params: { id: item.id } })
                        : router.push("/browse")
                    }
                    accessibilityLabel={`${item.brand.name} ${item.name}`}
                  >
                    <ProductImage url={item.imageUrl} name={item.name} />
                    <Text style={s.tileBrand} numberOfLines={1}>
                      {item.brand.name}
                    </Text>
                    <Text style={s.tileName} numberOfLines={2}>
                      {item.name}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          ) : null}

          {landing.data && (landing.data.deliveryDays || landing.data.phone || landing.data.hours) ? (
            <View style={[s.card, { gap: space.sm }]}>
              <T variant="h3">Good to know</T>
              {landing.data.deliveryDays ? <T variant="muted">Delivery: {landing.data.deliveryDays}</T> : null}
              {landing.data.freeShippingCents ? (
                <T variant="muted">Free shipping over {money(landing.data.freeShippingCents)}</T>
              ) : null}
              {landing.data.hours ? <T variant="muted">Hours: {landing.data.hours}</T> : null}
              {landing.data.phone ? <T variant="muted">Call: {landing.data.phone}</T> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg, marginTop: space.md }}>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL.privacy)}>
              <T variant="small">Privacy policy</T>
            </Pressable>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL.terms)}>
              <T variant="small">Terms</T>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: {
    backgroundColor: colors.foot,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.xxl * 1.6,
    gap: space.sm,
  },
  eyebrow: { color: colors.panelMint, fontSize: 13, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#fff", fontSize: 30, fontWeight: "700", letterSpacing: -0.5, lineHeight: 36 },
  lead: { color: colors.panelInk, fontSize: 16, lineHeight: 22 },
  card: {
    backgroundColor: colors.page,
    borderRadius: radius.lg * 1.25,
    padding: space.lg,
    gap: space.md,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  tile: { width: 140, gap: 4 },
  tileBrand: { fontSize: 11, color: colors.muted, fontWeight: "700", letterSpacing: 0.4, marginTop: 4 },
  tileName: { fontSize: 13, color: colors.ink, fontWeight: "600" },
});
