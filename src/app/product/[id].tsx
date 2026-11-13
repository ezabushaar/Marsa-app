import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, Share, useWindowDimensions, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { call, messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { useActionMenu } from "@/components/ActionMenu";
import { AddToCart, stockTone } from "@/components/ProductCard";
import { ProductImage } from "@/components/ProductImage";
import { Shelf } from "@/components/Shelf";
import { Banner, Button, Card, ErrorState, Field, Loading, Pill, Row, Screen, Section, T } from "@/components/ui";
import { absoluteUrl } from "@/config";
import { day, money, percentBp } from "@/lib/format";
import { track, useTrackView } from "@/lib/analytics";
import { colors, space } from "@/theme";

/** Swipeable product photos (the box, the case, the gallery) on a white well. */
function Gallery({ urls, name }: { urls: string[]; name: string }) {
  const { width } = useWindowDimensions();
  const size = width - space.lg * 2;
  const [index, setIndex] = useState(0);
  if (urls.length <= 1) return <ProductImage url={urls[0] ?? null} name={name} style={{ borderRadius: 20 }} />;
  return (
    <View style={{ gap: space.sm }}>
      <FlatList
        horizontal
        pagingEnabled
        data={urls}
        keyExtractor={(u) => u}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / size))}
        renderItem={({ item }) => (
          <View style={{ width: size, height: size, backgroundColor: "#fff", borderRadius: 20, overflow: "hidden" }}>
            <Image source={{ uri: absoluteUrl(item) ?? undefined }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={name} />
          </View>
        )}
      />
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
        {urls.map((u, i) => (
          <View
            key={u}
            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === index ? colors.accent : colors.line }}
          />
        ))}
      </View>
    </View>
  );
}

