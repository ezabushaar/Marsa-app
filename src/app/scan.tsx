import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { z } from "zod";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApiMutation } from "@/api/hooks";
import { ProductImage } from "@/components/ProductImage";
import { QtyStepper } from "@/components/QtyStepper";
import { Button, Empty, T } from "@/components/ui";
import { money } from "@/lib/format";
import { colors, radius, space } from "@/theme";

type ScannedItem = NonNullable<z.infer<typeof shop.lookupLine>["item"]>;

/**
 * Scan to order: point the camera at a bottle's UPC or a case barcode, set the quantity, add it, scan the next.
 * The ERP's order-sheet lookup answers the item at this customer's price with its quantity rules.
 */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const lookup = useApiMutation(shop.lookup);
  const add = useApiMutation(shop.addCartLines, { invalidates: CART_DEPENDENTS });
  const [found, setFound] = useState<{ code: string; item: ScannedItem; qty: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingBottom: insets.bottom }}>
        <Empty
          title="Scan barcodes to reorder"
          body="Allow camera access to scan a bottle's UPC or a case barcode and add it to your cart."
          action={<Button title="Allow camera" onPress={requestPermission} />}
        />
      </View>
    );
  }

  const onScan = async (code: string) => {
    const now = Date.now();
    if (busy.current || found) return;
    if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < 2500) return;
    lastCode.current = { code, at: now };
    busy.current = true;
    setProblem(null);
    try {
      const r = await lookup.mutateAsync({ body: { lines: [{ code, quantity: null }] } });
      const line = r.lines[0];
      if (line?.item) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const rules = shop.qtyRules(line.item);
        setFound({ code, item: line.item, qty: line.quantity ?? rules.start });
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setProblem(line?.problem?.message ?? `No item has the code ${code}.`);
      }
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      busy.current = false;
    }
  };

  const confirm = async () => {
    if (!found) return;
    try {
      await add.mutateAsync({ body: { lines: [{ productId: found.item.id, quantity: found.qty }] } });
      setAdded((a) => [...a, `${found.qty} × ${found.item.name}`]);
      setFound(null);
    } catch (e) {
      setProblem(messageOf(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8", "itf14", "code128"] }}
        onBarcodeScanned={found ? undefined : ({ data }) => void onScan(data)}
      />
      <View style={[s.top, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
          {added.length ? `${added.length} added` : "Scan a UPC or case barcode"}
        </Text>
        <Pressable onPress={() => router.replace("/cart")} hitSlop={12}>
          <Text style={{ color: colors.panelMint, fontWeight: "700" }}>Cart</Text>
        </Pressable>
      </View>
      <View style={s.frame} pointerEvents="none" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        {found ? (
          <>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <ProductImage url={found.item.imageUrl} name={found.item.name} size={72} />
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="small">{found.item.brand.name}</T>
                <T variant="h3" numberOfLines={2}>
                  {found.item.name}
                </T>
                <T>
                  {money(found.item.priceCents)} · <T variant="small">{found.item.stockLabel}</T>
                </T>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <QtyStepper
                value={found.qty}
                rules={shop.qtyRules(found.item)}
                onChange={(qty) => setFound({ ...found, qty })}
              />
              <Button title="Add to cart" style={{ flex: 1 }} loading={add.isPending} onPress={confirm} />
            </View>
            <Button title="Skip" kind="ghost" onPress={() => setFound(null)} />
          </>
        ) : problem ? (
          <>
            <T variant="h3">{problem}</T>
            <Button title="Scan again" kind="secondary" onPress={() => setProblem(null)} />
          </>
        ) : (
          <T variant="muted" style={{ textAlign: "center" }}>
            {lookup.isPending ? "Looking it up…" : added.length ? `Last: ${added[added.length - 1]}` : "Hold the barcode inside the frame."}
          </T>
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
    marginTop: "30%",
    width: "78%",
    height: 160,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.9)",
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
    minHeight: 120,
    justifyContent: "center",
  },
});
