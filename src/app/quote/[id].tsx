import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { Banner, Button, Card, Divider, ErrorState, Field, Loading, Pill, Row, Screen, Section, T } from "@/components/ui";
import { day, money, plural } from "@/lib/format";
import { colors, space } from "@/theme";

/** One quote from Marsa: the lines at quoted prices, then accept (it becomes an order), decline or ask for changes. */
export default function Quote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi(shop.getQuote, { params: { id } });
  const decline = useApiMutation(shop.declineQuote, { invalidates: [shop.getQuote, shop.listQuotes] });
  const ask = useApiMutation(shop.askQuoteChanges);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const quote = q.data;
  const waiting = quote.status === "waiting_for_you";

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: quote.number }} />
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <T variant="title" style={{ flex: 1 }}>
            {money(quote.totalCents)}
          </T>
          <Pill label={quote.statusLabel} tone={waiting ? "warn" : quote.status === "accepted" ? "pos" : "neutral"} />
        </View>
        <T variant="muted">
          {quote.from ? `From ${quote.from}` : "From Marsa"}
          {quote.sentOn ? ` · sent ${day(quote.sentOn, false)}` : ""} · valid to {day(quote.validUntil)}
        </T>
      </View>

      {quote.note ? <Banner tone="info">{quote.note}</Banner> : null}
      {quote.order ? (
        <Button
          title={`View order ${quote.order.number}`}
          kind="secondary"
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: quote.order?.id ?? "" } })}
        />
      ) : null}

      <Section title={plural(quote.lines.length, "item")}>
        <Card>
          {quote.lines.map((l, i) => (
            <View key={l.id} style={{ gap: 4 }}>
              {i > 0 ? <Divider /> : null}
              <T variant="h3">{l.name}</T>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                <T variant="small" style={{ flex: 1 }}>
                  {l.quantity} × {money(l.quotedPriceCents)}
                  {l.usualPriceCents && l.usualPriceCents > l.quotedPriceCents ? (
                    <T variant="small" style={{ textDecorationLine: "line-through" }}>
                      {" "}
                      {money(l.usualPriceCents)}
                    </T>
                  ) : null}
                </T>
                <T variant="h3">{money(l.totalCents)}</T>
              </View>
            </View>
          ))}
          <Divider />
          <Row strong label="Quote total" value={money(quote.totalCents)} />
          <T variant="small">Freight and tax are confirmed with the order.</T>
        </Card>
      </Section>

      {quote.canAccept ? (
        <Button
          title="Accept and order"
          onPress={() => router.push({ pathname: "/checkout", params: { quote: quote.id } })}
        />
      ) : null}

      {waiting ? (
        ask.isSuccess ? (
          <Banner tone="pos">Sent. {ask.data.to === "rep" ? "Your rep" : "The Marsa team"} will get back to you.</Banner>
        ) : asking ? (
          <Card>
            <Field
              label="What would you like changed?"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={2000}
              autoFocus
            />
            {ask.isError ? <Banner tone="neg">{messageOf(ask.error)}</Banner> : null}
            <Button
              title="Send to Marsa"
              disabled={!message.trim()}
              loading={ask.isPending}
              onPress={() => ask.mutate({ params: { id: quote.id }, body: { message: message.trim() } })}
            />
          </Card>
        ) : (
          <Button title="Ask for changes" kind="secondary" onPress={() => setAsking(true)} />
        )
      ) : null}

      {waiting ? (
        <Button
          title="Decline quote"
          kind="ghost"
          loading={decline.isPending}
          style={{ marginTop: space.sm }}
          onPress={() =>
            Alert.alert("Decline this quote?", "Marsa will see that you passed on it.", [
              { text: "Keep it", style: "cancel" },
              {
                text: "Decline",
                style: "destructive",
                onPress: () =>
                  decline.mutate(
                    { params: { id: quote.id }, body: {} },
                    { onError: (e) => Alert.alert("Couldn't decline", messageOf(e)) },
                  ),
              },
            ])
          }
        />
      ) : null}
      <View style={{ height: 1, backgroundColor: colors.canvas }} />
    </Screen>
  );
}