export default function Product() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.catalogItemRoute, { params: { productId: id } });
  const lists = useApi(shop.listLists);
  const addToList = useApiMutation(shop.updateList, { invalidates: [shop.listLists, shop.getList] });
  const newList = useApiMutation(shop.createList, { invalidates: [shop.listLists] });
  const askQuote = useApiMutation(shop.askQuote);
  const [asking, setAsking] = useState(false);
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState("");
  const menu = useActionMenu();
  const viewed = q.data;
  useTrackView(
    "product_view",
    viewed
      ? { product_id: viewed.id, sku: viewed.sku, brand: viewed.brand.name, price_cents: viewed.priceCents, stock: viewed.stock }
      : undefined,
    viewed?.id ?? null,
  );

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const rules = shop.qtyRules(p);
  const photos = [...new Set([...p.photos.map((x) => x.url), ...(p.imageUrl ? [p.imageUrl] : [])])];

  /** Adds this item to a saved list the person picks, or a new one. */
  const saveToList = async () => {
    const rows = lists.data?.rows ?? [];
    const addTo = async (listId: string) => {
      try {
        const l = await call(shop.getList, { params: { id: listId } });
        if (l.items.some((i) => i.id === p.id)) {
          Alert.alert("Already saved", `${p.name} is already on "${l.name}".`);
          return;
        }
        await addToList.mutateAsync({
          params: { id: listId },
          body: {
            version: l.version,
            items: [...l.items.map((i) => ({ productId: i.id, quantity: i.quantity })), { productId: p.id, quantity: rules.start }],
          },
        });
        Alert.alert("Saved", `Added to "${l.name}".`);
      } catch (e) {
        Alert.alert("Couldn't save it", messageOf(e));
      }
    };
    const create = async () => {
      try {
        const l = await newList.mutateAsync({ body: { name: "My favorites", items: [{ productId: p.id, quantity: rules.start }] } });
        Alert.alert("Saved", `Added to "${l.name}".`);
      } catch (e) {
        Alert.alert("Couldn't save it", messageOf(e));
      }
    };
    if (rows.length === 0) return create();
    menu.open("Save to a list", [
      ...rows.map((r) => ({ text: r.name, run: () => void addTo(r.id) })),
      { text: "New list", run: () => void create() },
    ]);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: p.brand.name }} />
      {menu.menu}
      <Gallery urls={photos} name={p.name} />

      <View style={{ gap: space.xs }}>
        <T variant="small">{p.brand.name.toUpperCase()}</T>
        <T variant="title">{p.name}</T>
        <T variant="small">
          SKU {p.sku}
          {p.upc ? ` · UPC ${p.upc}` : ""}
          {p.size ? ` · ${p.size}` : ""}
        </T>
      </View>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, flexWrap: "wrap" }}>
          <T style={{ fontSize: 30, fontWeight: "700", color: colors.inkStrong }}>{money(p.priceCents)}</T>
          <T variant="muted">your price</T>
          {p.marginAtMsrpBp != null ? <Pill tone="pos" label={`You keep ${percentBp(p.marginAtMsrpBp)} at MSRP`} /> : null}
        </View>
        {p.contract ? (
          <Banner tone="info">
            {`Contract price ${money(p.contract.unitPriceCents)} from ${p.contract.minQty} units${p.contract.endsOn ? ` · until ${day(p.contract.endsOn)}` : ""}`}
          </Banner>
        ) : null}
        {p.msrpCents ? <Row label="MSRP (suggested retail)" value={money(p.msrpCents)} /> : null}
        {p.casePack ? <Row label="Case of" value={`${p.casePack} · ${money(p.priceCents * p.casePack)}`} /> : null}
        <Row label="Stock" value={<T style={{ color: stockTone(p.stock), fontWeight: "600" }}>{p.stockLabel}</T>} />
        <Row label="Order at least" value={`${rules.min} units`} />
        {rules.step > 1 ? <Row label="Sold in packs of" value={String(rules.step)} /> : null}
        {rules.max != null ? <Row label="Most per order" value={String(rules.max)} /> : null}
        {p.lastOrdered ? (
          <Row
            label="You last ordered"
            value={`${p.lastOrdered.quantity} on ${day(p.lastOrdered.date, false)}`}
          />
        ) : null}
        <AddToCart item={p} wide />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            title="Save to list"
            kind="secondary"
            style={{ flex: 1 }}
            icon={<Ionicons name="bookmark-outline" size={18} color={colors.accentDeep} />}
            onPress={() => void saveToList()}
          />
          <Button
            title="Volume quote"
            kind="secondary"
            style={{ flex: 1 }}
            icon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accentDeep} />}
            onPress={() => setAsking(!asking)}
          />
        </View>
      </Card>

      {asking ? (
        askQuote.isSuccess ? (
          <Banner tone="pos">
            {`Sent. ${askQuote.data.to === "rep" ? "Your rep" : "The Marsa team"} will reply with a quote, and it will show under Orders › Quotes.`}
          </Banner>
        ) : (
          <Card>
            <T variant="h3">Ask for a volume price</T>
            <Field label="How many units?" value={qty} onChangeText={setQty} keyboardType="number-pad" />
            <Field label="Anything else? (optional)" value={msg} onChangeText={setMsg} multiline maxLength={2000} />
            {askQuote.isError ? <Banner tone="neg">{messageOf(askQuote.error)}</Banner> : null}
            <Button
              title="Send request"
              loading={askQuote.isPending}
              onPress={() => {
                track("ask_rep_click", { product_id: p.id, quantity: Number.parseInt(qty, 10) || null });
                askQuote.mutate({
                  params: { productId: p.id },
                  body: {
                    quantity: Number.parseInt(qty, 10) > 0 ? Number.parseInt(qty, 10) : null,
                    message: msg.trim() || null,
                  },
                });
              }}
            />
          </Card>
        )
      ) : null}

      {p.notes ? (
        <Section title="About this fragrance">
          <Card>
            <T>{p.notes}</T>
            {p.categoryName ? <T variant="small">{p.categoryName}</T> : null}
          </Card>
        </Section>
      ) : null}

      {p.photos.length > 0 ? (
        <Pressable
          onPress={() =>
            Share.share({ message: `${p.brand.name} ${p.name}\n${p.photos.map((x) => absoluteUrl(x.url)).join("\n")}` })
          }
          style={{ flexDirection: "row", gap: space.sm, alignItems: "center", alignSelf: "flex-start" }}
          accessibilityRole="button"
        >
          <Ionicons name="share-outline" size={18} color={colors.accent} />
          <T style={{ color: colors.accent, fontWeight: "600" }}>Share product photos for your store</T>
        </Pressable>
      ) : null}

      <Shelf title="Sells well with" rows={p.sellsWellWith} />
      <Shelf title={`More from ${p.brand.name}`} rows={p.moreFromBrand} />
    </Screen>
  );
}
