import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as StoreReview from "expo-store-review";
import { useEffect } from "react";
import { View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { Button, Card, Row, Screen, T } from "@/components/ui";
import { money, plural } from "@/lib/format";
import { askAdConsentOnce, countOrderPlaced } from "@/lib/analytics";
import { colors, space } from "@/theme";

const NEXT = [
  { icon: "checkmark-done-outline", text: "Marsa checks stock and confirms your order, usually the same business day." },
  { icon: "pricetag-outline", text: "Freight and tax are added at confirmation. Nothing is charged before then." },
  { icon: "cube-outline", text: "You'll get updates by email (and WhatsApp if it's on) when it ships." },
] as const;

/** After Send: the order number, what happens next and where to go. */
export default function Placed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.getOrder, { params: { id } });
  const o = q.data;

  // After the 2nd order (and every 10th), ask for an App Store / Play review: a happy moment, rarely.
  // After the first, ask once about ad measurement (iOS shows Apple's prompt; nothing if it's off for this build).
  useEffect(() => {
    void (async () => {
      const n = await countOrderPlaced();
      await new Promise((r) => setTimeout(r, 1500));
      if (n === 1) await askAdConsentOnce();
      if ((n === 2 || n % 10 === 0) && (await StoreReview.hasAction())) await StoreReview.requestReview();
    })();
  }, []);
  return (
    <Screen contentStyle={{ paddingTop: space.xxl }}>
      <View style={{ alignItems: "center", gap: space.md }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: colors.accentTint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="checkmark" size={48} color={colors.accent} />
        </View>
        <T variant="title" style={{ textAlign: "center" }}>
          Order sent to Marsa
        </T>
        {o ? (
          <T variant="muted" style={{ textAlign: "center" }}>
            {o.number} · {plural(o.units, "unit")} · {money(o.totalCents)}
          </T>
        ) : null}
      </View>

      <Card>
        {NEXT.map((n) => (
          <View key={n.text} style={{ flexDirection: "row", gap: space.md }}>
            <Ionicons name={n.icon} size={20} color={colors.accent} />
            <T style={{ flex: 1 }}>{n.text}</T>
          </View>
        ))}
      </Card>

      {o ? (
        <Card>
          <Row label="Status" value={o.stageLabel} />
          {o.customerPo ? <Row label="Your PO" value={o.customerPo} /> : null}
          <Row label="Ship" value={o.pickup ? "Pick up" : o.shipping.label} />
        </Card>
      ) : null}

      <Button title="View order" onPress={() => router.replace({ pathname: "/order/[id]", params: { id } })} />
      <Button title="Back to shopping" kind="secondary" onPress={() => router.dismissTo("/")} />
    </Screen>
  );
}
