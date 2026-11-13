import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { useApi } from "@/api/hooks";
import { Banner, Card, Divider, ErrorState, Loading, Pill, Row, Screen, T } from "@/components/ui";
import { money } from "@/lib/format";
import { returnTone } from "@/lib/orders";
import { space } from "@/theme";

export default function ReturnDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(account.getReturn, { params: { id } });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: r.number ?? "Return request" }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <T variant="title" style={{ flex: 1 }}>
          {r.number ?? "Requested"}
        </T>
        <Pill label={r.statusLabel} tone={returnTone(r.status)} />
      </View>
      <T variant="muted">
        Order {r.orderNumber} · shipment {r.deliveryNumber}
      </T>
      {r.late ? <Banner tone="warn">Past the return window, so your rep approves this one.</Banner> : null}
      <Card>
        {r.lines.map((l, i) => (
          <View key={`${l.sku}-${i}`} style={{ gap: 2 }}>
            {i > 0 ? <Divider /> : null}
            <T variant="h3">{l.name}</T>
            <T variant="small">
              {l.quantity} · {l.reasonLabel}
              {l.receivedQty > 0 ? ` · ${l.receivedQty} received` : ""}
            </T>
          </View>
        ))}
      </Card>
      <Card>
        <Row label="You asked for" value={r.outcome === "credit" ? "Credit" : "Replacement"} />
        <Row label="Estimated credit" value={money(r.estimateCents)} />
        {r.creditNote ? <Row label={`Credit note ${r.creditNote.number ?? ""}`} value={money(r.creditNote.totalCents)} /> : null}
        {r.photos.length ? <Row label="Photos" value={String(r.photos.length)} /> : null}
        {r.note ? <T variant="muted">{r.note}</T> : null}
      </Card>
    </Screen>
  );
}
