import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as pay from "@contracts/routes/portal/pay";
import * as shop from "@contracts/routes/portal/shop";
import { qtyRules, snapQty } from "@contracts/routes/portal/shop";
import * as priceLists from "@contracts/routes/priceLists";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApi, useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Progress } from "@/components/kit";
import { Shelf } from "@/components/Shelf";
import { Button, Card, Chip, Pill, Screen, Section, T } from "@/components/ui";
import { day, money, plural } from "@/lib/format";
import { stageTone } from "@/lib/orders";
import { colors, radius, space } from "@/theme";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Home: what to do today. Balance due, the cart's progress, order again, deals, restocks and new arrivals. */
export default function Home() {
  const { me, can } = useSession();
  const shops = can("shop");
  const pays = can("pay");
  const opts = { enabled: shops };
  const cart = useApi(shop.getCart, undefined, opts);
  const orders = useApi(shop.listOrders, { query: { tab: "all", limit: 3 } });
  const usual = useApi(shop.usualOrder, undefined, opts);
  const again = useApi(shop.buyAgain, { query: { limit: 12 } }, opts);
  const arrivals = useApi(shop.newArrivals, { query: { limit: 12 } }, opts);
  const deals = useApi(priceLists.portalClearance, undefined, opts);
  const follows = useApi(shop.listFollows, undefined, opts);
  const brands = useApi(shop.brands, undefined, opts);
  const invoices = useApi(pay.listInvoices, { query: { tab: "open", limit: 1 } }, { enabled: pays });
  const rep = useApi(shop.rep);
  const addUsual = useApiMutation(shop.addCartLines, { invalidates: CART_DEPENDENTS });
  const reorder = useApiMutation(shop.reorder, { invalidates: CART_DEPENDENTS });

  const all = [cart, orders, usual, again, arrivals, deals, follows, invoices];
  const refresh = () => all.forEach((q) => void q.refetch());
  const refreshing = all.some((q) => q.isRefetching);

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const due = invoices.data ? BigInt(invoices.data.totalDueCents) : 0n;
  const overdue = invoices.data ? due - BigInt(invoices.data.aging.current) : 0n;
  const summary = cart.data?.summary;
  const backInStock = (follows.data?.rows ?? []).filter((f) => f.stock !== "out_of_stock");
  const usualRows = usual.data?.rows ?? [];

  const doReorder = (id: string, number: string) =>
    reorder.mutate(
      { params: { id }, body: { mode: "add" } },
      {
        onSuccess: (r) =>
          Alert.alert(
            `${number} added to your cart`,
            `${plural(r.added, "item")} at today's prices.${r.skipped.length ? ` ${plural(r.skipped.length, "item")} couldn't be added.` : ""}`,
            [
              { text: "Keep shopping", style: "cancel" },
              { text: "View cart", onPress: () => router.push("/cart") },
            ],
          ),
        onError: (e) => Alert.alert("Couldn't reorder", messageOf(e)),
      },
    );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: 2 }}>
        <T variant="muted">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </T>
        <T variant="title">{me?.customer.name}</T>
      </View>

      {shops ? (
        <Pressable style={s.search} onPress={() => router.navigate("/shop")} accessibilityRole="search">
          <Ionicons name="search" size={18} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 15, flex: 1 }}>Search name, brand, SKU or UPC</Text>
          <Ionicons name="barcode-outline" size={20} color={colors.accent} />
        </Pressable>
      ) : null}

      {pays && invoices.data && due > 0n ? (
        <Pressable onPress={() => router.push("/invoices")} accessibilityRole="button">
          <View style={[s.balance, overdue > 0n && { backgroundColor: colors.warnTint, borderColor: colors.warnDot }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="small">Balance due · {invoices.data.terms.label}</T>
              <Text style={s.balanceAmount}>{money(due)}</Text>
              {overdue > 0n ? (
                <T style={{ color: colors.warn, fontWeight: "600" }}>{money(overdue)} overdue</T>
              ) : null}
            </View>
            <View style={s.payPill}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Pay</Text>
            </View>
          </View>
        </Pressable>
      ) : null}

      {shops && summary && summary.lines > 0 ? (
        <Pressable onPress={() => router.push("/cart")}>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <T variant="h3" style={{ flex: 1 }}>
                Your cart · {plural(summary.lines, "item")}
              </T>
              <T variant="h3">{money(summary.itemsCents)}</T>
            </View>
            {summary.minimum.reached ? (
              cart.data?.estimate?.freight.freeOver && !cart.data.estimate.freight.freeOver.reached ? (
                <>
                  <Progress
                    value={
                      Number(BigInt(summary.itemsCents)) / Number(BigInt(cart.data.estimate.freight.freeOver.thresholdCents))
                    }
                  />
                  <T variant="small">
                    {money(cart.data.estimate.freight.freeOver.shortCents)} more for free{" "}
                    {cart.data.estimate.freight.freeOver.methodName}
                  </T>
                </>
              ) : (
                <T variant="small" style={{ color: colors.pos, fontWeight: "600" }}>
                  Ready to send
                </T>
              )
            ) : (
              <>
                <Progress value={Number(BigInt(summary.itemsCents)) / Number(BigInt(summary.minimum.orderCents))} tone="warn" />
                <T variant="small">
                  {money(summary.minimum.shortCents)} more to reach the {money(summary.minimum.orderCents)} minimum
                </T>
              </>
            )}
          </Card>
        </Pressable>
      ) : null}

      {orders.data && orders.data.rows.length > 0 ? (
        <Section
          title="Order again"
          action={
            <Pressable onPress={() => router.navigate("/orders")} hitSlop={8}>
              <Text style={{ color: colors.accent, fontWeight: "600" }}>All orders</Text>
            </Pressable>
          }
        >
          <Card style={{ gap: 0, paddingVertical: space.sm }}>
            {orders.data.rows.map((o, i) => (
              <View key={o.id} style={[s.orderRow, i > 0 && s.rowLine]}>
                <Pressable
                  style={{ flex: 1, gap: 2 }}
                  onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })}
                >
                  <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                    <T variant="h3">{o.number}</T>
                    <Pill label={o.stageLabel} tone={stageTone(o.stage)} />
                  </View>
                  <T variant="small">
                    {day(o.placedOn, false)} · {plural(o.units, "unit")} · {money(o.totalCents)}
                  </T>
                </Pressable>
                {shops ? (
                  <Button
                    title="Reorder"
                    kind="secondary"
                    style={{ minHeight: 36, paddingHorizontal: space.md }}
                    loading={reorder.isPending && reorder.variables?.params?.id === o.id}
                    onPress={() => doReorder(o.id, o.number)}
                  />
                ) : null}
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {usualRows.length >= 3 ? (
        <Card style={{ backgroundColor: colors.accentTint, borderColor: colors.accentLine }}>
          <T variant="h3">Your usual order</T>
          <T variant="muted">
            {plural(usualRows.length, "item")} you order most, at your usual quantities.
          </T>
          <Button
            title={`Add all ${usualRows.length} to cart`}
            loading={addUsual.isPending}
            onPress={() =>
              addUsual.mutate(
                { body: { lines: usualRows.map((r) => ({ productId: r.id, quantity: snapQty(r.usualQty, qtyRules(r)) })) } },
                {
                  onSuccess: () => router.push("/cart"),
                  onError: (e) => Alert.alert("Couldn't add them", messageOf(e)),
                },
              )
            }
          />
        </Card>
      ) : null}

      <Shelf
        title="Clearance deals"
        rows={(deals.data?.rows ?? []).slice(0, 12)}
        more={() => router.push("/deals")}
        dealOf={(item) => {
          const d = deals.data?.rows.find((r) => r.id === item.id);
          return d ? { priceCents: d.clearancePriceCents, discountBp: d.discountBp, limitPerStore: d.limitPerStore } : undefined;
        }}
      />
      <Shelf title="Back in stock" rows={backInStock} more={() => router.push("/alerts")} />
      <Shelf title="Buy again" rows={again.data?.rows ?? []} />
      <Shelf
        title="New arrivals"
        rows={arrivals.data?.rows ?? []}
        more={() => router.navigate({ pathname: "/shop", params: { sort: "newest", at: String(Date.now()) } })}
      />

      {brands.data && brands.data.rows.length > 0 ? (
        <Section title="Shop by brand">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {brands.data.rows.slice(0, 24).map((b) => (
              <Chip
                key={b.id}
                label={`${b.name} · ${b.itemCount}`}
                onPress={() => router.navigate({ pathname: "/shop", params: { brandId: b.id, at: String(Date.now()) } })}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {rep.data && (rep.data.whatsappUrl || rep.data.email) ? (
        <Card>
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
            <View style={s.avatar}>
              <Text style={{ color: colors.accentDeep, fontWeight: "700", fontSize: 18 }}>
                {(rep.data.rep?.firstName ?? "M").slice(0, 1)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <T variant="h3">{rep.data.rep ? `${rep.data.rep.name}, your rep` : "The Marsa team"}</T>
              <T variant="small">Volume pricing, new lines, anything on your order.</T>
            </View>
          </View>
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
    </Screen>
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
  balance: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.line,
  },
  balanceAmount: { fontSize: 28, fontWeight: "700", color: colors.inkStrong, letterSpacing: -0.5 },
  payPill: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 10 },
  orderRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
