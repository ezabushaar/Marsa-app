import { router } from "expo-router";
import { Alert, Pressable, View } from "react-native";
import type { z } from "zod";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApi, useApiMutation } from "@/api/hooks";
import { EmptyState, Progress } from "@/components/kit";
import { useCartLine } from "@/components/ProductCard";
import { ProductImage } from "@/components/ProductImage";
import { QtyStepper } from "@/components/QtyStepper";
import { Banner, Button, Card, Divider, ErrorState, Loading, Row, Screen, T } from "@/components/ui";
import { money, plural } from "@/lib/format";
import { colors, space } from "@/theme";

type CartLine = z.infer<typeof shop.cartLine>;

function LineRow({ line }: { line: CartLine }) {
  const ctl = useCartLine(line.productId, !!line.clearance);
  const fix = useApiMutation(shop.fixCart, { invalidates: CART_DEPENDENTS });
  const rules = shop.qtyRules(line.item);
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        style={{ flexDirection: "row", gap: space.md }}
        onPress={() => router.push({ pathname: "/product/[id]", params: { id: line.productId } })}
      >
        <ProductImage url={line.item.imageUrl} name={line.item.name} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="small">{line.item.brand.name}</T>
          <T variant="h3" numberOfLines={2}>
            {line.item.name}
          </T>
          <T variant="small">
            {money(line.clearance?.priceCents ?? line.item.priceCents)} each
            {line.clearance ? " · clearance" : ""}
          </T>
        </View>
        <T variant="h3">{money(line.totalCents)}</T>
      </Pressable>
      <QtyStepper
        compact
        value={line.quantity}
        rules={rules}
        onChange={(n) => void ctl.setQty(n).catch(() => {})}
        onRemove={() => void ctl.remove().catch(() => {})}
      />
      {line.problem ? (
        <Banner tone="neg">
          <View style={{ gap: space.sm }}>
            <T style={{ color: colors.neg }}>{line.problem.message}</T>
            {line.problem.fix ? (
              <Button
                kind="secondary"
                title={line.problem.fix.label}
                loading={fix.isPending}
                onPress={() => fix.mutate({ body: { productIds: [line.productId] } })}
              />
            ) : null}
          </View>
        </Banner>
      ) : line.stockNote ? (
        <Banner tone="warn">{line.stockNote}</Banner>
      ) : null}
    </View>
  );
}

export default function Cart() {
  const q = useApi(shop.getCart);
  const fixAll = useApiMutation(shop.fixCart, { invalidates: CART_DEPENDENTS });
  const saveList = useApiMutation(shop.createList, { invalidates: [shop.listLists] });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const cart = q.data;
  const { summary, estimate } = cart;

  if (cart.lines.length === 0) {
    return (
      <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
        <EmptyState
          icon="bag-handle-outline"
          title="Your cart is empty"
          body={`Wholesale orders start at ${money(summary.minimum.orderCents)}. Scan your shelf or reorder a past order to fill it fast.`}
          action={
            <View style={{ gap: space.sm, alignSelf: "stretch" }}>
              <Button title="Scan barcodes" onPress={() => router.push("/scan")} />
              <Button title="Browse the catalog" kind="secondary" onPress={() => router.navigate("/shop")} />
              <Button title="Saved lists" kind="ghost" onPress={() => router.push("/lists")} />
            </View>
          }
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
        {summary.problems > 0 ? (
          <Banner tone="neg">
            <View style={{ gap: space.sm }}>
              <T style={{ color: colors.neg }}>
                {plural(summary.problems, "line")} need{summary.problems === 1 ? "s" : ""} a change before you can send.
              </T>
              <Button
                kind="secondary"
                title="Fix all"
                loading={fixAll.isPending}
                onPress={() => fixAll.mutate({ body: {} })}
              />
            </View>
          </Banner>
        ) : null}
        {!summary.minimum.reached ? (
          <Card style={{ gap: space.sm }}>
            <Progress
              tone="warn"
              value={Number(BigInt(summary.itemsCents)) / Number(BigInt(summary.minimum.orderCents))}
            />
            <T variant="small">
              Add {money(summary.minimum.shortCents)} more to reach the {money(summary.minimum.orderCents)} order minimum.
            </T>
          </Card>
        ) : estimate?.freight.freeOver && !estimate.freight.freeOver.reached ? (
          <Card style={{ gap: space.sm }}>
            <Progress
              value={Number(BigInt(summary.itemsCents)) / Number(BigInt(estimate.freight.freeOver.thresholdCents))}
            />
            <T variant="small">
              {money(estimate.freight.freeOver.shortCents)} more for free {estimate.freight.freeOver.methodName}
            </T>
          </Card>
        ) : null}

        <Card>
          {cart.lines.map((l, i) => (
            <View key={l.productId} style={{ gap: space.md }}>
              {i > 0 ? <Divider /> : null}
              <LineRow line={l} />
            </View>
          ))}
        </Card>

        <Card>
          <Row label={`Items (${plural(summary.units, "unit")})`} value={money(summary.itemsCents)} />
          {estimate && estimate.discountCents !== "0" ? (
            <Row label="Discounts" value={`−${money(estimate.discountCents)}`} />
          ) : null}
          {estimate ? (
            <>
              <Row
                label="Freight"
                value={
                  estimate.freight.status === "free"
                    ? "Free"
                    : estimate.freight.status === "charged"
                      ? money(estimate.freight.cents)
                      : "Quoted by Marsa"
                }
              />
              {estimate.freight.freeOver && !estimate.freight.freeOver.reached ? (
                <T variant="small">
                  {money(estimate.freight.freeOver.shortCents)} more for free {estimate.freight.freeOver.methodName}
                </T>
              ) : null}
              <Row label="Tax" value={estimate.tax.cents != null ? money(estimate.tax.cents) : estimate.tax.label} />
              <Divider />
              <Row
                strong
                label={estimate.partial ? "Estimated total" : "Total"}
                value={money(estimate.totalCents)}
              />
            </>
          ) : null}
        </Card>
        <T variant="small" style={{ textAlign: "center" }}>
          Nothing is charged when you send. Marsa confirms stock, freight and tax first.
        </T>
        <Button
          title="Save this cart as a list"
          kind="ghost"
          loading={saveList.isPending}
          onPress={() =>
            saveList.mutate(
              { body: { name: `Order ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, fromCart: true } },
              {
                onSuccess: (l) =>
                  Alert.alert("Saved", `"${l.name}" is in your saved lists.`, [
                    { text: "OK", style: "cancel" },
                    { text: "Open", onPress: () => router.push({ pathname: "/lists/[id]", params: { id: l.id } }) },
                  ]),
                onError: (e) => Alert.alert("Couldn't save the list", messageOf(e)),
              },
            )
          }
        />
      </Screen>
      <View style={{ padding: space.lg, backgroundColor: colors.page, borderTopWidth: 1, borderColor: colors.lineSoft }}>
        <Button
          title={summary.canSubmit ? "Checkout" : (summary.blockers[0] ?? "Not ready to send")}
          disabled={!summary.canSubmit}
          onPress={() => router.push("/checkout")}
        />
      </View>
    </View>
  );
}
