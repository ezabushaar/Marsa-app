import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { z } from "zod";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApiMutation } from "@/api/hooks";
import { EmptyState } from "@/components/kit";
import { ProductImage } from "@/components/ProductImage";
import { QtyStepper } from "@/components/QtyStepper";
import { Button, T } from "@/components/ui";
import { money } from "@/lib/format";
import { colors, radius, space } from "@/theme";

type ScannedItem = NonNullable<z.infer<typeof shop.lookupLine>["item"]>;
interface Scanned {
  code: string;
  item: ScannedItem;
  qty: number;
}

/**
 * Scan a shelf: every bottle UPC or case barcode becomes a line (scanning the same item again adds a pack), then
 * Review → Add all to cart. The ERP's order-sheet lookup prices each item for this store and applies its quantity
 * rules. A barcode can also be typed when a label won't scan.
 */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useApiMutation(shop.lookup);
  const add = useApiMutation(shop.addCartLines, { invalidates: CART_DEPENDENTS });
  const [lines, setLines] = useState<Scanned[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: "pos" | "neg" } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (text: string, tone: "pos" | "neg") => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const onCode = async (code: string) => {
    const now = Date.now();
    // The camera reports a barcode many times a second while it stays in view: the same code counts again only
    // after it has been out of the frame for a moment (every sighting pushes the window forward).
    const seen = last.current;
    last.current = { code, at: now };
    if (seen && seen.code === code && now - seen.at < 1500) return;
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await lookup.mutateAsync({ body: { lines: [{ code, quantity: null }] } });
      const line = r.lines[0];
      const item = line?.item;
      if (!item) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        say(line?.problem?.message ?? `No item has the code ${code}`, "neg");
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const rules = shop.qtyRules(item);
      setLines((prev) => {
        const i = prev.findIndex((l) => l.item.id === item.id);
        if (i >= 0) {
          const next = [...prev];
          const cur = next[i] as Scanned;
          next[i] = { ...cur, qty: shop.stepUp(cur.qty, rules) };
          return next;
        }
        return [{ code, item, qty: line?.quantity ?? rules.start }, ...prev];
      });
      say(`${item.name} · ${money(item.priceCents)}`, "pos");
    } catch (e) {
      say(messageOf(e), "neg");
    } finally {
      busy.current = false;
    }
  };

  const addAll = () =>
    add.mutate(
      { body: { lines: lines.map((l) => ({ productId: l.item.id, quantity: l.qty })) } },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace("/cart");
        },
        onError: (e) => Alert.alert("Couldn't add them", messageOf(e)),
      },
    );

  const total = lines.reduce((n, l) => n + l.qty * l.item.priceCents, 0);
  const units = lines.reduce((n, l) => n + l.qty, 0);

  if (reviewing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
        <View style={s.reviewHead}>
          <Pressable onPress={() => setReviewing(false)} hitSlop={12} accessibilityLabel="Back to scanning">
            <Ionicons name="chevron-back" size={26} color={colors.accentDeep} />
          </Pressable>
          <T variant="h2" style={{ flex: 1 }}>
            Review {lines.length} scanned
          </T>
        </View>
        <FlatList
          data={lines}
          keyExtractor={(l) => l.item.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          ListEmptyComponent={<EmptyState icon="barcode-outline" title="Nothing scanned yet" />}
          renderItem={({ item: l }) => (
            <View style={s.reviewRow}>
              <ProductImage url={l.item.imageUrl} name={l.item.name} size={56} />
              <View style={{ flex: 1, gap: 4 }}>
                <T variant="h3" numberOfLines={2}>
                  {l.item.name}
                </T>
                <T variant="small">
                  {money(l.item.priceCents)} · {l.item.stockLabel}
                </T>
                <QtyStepper
                  compact
                  value={l.qty}
                  rules={shop.qtyRules(l.item)}
                  onChange={(qty) => setLines((p) => p.map((x) => (x.item.id === l.item.id ? { ...x, qty } : x)))}
                  onRemove={() => setLines((p) => p.filter((x) => x.item.id !== l.item.id))}
                />
              </View>
            </View>
          )}
        />
        <View style={[s.bottom, { paddingBottom: insets.bottom + space.md }]}>
          <T variant="muted">
            {units} units · {money(total)}
          </T>
          <Button title={`Add ${lines.length} items to cart`} disabled={lines.length === 0} loading={add.isPending} onPress={addAll} />
        </View>
      </View>
    );
  }

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top + space.xl, padding: space.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" style={{ alignSelf: "flex-end" }}>
          <Ionicons name="close" size={28} color={colors.ink} />
        </Pressable>
        <EmptyState
          icon="barcode-outline"
          title="Scan barcodes to reorder"
          body="Allow the camera to scan a bottle's UPC or a case barcode. The camera is only used for scanning; no photos are taken or stored."
          action={
            <View style={{ gap: space.sm, alignSelf: "stretch" }}>
              {permission.canAskAgain ? (
                <Button title="Allow camera" onPress={requestPermission} />
              ) : (
                <Button title="Open Settings" onPress={() => Linking.openSettings()} />
              )}
              <Button title="Type a barcode instead" kind="secondary" onPress={() => setTyping(true)} />
            </View>
          }
        />
        {typing ? (
          <TextInput
            autoFocus
            value={typed}
            onChangeText={setTyped}
            placeholder="UPC or SKU"
            keyboardType="default"
            style={s.typeInput}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (typed.trim()) {
                last.current = null;
                void onCode(typed.trim());
              }
              setTyped("");
            }}
          />
        ) : null}
        {lines.length > 0 ? <Button title={`Review ${lines.length} scanned`} onPress={() => setReviewing(true)} /> : null}
        {toast ? <T style={{ color: toast.tone === "pos" ? colors.pos : colors.neg, textAlign: "center" }}>{toast.text}</T> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8", "itf14", "code128"] }}
        onBarcodeScanned={({ data }) => void onCode(data)}
      />
      <View style={[s.top, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close scanner">
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Scan your shelf</Text>
        <Pressable onPress={() => setTyping(!typing)} hitSlop={12} accessibilityLabel="Type a barcode">
          <Ionicons name="keypad-outline" size={24} color="#fff" />
        </Pressable>
      </View>
      {typing ? (
        <View style={{ padding: space.lg }}>
          <TextInput
            autoFocus
            value={typed}
            onChangeText={setTyped}
            placeholder="Type a UPC or SKU"
            placeholderTextColor={colors.muted}
            style={s.typeInput}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (typed.trim()) {
                last.current = null;
                void onCode(typed.trim());
              }
              setTyped("");
            }}
          />
        </View>
      ) : (
        <View style={s.frame} pointerEvents="none" />
      )}
      {toast ? (
        <View style={[s.toast, { backgroundColor: toast.tone === "pos" ? colors.accent : colors.neg }]}>
          <Ionicons name={toast.tone === "pos" ? "checkmark-circle" : "alert-circle"} size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "600", flexShrink: 1 }} numberOfLines={2}>
            {toast.text}
          </Text>
        </View>
      ) : null}
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        {lines.length === 0 ? (
          <T variant="muted" style={{ textAlign: "center" }}>
            {lookup.isPending ? "Looking it up…" : "Hold a barcode inside the frame. Scan as many items as you like."}
          </T>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <T variant="h3" style={{ flex: 1 }}>
                {lines.length} items · {units} units
              </T>
              <T variant="h3">{money(total)}</T>
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title="Review" kind="secondary" style={{ flex: 1 }} onPress={() => setReviewing(true)} />
              <Button title="Add all to cart" style={{ flex: 1.4 }} loading={add.isPending} onPress={addAll} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  frame: {
    alignSelf: "center",
    marginTop: "28%",
    width: "80%",
    height: 170,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.9)",
  },
  toast: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: 190,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.page,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    padding: space.lg,
    gap: space.md,
    minHeight: 130,
    justifyContent: "center",
  },
  typeInput: {
    backgroundColor: colors.page,
    borderRadius: radius.md,
    height: 50,
    paddingHorizontal: space.md,
    fontSize: 17,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    marginVertical: space.md,
  },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.lg, paddingBottom: 0 },
  reviewRow: {
    flexDirection: "row",
    gap: space.md,
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  bottom: {
    padding: space.lg,
    gap: space.sm,
    backgroundColor: colors.page,
    borderTopWidth: 1,
    borderColor: colors.lineSoft,
  },
});
