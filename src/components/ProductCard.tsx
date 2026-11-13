import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { type catalogItem, marginAtMsrpBp, qtyRules } from "@contracts/routes/portal/shop";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApiMutation } from "@/api/hooks";
import { money, percentBp } from "@/lib/format";
import { track } from "@/lib/analytics";
import { colors, radius, space } from "@/theme";
import { ProductImage } from "./ProductImage";
import { QtyStepper } from "./QtyStepper";
import { Button } from "./ui";

export type CatalogItem = z.infer<typeof catalogItem>;

/** A clearance price on an item (the Deals shelf); lines added with it go in at that price. */
export interface Deal {
  priceCents: number;
  discountBp: number;
  limitPerStore: number | null;
}

/** Sets an item's quantity in the cart (or takes it off), refreshing every screen that shows "in cart". */
export function useCartLine(productId: string, clearance?: boolean) {
  const set = useApiMutation(shop.setCartLine, { invalidates: CART_DEPENDENTS });
  const remove = useApiMutation(shop.removeCartLine, { invalidates: CART_DEPENDENTS });
  return {
    busy: set.isPending || remove.isPending,
    setQty: (quantity: number) =>
      set
        .mutateAsync({ params: { productId }, body: clearance ? { quantity, clearance: true } : { quantity } })
        .catch((e) => {
          Alert.alert("Couldn't update the cart", messageOf(e));
          throw e;
        }),
    remove: () =>
      remove.mutateAsync({ params: { productId } }).catch((e) => {
        Alert.alert("Couldn't update the cart", messageOf(e));
        throw e;
      }),
  };
}

/** "Tell me when it's back" for an out-of-stock item, and its undo. */
export function useFollow(productId: string) {
  const deps = [shop.listFollows, shop.catalog, shop.catalogItemRoute];
  const on = useApiMutation(shop.follow, { invalidates: deps });
  const off = useApiMutation(shop.unfollow, { invalidates: deps });
  return {
    busy: on.isPending || off.isPending,
    follow: () =>
      on
        .mutateAsync({ params: { productId } })
        .then(() => track("notify_me", { product_id: productId }))
        .catch((e) => Alert.alert("Couldn't set the alert", messageOf(e))),
    unfollow: () =>
      off.mutateAsync({ params: { productId } }).catch((e) => Alert.alert("Couldn't remove the alert", messageOf(e))),
  };
}

export function stockTone(stock: CatalogItem["stock"]) {
  return stock === "in_stock" ? colors.pos : stock === "low" ? colors.warn : colors.neg;
}

/** Add to cart, or − n + once it's in the cart; out of stock offers the restock alert instead. */
export function AddToCart({ item, wide, deal }: { item: CatalogItem; wide?: boolean; deal?: Deal }) {
  const rules = qtyRules({
    ...item,
    maxQty: deal?.limitPerStore != null ? Math.min(deal.limitPerStore, item.maxQty ?? Number.MAX_SAFE_INTEGER) : item.maxQty,
  });
  const line = useCartLine(item.id, !!deal);
  const alert = useFollow(item.id);
  const [qty, setQty] = useState(item.inCart);
  useEffect(() => setQty(item.inCart), [item.inCart]);

  if (item.stock === "out_of_stock" && item.inCart === 0) {
    return item.following ? (
      <Button
        title={wide ? "Alert on · tap to stop" : "Alert on"}
        kind="ghost"
        loading={alert.busy}
        style={wide ? undefined : { minHeight: 36, paddingHorizontal: 0 }}
        onPress={alert.unfollow}
        accessibilityHint="Stops the restock alert for this item"
      />
    ) : (
      <Button
        title={wide ? "Tell me when it's back" : "Notify me"}
        kind="secondary"
        loading={alert.busy}
        style={wide ? undefined : { minHeight: 36, paddingHorizontal: space.md }}
        onPress={alert.follow}
      />
    );
  }
  if (qty === 0) {
    return (
      <Button
        title={wide ? `Add ${rules.start} to cart` : `Add ${rules.start}`}
        loading={line.busy}
        style={wide ? undefined : { minHeight: 36, paddingHorizontal: space.md }}
        accessibilityLabel={`Add ${rules.start} of ${item.name} to cart`}
        onPress={() => {
          setQty(rules.start);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          line
            .setQty(rules.start)
            .then(() =>
              track("add_to_cart", {
                product_id: item.id,
                sku: item.sku,
                qty: rules.start,
                price_cents: deal?.priceCents ?? item.priceCents,
                deal: !!deal,
              }),
            )
            .catch(() => setQty(0));
        }}
      />
    );
  }
  return (
    <QtyStepper
      compact={!wide}
      value={qty}
      rules={rules}
      onRemove={() => {
        const before = qty;
        setQty(0);
        line.remove().catch(() => setQty(before));
      }}
      onChange={(n) => {
        const before = qty;
        setQty(n);
        void Haptics.selectionAsync();
        line
          .setQty(n)
          .then(() => track("cart_line_change", { product_id: item.id, from: before, to: n }))
          .catch(() => setQty(before));
      }}
    />
  );
}

/** A catalog tile: photo, brand, name, the customer's price, margin at MSRP, stock and add to cart. */
export function ProductCard({ item, deal }: { item: CatalogItem; deal?: Deal }) {
  const price = deal?.priceCents ?? item.priceCents;
  const margin = marginAtMsrpBp(item.msrpCents, price);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.brand.name} ${item.name}, ${money(price)}, ${item.stockLabel}`}
    >
      <View>
        <ProductImage url={item.imageUrl} name={item.name} />
        {deal ? (
          <View style={[s.flag, { backgroundColor: colors.badge }]}>
            <Text style={s.flagText}>−{percentBp(deal.discountBp)}</Text>
          </View>
        ) : margin != null && margin >= 2500 ? (
          <View style={s.flag}>
            <Text style={s.flagText}>{percentBp(margin)} margin</Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.brand} numberOfLines={1}>
          {item.brand.name}
        </Text>
        <Text style={s.name} numberOfLines={2}>
          {item.name}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <Text style={[s.price, deal && { color: colors.badge }]}>{money(price)}</Text>
        {deal ? (
          <Text style={[s.msrp, { textDecorationLine: "line-through" }]}>{money(item.priceCents)}</Text>
        ) : item.msrpCents ? (
          <Text style={s.msrp}>MSRP {money(item.msrpCents)}</Text>
        ) : null}
      </View>
      <Text style={[s.stock, { color: stockTone(item.stock) }]} numberOfLines={1}>
        {item.stockLabel}
        {item.casePack ? ` · case ${item.casePack}` : ""}
      </Text>
      <AddToCart item={item} deal={deal} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  flag: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flagText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  brand: { fontSize: 12, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  name: { fontSize: 14, color: colors.ink, fontWeight: "600", minHeight: 36 },
  price: { fontSize: 17, fontWeight: "700", color: colors.inkStrong },
  msrp: { fontSize: 12, color: colors.muted },
  stock: { fontSize: 12, fontWeight: "600" },
});
