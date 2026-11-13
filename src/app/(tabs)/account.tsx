import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ComponentProps } from "react";
import { Alert, Linking, Pressable, Switch, View } from "react-native";
import * as auth from "@contracts/routes/portal/auth";
import * as pay from "@contracts/routes/portal/pay";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Button, Card, Divider, Row, Screen, Section, T } from "@/components/ui";
import { API_URL } from "@/config";
import { money } from "@/lib/format";
import { colors, space } from "@/theme";

function Item({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 }}>
      <Ionicons name={icon} size={22} color={colors.accent} />
      <T style={{ flex: 1 }}>{label}</T>
      {detail ? <T variant="muted">{detail}</T> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.ghost} />
    </Pressable>
  );
}

export default function Account() {
  const { me, can, signOut } = useSession();
  const invoices = useApi(pay.listInvoices, { query: { tab: "open", limit: 1 } }, { enabled: can("pay") });
  const credit = useApi(pay.getStoreCredit, undefined, { enabled: can("pay") });
  const rep = useApi(shop.rep);
  const prefs = useApiMutation(auth.updateNotifications, { invalidates: [auth.me] });
  if (!me) return null;

  const setPref = (body: { whatsappUpdates?: boolean; newArrivalsAlerts?: boolean }) =>
    prefs.mutate({ body }, { onError: (e) => Alert.alert("Couldn't save", messageOf(e)) });

  const openPortal = (path: string) => WebBrowser.openBrowserAsync(`${API_URL}${path}`);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T variant="title">{me.customer.name}</T>
        <T variant="muted">
          {me.user.name} · {me.user.email} · {me.customer.number}
        </T>
      </View>

      {can("pay") ? (
        <Section title="Billing">
          <Card>
            <Row strong label="Total due" value={invoices.data ? money(invoices.data.totalDueCents) : "…"} />
            {invoices.data ? <Row label="Terms" value={invoices.data.terms.label} /> : null}
            {credit.data && credit.data.balanceCents !== "0" ? (
              <Row label="Store credit" value={money(credit.data.balanceCents)} />
            ) : null}
            <Button title="Invoices and payments" kind="secondary" onPress={() => router.push("/invoices")} />
          </Card>
        </Section>
      ) : null}

      <Section title="Updates">
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T>Order updates on WhatsApp</T>
              <T variant="small">{me.user.phone ? `To ${me.user.phone}` : "Add your number in the web portal"}</T>
            </View>
            <Switch
              value={me.user.whatsappUpdates}
              disabled={!me.user.phone || prefs.isPending}
              onValueChange={(v) => setPref({ whatsappUpdates: v })}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Divider />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T>New arrival alerts</T>
              <T variant="small">Hear first when new fragrances land.</T>
            </View>
            <Switch
              value={me.user.newArrivalsAlerts}
              disabled={prefs.isPending}
              onValueChange={(v) => setPref({ newArrivalsAlerts: v })}
              trackColor={{ true: colors.accent }}
            />
          </View>
        </Card>
      </Section>

      <Section title="More in the web portal">
        <Card>
          {can("shop") ? <Item icon="document-text-outline" label="Quotes" onPress={() => openPortal("/quotes")} /> : null}
          {can("shop") ? <Item icon="return-down-back-outline" label="Start a return" onPress={() => openPortal("/returns/new")} /> : null}
          {can("team") ? <Item icon="location-outline" label="Addresses" onPress={() => openPortal("/account/addresses")} /> : null}
          {can("pay") ? <Item icon="card-outline" label="Payment methods" onPress={() => openPortal("/account/payment-methods")} /> : null}
          <Item icon="people-outline" label="Business, team and password" onPress={() => openPortal("/account")} />
          <T variant="small">These open wholesale.itsmarsa.com. Sign in there with the same email.</T>
        </Card>
      </Section>

      {rep.data && (rep.data.email || rep.data.whatsappUrl) ? (
        <Section title="Contact Marsa">
          <Card>
            {rep.data.rep ? <T variant="muted">Your rep: {rep.data.rep.name}</T> : null}
            {rep.data.whatsappUrl ? (
              <Item icon="logo-whatsapp" label="WhatsApp" onPress={() => Linking.openURL(rep.data.whatsappUrl as string)} />
            ) : null}
            {rep.data.email ? (
              <Item icon="mail-outline" label="Email" detail={rep.data.email} onPress={() => Linking.openURL(`mailto:${rep.data.email}`)} />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Button
        title="Sign out"
        kind="secondary"
        onPress={() =>
          Alert.alert("Sign out?", undefined, [
            { text: "Stay", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => void signOut() },
          ])
        }
      />
      <T variant="small" style={{ textAlign: "center" }}>
        Marsa Wholesale {Constants.expoConfig?.version ?? ""}
      </T>
    </Screen>
  );
}

