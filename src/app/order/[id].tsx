import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApi, useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { ProductImage } from "@/components/ProductImage";
import { Banner, Button, Card, Divider, ErrorState, Field, Loading, Pill, Row, Screen, Section, T } from "@/components/ui";
import { absoluteUrl } from "@/config";
import { day, money, plural } from "@/lib/format";
import { stageTone, trackingUrl } from "@/lib/orders";
import { colors, space } from "@/theme";

export default function Order() {
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  const { can } = useSession();
  const q = useApi(shop.getOrder, { params: { id } });
  const reorder = useApiMutation(shop.reorder, { invalidates: CART_DEPENDENTS });
  const cancel = useApiMutation(shop.cancelOrder, { invalidates: [shop.getOrder, shop.listOrders] });
  const payLink = useApiMutation(shop.orderPayLink);
  const ask = useApiMutation(shop.askOrderChanges);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;

  const doReorder = () =>
    reorder.mutate(
      { params: { id: o.id }, body: { mode: "add" } },
      {
        onSuccess: (r) => {
          const skipped = r.skipped.length ? `\n${plural(r.skipped.length, "item")} couldn't be added (out of stock or no longer sold).` : "";
          Alert.alert("Added to your cart", `${plural(r.added, "item")} added at today's prices.${skipped}`, [
            { text: "Keep browsing", style: "cancel" },
            { text: "Go to cart", onPress: () => router.push("/cart") },
          ]);
        },
        onError: (e) => Alert.alert("Couldn't reorder", messageOf(e)),
      },
    );

  const doCancel = () =>
    Alert.alert("Cancel this order?", `${o.number} won't be sent to Marsa.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: () =>
          cancel.mutate(
            { params: { id: o.id }, body: { version: o.version } },
            { onError: (e) => Alert.alert("Couldn't cancel", messageOf(e)) },
          ),
      },
    ]);

  const doPay = () =>
    payLink.mutate(
      { params: { id: o.id } },
      {
        onSuccess: (r) => void WebBrowser.openBrowserAsync(absoluteUrl(r.url) ?? r.url).then(() => q.refetch()),
        onError: (e) => Alert.alert("Couldn't open payment", messageOf(e)),
      },
    );

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {placed ? (
        <Banner tone="pos">
          {`Order ${o.number} was sent to Marsa. Nothing is charged yet: we'll confirm stock, freight and tax, then let you know.`}
        </Banner>
      ) : null}

      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <T variant="title" style={{ flex: 1 }}>
            {o.number}
          </T>
          <Pill label={o.stageLabel} tone={stageTone(o.stage)} />
        </View>
        <T variant="muted">
          Placed {day(o.placedOn)}
          {o.placedBy ? ` by ${o.placedBy.name}` : ""}
          {o.customerPo ? ` · PO ${o.customerPo}` : ""}
        </T>
      </View>

      {o.hold ? (
        <Banner tone="warn">
          {o.hold.reason === "overdue"
            ? `On hold: an invoice is overdue${o.hold.amountCents ? `. Pay ${money(o.hold.amountCents)} so it ships.` : "."}`
            : `On hold: this order is over your credit limit${o.hold.amountCents ? `. Pay ${money(o.hold.amountCents)} so it ships.` : "."}`}
        </Banner>
      ) : null}

      <View style={{ gap: space.sm }}>
        {o.stage === "ready_to_pay" && can("pay") ? (
          <Button title="Pay for this order" loading={payLink.isPending} onPress={doPay} />
        ) : null}
        {o.hold?.payable && can("pay") ? (
          <Button title="Pay invoices" kind="secondary" onPress={() => router.push("/invoices")} />
        ) : null}
        {can("shop") ? (
          <Button title="Reorder these items" kind="secondary" loading={reorder.isPending} onPress={doReorder} />
        ) : null}
      </View>

      <Section title={plural(o.lineItems.length, "item")}>
        <Card>
          {o.lineItems.map((l, i) => (
            <View key={l.id} style={{ gap: space.md }}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                style={{ flexDirection: "row", gap: space.md }}
                onPress={() => router.push({ pathname: "/product/[id]", params: { id: l.productId } })}
              >
                <ProductImage url={l.imageUrl} name={l.name} size={56} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="h3" numberOfLines={2}>
                    {l.name}
                  </T>
                  <T variant="small">
                    {l.confirmedQty != null && l.confirmedQty !== l.askedQty
                      ? `Asked ${l.askedQty} · confirmed ${l.confirmedQty}`
                      : `${l.askedQty}`}{" "}
                    × {money(l.unitPriceCents)}
                    {l.shippedQty > 0 ? ` · shipped ${l.shippedQty}` : ""}
                  </T>
                </View>
                <T variant="h3">{money(l.totalCents)}</T>
              </Pressable>
            </View>
          ))}
        </Card>
      </Section>

      <Card>
        <Row label="Items" value={money(o.totals.itemsCents)} />
        <Row label="Freight" value={o.pickup ? "Pick up" : o.totals.freightCents != null ? money(o.totals.freightCents) : "To be confirmed"} />
        <Row
          label={o.taxRatePercent ? `Tax (${o.taxRatePercent}%)` : "Tax"}
          value={o.totals.taxCents != null ? money(o.totals.taxCents) : "To be confirmed"}
        />
        <Divider />
        <Row strong label="Total" value={o.totals.totalCents != null ? money(o.totals.totalCents) : money(o.totalCents)} />
        {o.payment ? <T variant="small">{o.payment.label}</T> : null}
      </Card>

      <Section title={o.pickup ? "Pick up" : "Delivery"}>
        <Card>
          {o.shipTo && !o.pickup ? (
            <T>
              {[o.shipTo.label, o.shipTo.line1, o.shipTo.line2, `${o.shipTo.city}, ${o.shipTo.state} ${o.shipTo.postalCode}`]
                .filter(Boolean)
                .join("\n")}
            </T>
          ) : null}
          <T variant="muted">
            {o.shipping.label}
            {o.shipService ? ` · ${o.shipService}` : ""}
          </T>
          {o.deliveries.map((d) => (
            <View key={d.id} style={{ gap: 2 }}>
              <Divider />
              <T variant="h3">
                {d.number} · {d.status}
              </T>
              <T variant="small">
                {d.shipDate ? `Shipped ${day(d.shipDate)}` : ""}
                {d.carrierService ? ` · ${d.carrierService}` : ""}
              </T>
              {d.trackingNumber ? (
                <Pressable
                  onPress={() => Linking.openURL(trackingUrl(d.trackingNumber ?? ""))}
                >
                  <T style={{ color: colors.accent, fontWeight: "600" }}>Track {d.trackingNumber}</T>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      </Section>

      {ask.isSuccess ? (
        <Banner tone="pos">Sent. {ask.data.to === "rep" ? "Your rep" : "The Marsa team"} will get back to you.</Banner>
      ) : asking ? (
        <Card>
          <Field
            label="What would you like changed?"
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={2000}
            autoFocus
          />
          {ask.isError ? <Banner tone="neg">{messageOf(ask.error)}</Banner> : null}
          <Button
            title="Send to Marsa"
            disabled={!message.trim()}
            loading={ask.isPending}
            onPress={() => ask.mutate({ params: { id: o.id }, body: { message: message.trim() } })}
          />
        </Card>
      ) : o.stage !== "cancelled" && o.stage !== "closed" ? (
        <Button title="Ask for changes" kind="ghost" onPress={() => setAsking(true)} />
      ) : null}

      {can("shop") && o.deliveries.some((d) => d.deliveredAt) ? (
        <Button
          title="Start a return"
          kind="ghost"
          onPress={() => router.push({ pathname: "/returns/new", params: { order: o.id } })}
        />
      ) : null}

      {o.canCancel ? <Button title="Cancel order" kind="ghost" loading={cancel.isPending} onPress={doCancel} /> : null}
    </Screen>
  );
}
