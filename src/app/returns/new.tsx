import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { call, messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { QtyStepper } from "@/components/QtyStepper";
import { Banner, Button, Card, Chip, Divider, ErrorState, Field, Loading, Screen, Section, T } from "@/components/ui";
import { day } from "@/lib/format";
import { colors, radius, space } from "@/theme";

type Reason = (typeof account.RETURN_REASONS)[number];
const REASONS: { value: Reason; label: string }[] = [
  { value: "damaged_in_transit", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "not_as_described", label: "Not as described" },
  { value: "ordered_by_mistake", label: "Ordered by mistake" },
];

interface Pick {
  quantity: number;
  reason: Reason;
}

/** Start a return from a delivered order: what's coming back, why, credit or replacement, and photos of damage. */
export default function NewReturn() {
  const { order } = useLocalSearchParams<{ order: string }>();
  const q = useApi(account.returnableLines, { params: { id: order } });
  const submit = useApiMutation(account.requestReturn, { invalidates: [account.listReturns] });
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [outcome, setOutcome] = useState<(typeof account.RETURN_OUTCOMES)[number]>("credit");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ uri: string; id?: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const chosen = Object.entries(picks).filter(([, p]) => p.quantity > 0);
  const damaged = chosen.some(([, p]) => p.reason === "damaged_in_transit");

  const addPhoto = async (fromCamera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 6 });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => ({ uri: a.uri }))].slice(0, 20));
  };

  const send = async () => {
    setUploading(true);
    try {
      const ids: string[] = [];
      for (const [i, p] of photos.entries()) {
        if (p.id) {
          ids.push(p.id);
          continue;
        }
        const blob = await (await fetch(p.uri)).blob();
        const stored = await call(account.uploadFile, {
          query: { purpose: "return", name: `return-photo-${i + 1}.jpg` },
          body: blob as never,
        });
        ids.push(stored.id);
        setPhotos((prev) => prev.map((x) => (x.uri === p.uri ? { ...x, id: stored.id } : x)));
      }
      await submit.mutateAsync({
        body: {
          orderId: r.order.id,
          lines: chosen.map(([deliveryLineId, p]) => ({ deliveryLineId, quantity: p.quantity, reason: p.reason })),
          outcome,
          note: note.trim() || null,
          ...(ids.length ? { photoFileIds: ids } : {}),
        },
      });
      Alert.alert("Return requested", "Marsa reviews it and sends an RMA number. You can follow it under Account › Returns.", [
        { text: "OK", onPress: () => router.replace("/returns") },
      ]);
    } catch (e) {
      Alert.alert("Couldn't send the return", messageOf(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <T variant="muted">
          Order {r.order.number} · returns within {r.windowDays} days of delivery
        </T>
        {r.deliveries.map((d) => (
          <Section key={d.id} title={`Shipment ${d.number}`}>
            <T variant="small">
              Delivered {day(d.deliveredOn, false)} · {d.late ? "past the window (your rep approves)" : `open until ${day(d.openUntil, false)}`}
            </T>
            <Card>
              {d.lines.map((l, i) => {
                const p = picks[l.deliveryLineId] ?? { quantity: 0, reason: "damaged_in_transit" as Reason };
                const set = (patch: Partial<Pick>) => setPicks((all) => ({ ...all, [l.deliveryLineId]: { ...p, ...patch } }));
                return (
                  <View key={l.deliveryLineId} style={{ gap: space.sm }}>
                    {i > 0 ? <Divider /> : null}
                    <T variant="h3">{l.name}</T>
                    <T variant="small">
                      Shipped {l.shippedQty}
                      {l.returnedQty ? ` · already returned ${l.returnedQty}` : ""} · up to {l.returnableQty} can come back
                    </T>
                    {l.returnableQty > 0 ? (
                      p.quantity === 0 ? (
                        <Button title="Return some" kind="secondary" onPress={() => set({ quantity: 1 })} />
                      ) : (
                        <>
                          <QtyStepper
                            value={p.quantity}
                            rules={{ min: 1, max: l.returnableQty, step: 1 }}
                            onChange={(n) => set({ quantity: n })}
                            onRemove={() => set({ quantity: 0 })}
                          />
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                            {REASONS.map((x) => (
                              <Chip key={x.value} label={x.label} active={p.reason === x.value} onPress={() => set({ reason: x.value })} />
                            ))}
                          </ScrollView>
                        </>
                      )
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </Section>
        ))}

        {chosen.length > 0 ? (
          <>
            <Section title="What would you like?">
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Chip label="Credit to my account" active={outcome === "credit"} onPress={() => setOutcome("credit")} />
                <Chip label="Replacement" active={outcome === "replacement"} onPress={() => setOutcome("replacement")} />
              </View>
            </Section>
            <Section title={damaged ? "Photos of the damage (required)" : "Photos (optional)"}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {photos.map((p) => (
                  <Pressable
                    key={p.uri}
                    onLongPress={() => setPhotos((all) => all.filter((x) => x.uri !== p.uri))}
                    accessibilityLabel="Photo; press and hold to remove"
                  >
                    <Image source={{ uri: p.uri }} style={{ width: 76, height: 76, borderRadius: radius.md }} />
                  </Pressable>
                ))}
                <Pressable style={photoBtn} onPress={() => void addPhoto(true)} accessibilityLabel="Take a photo">
                  <Ionicons name="camera-outline" size={24} color={colors.accent} />
                </Pressable>
                <Pressable style={photoBtn} onPress={() => void addPhoto(false)} accessibilityLabel="Choose photos">
                  <Ionicons name="images-outline" size={24} color={colors.accent} />
                </Pressable>
              </View>
              {photos.length ? <T variant="small">Press and hold a photo to remove it.</T> : null}
            </Section>
            <Field label="Anything else? (optional)" value={note} onChangeText={setNote} multiline maxLength={1000} />
            {damaged && photos.length === 0 ? <Banner tone="warn">Add at least one photo of the damage.</Banner> : null}
          </>
        ) : null}
      </Screen>
      <View style={{ padding: space.lg, backgroundColor: colors.page, borderTopWidth: 1, borderColor: colors.lineSoft }}>
        <Button
          title="Send return request"
          disabled={chosen.length === 0 || (damaged && photos.length === 0)}
          loading={uploading || submit.isPending}
          onPress={() => void send()}
        />
      </View>
    </View>
  );
}

const photoBtn = {
  width: 76,
  height: 76,
  borderRadius: radius.md,
  borderWidth: 1,
  borderStyle: "dashed" as const,
  borderColor: colors.accentLine,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  backgroundColor: colors.accentTint,
};
