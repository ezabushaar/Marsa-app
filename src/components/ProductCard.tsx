import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { type catalogItem, qtyRules } from "@contracts/routes/portal/shop";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApiMutation } from "@/api/hooks";
import { money } from "@/lib/format";
import { colors, radius, space } from "@/theme";
import { ProductImage } from "./ProductImage";
import { QtyStepper } from "./QtyStepper";
import { Button } from "./ui";

export type CatalogItem = z.infer<typeof catalogItem>;

/** Sets an item's quantity in the cart (or takes it off), refreshing every screen that shows "in cart". */
export function useCartLine(productId: string) {
  const set = useApiMutation(shop.setCartLine, { invalidates: CART_DEPENDENTS });
  const remove = useApiMutation(shop.removeCartLine, { invalidates: CART_DEPENDENTS });
  return {
    busy: set.isPending || remove.isPending,
    setQty: (quantity: number) =>
      set.mutateAsync({ params: { productId }, body: { quantity } }).catch((e) => {
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

export function stockTone(stock: CatalogItem["stock"]) {
  return stock === "in_stock" ? colors.pos : stock === "low" ? colors.warn : colors.neg;
}

/** Add to cart, or − n + once it's in the cart. */
export function AddToCart({ item, wide }: { item: CatalogItem; wide?: boolean }) {
  const rules = qtyRules(item);
  const line = useCartLine(item.id);
  const [qty, setQty] = useState(item.inCart);
  useEffect(() => setQty(item.inCart), [item.inCart]);

  if (item.stock === "out_of_stock" && item.inCart === 0) {
    return <Text style={{ color: colors.neg, fontSize: 13, fontWeight: "600" }}>Out of stock</Text>;
  }
  if (qty === 0) {
    return (
      <Button
        title={wide ? `Add ${rules.start} to cart` : `Add ${rules.start}`}
        loading={line.busy}
        style={wide ? undefined : { minHeight: 36, paddingHorizontal: space.md }}
        onPress={() => {
          setQty(rules.start);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          line.setQty(rules.start).catch(() => setQty(0));
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
        line.setQty(n).catch(() => setQty(before));
      }}
    />
  );
}

/** A catalog tile: photo, brand, name, the customer's price, MSRP, stock and add to cart. */
export function ProductCard({ item }: { item: CatalogItem }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.brand.name} ${item.name}`}
    >
      <ProductImage url={item.imageUrl} name={item.name} />
      <View style={{ gap: 2 }}>
        <Text style={s.brand} numberOfLines={1}>
          {item.brand.name}
        </Text>
        <Text style={s.name} numberOfLines={2}>
          {item.name}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <Text style={s.price}>{money(item.priceCents)}</Text>
        {item.msrpCents ? <Text style={s.msrp}>MSRP {money(item.msrpCents)}</Text> : null}
      </View>
      <Text style={[s.stock, { color: stockTone(item.stock) }]} numberOfLines={1}>
        {item.stockLabel}
        {item.casePack ? ` · case ${item.casePack}` : ""}
      </Text>
      <AddToCart item={item} />
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
  brand: { fontSize: 12, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  name: { fontSize: 14, color: colors.ink, fontWeight: "600", minHeight: 36 },
  price: { fontSize: 17, fontWeight: "700", color: colors.inkStrong },
  msrp: { fontSize: 12, color: colors.muted },
  stock: { fontSize: 12, fontWeight: "600" },
});
