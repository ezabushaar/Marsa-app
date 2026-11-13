import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ResponseOf } from "@contracts/http";
import * as shop from "@contracts/routes/portal/shop";
import { ApiError, messageOf } from "@/api/client";
import { CART_DEPENDENTS, useApi, useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Banner, Button, Card, Divider, ErrorState, Field, Loading, Row, Screen, Section, T } from "@/components/ui";
import { money } from "@/lib/format";
import { track, useTrackView } from "@/lib/analytics";
import { colors, radius, space } from "@/theme";

type Pay = (typeof shop.PREFERRED_PAYMENTS)[number];
const PAY_LABELS: Record<Pay, string> = { ach: "Bank transfer (ACH)", card: "Card", terms: "Net terms" };

function Choice({
  selected,
  title,
  sub,
  onPress,
  disabled,
}: {
  selected: boolean;
  title: string;
  sub?: string | null;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={{
        flexDirection: "row",
        gap: space.md,
        alignItems: "center",
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.accentTint : colors.page,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? colors.accent : colors.ghost,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="h3">{title}</T>
        {sub ? <T variant="small">{sub}</T> : null}
      </View>
    </Pressable>
  );
}

export default function Checkout() {
  const { quote: quoteId } = useLocalSearchParams<{ quote?: string }>();
  const cartQ = useApi(shop.getCart);
  const methodsQ = useApi(shop.shippingMethods);
  const quoteQ = useApi(shop.getQuote, { params: { id: quoteId ?? "" } }, { enabled: !!quoteId });
  if (cartQ.isPending || methodsQ.isPending || (quoteId && quoteQ.isPending)) return <Loading />;
  if (cartQ.isError) return <ErrorState error={cartQ.error} onRetry={() => void cartQ.refetch()} />;
  if (quoteQ.isError) return <ErrorState error={quoteQ.error} onRetry={() => void quoteQ.refetch()} />;
  return <CheckoutForm cart={cartQ.data} methods={methodsQ.data?.rows ?? []} quote={quoteQ.data} />;
}

function defaultPayment(cart: { terms: { offered: boolean }; lastPayment: Pay | null }): Pay {
  if (cart.terms.offered) return "terms";
  if (cart.lastPayment && cart.lastPayment !== "terms") return cart.lastPayment;
  return "ach";
}

/**
 * Sending the cart to Marsa (a Submitted order: nothing reserved or charged), or accepting a quote the same way
 * (`quote`): ship-to or pickup, shipping method, how they'd like to pay, PO, coupon and notes.
 */
function CheckoutForm({
  cart,
  methods: allMethods,
  quote,
}: {
  cart: ResponseOf<typeof shop.getCart>;
  methods: ResponseOf<typeof shop.shippingMethods>["rows"];
  quote?: ResponseOf<typeof shop.getQuote>;
}) {
  const { can } = useSession();
  const shipTos = cart.addresses.filter((a) => a.kind === "ship_to");
  const pickupOffered = allMethods.some((m) => m.pickup) || allMethods.length === 0;
  const methods = allMethods.filter((m) => !m.pickup);
  const [ship, setShip] = useState(shipTos.find((a) => a.isDefault)?.id ?? shipTos[0]?.id ?? "");
  const [methodId, setMethodId] = useState(cart.estimate?.freight.method?.id ?? methods[0]?.id ?? "");
  const [po, setPo] = useState("");
  const [notes, setNotes] = useState("");
  const [coupon, setCoupon] = useState("");
  const [pay, setPay] = useState<Pay>(() => defaultPayment(cart));
  const submitCart = useApiMutation(shop.submitCart, { invalidates: [...CART_DEPENDENTS, shop.listOrders] });
  const acceptQuote = useApiMutation(shop.acceptQuote, {
    invalidates: [shop.listOrders, shop.listQuotes, shop.getQuote],
  });
  const submit = quote ? acceptQuote : submitCart;
  useTrackView("checkout_view", { lines: cart.summary.lines, items_cents: cart.summary.itemsCents, quote: !!quote });
  const itemsCents = quote ? quote.totalCents : cart.summary.itemsCents;

  const pickup = ship === "pickup";
  const chosen = methods.find((m) => m.id === methodId);
  const termsShown = cart.terms.offered || cart.terms.reason === "overdue";

  const send = () => {
    if (!ship) return;
    const body = {
          ...(pickup
            ? { pickup: true }
            : chosen
              ? { shipToAddressId: ship, shippingMethodId: chosen.id }
              : { shipToAddressId: ship, shipMethod: "freight_quote_later" as const }),
          customerPo: po.trim() || null,
          notes: notes.trim() || null,
          preferredPayment: pay,
          ...(coupon.trim() ? { couponCode: coupon.trim().toUpperCase() } : {}),
    };
    if (body.couponCode) track("coupon_apply", { code: body.couponCode, on_send: true });
    const failed = (e: unknown) =>
      track("order_submit_error", { code: e instanceof ApiError ? e.code : "unknown", payment: pay, quote: !!quote });
    const done = (r: { order: { id: string } }) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/placed/[id]", params: { id: r.order.id } });
    };
    if (quote) acceptQuote.mutate({ params: { id: quote.id }, body }, { onSuccess: done, onError: failed });
    else submitCart.mutate({ body }, { onSuccess: done, onError: failed });
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Section title="1. Ship to">
          {shipTos.length === 0 ? (
            <Banner tone="warn">
              {can("team")
                ? "No delivery address on file yet. Add one below, or choose pick up."
                : "No delivery address on file. Ask your account owner to add one, or choose pick up."}
            </Banner>
          ) : null}
          {shipTos.map((a) => (
            <Choice
              key={a.id}
              selected={ship === a.id}
              onPress={() => setShip(a.id)}
              title={a.label ?? "Ship-to address"}
              sub={[a.line1, a.line2, `${a.city}, ${a.state} ${a.postalCode}`].filter(Boolean).join(" · ")}
            />
          ))}
          {pickupOffered ? (
            <Choice
              selected={pickup}
              onPress={() => setShip("pickup")}
              title="Pick up at the warehouse"
              sub="No freight. We'll message you when it's ready."
            />
          ) : null}
          {can("team") ? (
            <Button title="Add a ship-to address" kind="ghost" onPress={() => router.push("/address-edit")} />
          ) : null}
        </Section>

        {!pickup && methods.length > 0 ? (
          <Section title="2. Shipping">
            {methods.map((m) => (
              <Choice
                key={m.id}
                selected={methodId === m.id}
                onPress={() => setMethodId(m.id)}
                title={m.name}
                sub={
                  m.chargeCents === null
                    ? (m.description ?? "We'll quote it")
                    : m.chargeCents === "0"
                      ? "Free"
                      : `${money(m.chargeCents)}${m.freeOverCents ? ` · free over ${money(m.freeOverCents)}` : ""}`
                }
              />
            ))}
          </Section>
        ) : null}

        <Section title="3. How you'd like to pay">
          {(["ach", "card"] as const).map((p) => (
            <Choice key={p} selected={pay === p} onPress={() => setPay(p)} title={PAY_LABELS[p]} />
          ))}
          {termsShown ? (
            <Choice
              selected={pay === "terms"}
              disabled={!cart.terms.offered}
              onPress={() => setPay("terms")}
              title={`${PAY_LABELS.terms} (${cart.terms.label})`}
              sub={cart.terms.offered ? null : cart.terms.message}
            />
          ) : null}
          <T variant="small">Nothing is charged now. You pay once Marsa confirms the order.</T>
        </Section>

        <Section title="4. Details">
          <Field label="Your PO number (optional)" value={po} onChangeText={setPo} maxLength={100} />
          {quote ? null : (
            <Field
              label="Coupon (optional)"
              value={coupon}
              onChangeText={setCoupon}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
            />
          )}
          <Field label="Notes for Marsa (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
        </Section>

        <Card>
          <Row label={quote ? `Quote ${quote.number}` : "Items"} value={money(itemsCents)} />
          {!quote && cart.estimate && cart.estimate.discountCents !== "0" ? (
            <Row label="Discounts" value={`−${money(cart.estimate.discountCents)}`} />
          ) : null}
          <Row
            label="Freight"
            value={
              pickup
                ? "Pick up"
                : chosen?.chargeCents == null
                  ? "Quoted by Marsa"
                  : chosen.freeOverCents && BigInt(itemsCents) >= BigInt(chosen.freeOverCents)
                    ? "Free"
                    : money(chosen.chargeCents)
            }
          />
          <Row label="Tax" value={cart.estimate?.tax.label ?? "Added when we confirm"} />
          <Divider />
          <T variant="small">Marsa confirms stock, freight and tax, then you'll see the final total on the order.</T>
        </Card>

        {submit.isError ? <Banner tone="neg">{messageOf(submit.error)}</Banner> : null}
      </Screen>
      <View style={{ padding: space.lg, backgroundColor: colors.page, borderTopWidth: 1, borderColor: colors.lineSoft }}>
        <Button
          title={quote ? `Accept and order · ${money(itemsCents)}` : `Send order · ${money(itemsCents)}`}
          loading={submit.isPending}
          disabled={!ship || (!quote && !cart.summary.canSubmit)}
          onPress={send}
        />
      </View>
    </View>
  );
}
