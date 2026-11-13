import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, View } from "react-native";
import * as pay from "@contracts/routes/portal/pay";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { Button, Card, Chip, Empty, ErrorState, Loading, Pill, Row, T, styles } from "@/components/ui";
import { absoluteUrl } from "@/config";
import { day, money } from "@/lib/format";
import { track, useTrackView } from "@/lib/analytics";
import { colors, space } from "@/theme";

type Tab = (typeof pay.PORTAL_INVOICE_TABS)[number];

/**
 * Open invoices with what's due, and Pay: the ERP makes one pay link for the ticked invoices and the app opens its
 * hosted checkout (ACH or card) in the browser, the same page the web portal and payment emails use.
 */
export default function Invoices() {
  const [tab, setTab] = useState<Tab>("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = useApi(pay.listInvoices, { query: { tab, limit: 100 } });
  const payInvoices = useApiMutation(pay.payInvoices);
  useTrackView("invoices_view");

  const rows = q.data?.rows ?? [];
  const chosen = rows.filter((r) => picked.has(r.id));
  const chosenCents = chosen.reduce((n, r) => n + BigInt(r.balanceCents), 0n);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const payNow = () =>
    payInvoices.mutate(
      { body: { invoiceIds: chosen.map((r) => r.id) } },
      {
        onSuccess: async (r) => {
          track("checkout_redirect", { kind: "invoices", count: chosen.length, amount_cents: String(chosenCents) });
          await WebBrowser.openBrowserAsync(absoluteUrl(r.url) ?? r.url);
          track("payment_returned", { kind: "invoices" });
          setPicked(new Set());
          void q.refetch();
        },
        onError: (e) => Alert.alert("Couldn't start the payment", messageOf(e)),
      },
    );

  const header = q.data ? (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <Card>
        <Row strong label="Total due" value={money(q.data.totalDueCents)} />
        <Row label="Terms" value={q.data.terms.label} />
        {q.data.aging.days_1_30 !== "0" || q.data.aging.current !== q.data.totalDueCents ? (
          <T variant="small">
            Current {money(q.data.aging.current)} · overdue {money(BigInt(q.data.totalDueCents) - BigInt(q.data.aging.current))}
          </T>
        ) : null}
      </Card>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {(["open", "paid", "all"] as const).map((t) => (
          <Chip
            key={t}
            label={`${t === "open" ? "Open" : t === "paid" ? "Paid" : "All"} ${q.data.counts[t]}`}
            active={tab === t}
            onPress={() => {
              setTab(t);
              setPicked(new Set());
            }}
          />
        ))}
      </ScrollView>
    </View>
  ) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        refreshing={q.isRefetching}
        onRefresh={() => void q.refetch()}
        renderItem={({ item: r }) => {
          const on = picked.has(r.id);
          return (
            <Pressable
              disabled={!r.payable}
              onPress={() => toggle(r.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: !r.payable }}
              style={[styles.card, on && { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentTint }]}
            >
              <View style={styles.row}>
                <T variant="h3" style={{ flex: 1 }}>
                  {r.number}
                </T>
                <Pill
                  label={r.statusLabel}
                  tone={r.status === "overdue" ? "neg" : r.status === "paid" ? "pos" : r.status === "part_paid" ? "warn" : "neutral"}
                />
              </View>
              <View style={styles.row}>
                <T variant="muted" style={{ flex: 1 }}>
                  {day(r.invoiceDate)} · due {day(r.dueDate, false)}
                  {r.orderNumber ? ` · ${r.orderNumber}` : ""}
                </T>
                <T variant="h3">{money(r.balanceCents !== "0" ? r.balanceCents : r.totalCents)}</T>
              </View>
              {r.payable ? <T variant="small">{on ? "Selected to pay" : "Tap to select"}</T> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          q.isPending ? (
            <Loading />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <Empty title={tab === "open" ? "You're all paid up" : "No invoices here"} />
          )
        }
      />
      {chosen.length > 0 ? (
        <View style={{ padding: space.lg, backgroundColor: colors.page, borderTopWidth: 1, borderColor: colors.lineSoft }}>
          <Button title={`Pay ${money(chosenCents)}`} loading={payInvoices.isPending} onPress={payNow} />
        </View>
      ) : null}
    </View>
  );
}
