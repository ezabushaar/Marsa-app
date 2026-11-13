import { Stack, router, useLocalSearchParams } from "expo-router";
import { Alert, FlatList, Pressable, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { qtyRules, snapQty } from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApi, useApiMutation } from "@/api/hooks";
import { EmptyState } from "@/components/kit";
import { ProductImage } from "@/components/ProductImage";
import { Button, ErrorState, Loading, T, styles } from "@/components/ui";
import { money, plural } from "@/lib/format";
import { track } from "@/lib/analytics";
import { colors, space } from "@/theme";

/** One saved list: its items at today's price and stock; add it all to the cart, remove items, delete the list. */
export default function ListDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.getList, { params: { id } });
  const addAll = useApiMutation(shop.addCartLines, { invalidates: CART_DEPENDENTS });
  const update = useApiMutation(shop.updateList, { invalidates: [shop.getList, shop.listLists] });
  const remove = useApiMutation(shop.deleteList, { invalidates: [shop.listLists] });

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data;
  const sendable = list.items.filter((i) => i.sold && i.stock !== "out_of_stock");
  const total = sendable.reduce((n, i) => n + i.priceCents * snapQty(i.quantity, qtyRules(i)), 0);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: list.name }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        data={list.items}
        keyExtractor={(i) => i.id}
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
        ListEmptyComponent={
          <EmptyState icon="bookmark-outline" title="This list is empty" body="Tap Save to list on any product page." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { flexDirection: "row", alignItems: "center" }]}
            onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}
          >
            <ProductImage url={item.imageUrl} name={item.name} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="h3" numberOfLines={2}>
                {item.name}
              </T>
              <T variant="small" style={!item.sold || item.stock === "out_of_stock" ? { color: colors.neg } : undefined}>
                {!item.sold ? "No longer sold" : `${item.quantity} × ${money(item.priceCents)} · ${item.stockLabel}`}
              </T>
            </View>
            <Pressable
              hitSlop={10}
              accessibilityLabel={`Remove ${item.name} from the list`}
              onPress={() =>
                update.mutate(
                  {
                    params: { id: list.id },
                    body: {
                      version: list.version,
                      items: list.items.filter((x) => x.id !== item.id).map((x) => ({ productId: x.id, quantity: x.quantity })),
                    },
                  },
                  { onError: (e) => Alert.alert("Couldn't remove it", messageOf(e)) },
                )
              }
            >
              <T style={{ color: colors.muted, fontSize: 20 }}>×</T>
            </Pressable>
          </Pressable>
        )}
        ListFooterComponent={
          <Button
            title="Delete this list"
            kind="ghost"
            onPress={() =>
              Alert.alert(`Delete "${list.name}"?`, "The items stay in the catalog; only the list goes.", [
                { text: "Keep", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    remove.mutate({ params: { id: list.id } }, { onSuccess: () => router.back(), onError: (e) => Alert.alert("Couldn't delete", messageOf(e)) }),
                },
              ])
            }
          />
        }
      />
      {sendable.length > 0 ? (
        <View style={{ padding: space.lg, backgroundColor: colors.page, borderTopWidth: 1, borderColor: colors.lineSoft }}>
          <Button
            title={`Add ${plural(sendable.length, "item")} to cart · ${money(total)}`}
            loading={addAll.isPending}
            onPress={() =>
              addAll.mutate(
                { body: { lines: sendable.map((i) => ({ productId: i.id, quantity: snapQty(i.quantity, qtyRules(i)) })) } },
                {
                  onSuccess: () => {
                    track("add_to_cart", { via: "list", lines: sendable.length, value_cents: total });
                    router.push("/cart");
                  },
                  onError: (e) => Alert.alert("Couldn't add them", messageOf(e)),
                },
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}
