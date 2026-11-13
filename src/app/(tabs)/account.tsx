import * as Application from "expo-application";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as pay from "@contracts/routes/portal/pay";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { ListGroup, ListItem } from "@/components/kit";
import { Button, Screen, T } from "@/components/ui";
import { LEGAL } from "@/config";
import { money } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { shareReferral } from "@/lib/referral";
import { colors, radius, space } from "@/theme";

/** Everything about the store and the person: money, ordering tools, store settings, help and legal. */
export default function Account() {
  const { me, can, signOut } = useSession();
  const shops = can("shop");
  const pays = can("pay");
  const owner = can("team");
  const invoices = useApi(pay.listInvoices, { query: { tab: "open", limit: 1 } }, { enabled: pays });
  const credit = useApi(pay.getStoreCredit, undefined, { enabled: pays });
  const follows = useApi(shop.listFollows, undefined, { enabled: shops });
  const rep = useApi(shop.rep);
  if (!me) return null;

  const backInStock = (follows.data?.rows ?? []).filter((f) => f.stock !== "out_of_stock").length;
  const initials = me.user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const open = (url: string) => void WebBrowser.openBrowserAsync(url);

  return (
    <Screen>
      <View style={s.profile}>
        <View style={s.avatar}>
          <Text style={{ color: colors.accentDeep, fontSize: 20, fontWeight: "700" }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <T variant="h2">{me.user.name}</T>
          <T variant="small">
            {ROLE_LABELS[me.user.role].label} at {me.customer.name}
          </T>
          <T variant="small">{me.user.email}</T>
        </View>
      </View>

      {pays ? (
        <ListGroup title="Money">
          <ListItem
            icon="document-text-outline"
            label="Invoices and payments"
            detail={invoices.data ? `${money(invoices.data.totalDueCents)} due` : undefined}
            onPress={() => router.push("/invoices")}
          />
          {credit.data && credit.data.balanceCents !== "0" ? (
            <ListItem icon="wallet-outline" label="Store credit" detail={money(credit.data.balanceCents)} onPress={() => router.push("/invoices")} />
          ) : null}
        </ListGroup>
      ) : null}

      {shops ? (
        <ListGroup title="Ordering">
          <ListItem icon="bookmark-outline" label="Saved lists" onPress={() => router.push("/lists")} />
          <ListItem
            icon="notifications-outline"
            label="Restock alerts"
            badge={backInStock || undefined}
            onPress={() => router.push("/alerts")}
          />
          <ListItem icon="pricetags-outline" label="Clearance deals" onPress={() => router.push("/deals")} />
          <ListItem icon="return-down-back-outline" label="Returns" onPress={() => router.push("/returns")} />
        </ListGroup>
      ) : null}

      <ListGroup title="Your store">
        <ListItem icon="storefront-outline" label="Business details" detail={me.customer.number} onPress={() => router.push("/business")} />
        {owner ? <ListItem icon="location-outline" label="Addresses" onPress={() => router.push("/addresses")} /> : null}
        {owner ? <ListItem icon="people-outline" label="Your team" onPress={() => router.push("/team")} /> : null}
        <ListItem icon="chatbubbles-outline" label="Notifications" onPress={() => router.push("/notifications")} />
        <ListItem icon="key-outline" label="Change password" onPress={() => router.push("/password")} />
      </ListGroup>

      <ListGroup title="Help">
        {rep.data?.whatsappUrl ? (
          <ListItem
            icon="logo-whatsapp"
            label={rep.data.rep ? `WhatsApp ${rep.data.rep.firstName}` : "WhatsApp Marsa"}
            onPress={() => Linking.openURL(rep.data.whatsappUrl as string)}
          />
        ) : null}
        {rep.data?.email ? (
          <ListItem icon="mail-outline" label="Email" detail={rep.data.email} onPress={() => Linking.openURL(`mailto:${rep.data.email}`)} />
        ) : null}
        <ListItem
          icon="gift-outline"
          label="Invite another store"
          onPress={() => void shareReferral(me.customer.number, "account")}
        />
        <ListItem icon="car-outline" label="Shipping policy" onPress={() => open(LEGAL.shipping)} />
        <ListItem icon="refresh-outline" label="Returns policy" onPress={() => open(LEGAL.returns)} />
      </ListGroup>

      <ListGroup title="Legal">
        <ListItem icon="shield-checkmark-outline" label="Privacy policy" onPress={() => open(LEGAL.privacy)} />
        <ListItem icon="reader-outline" label="Terms and conditions" onPress={() => open(LEGAL.terms)} />
        <ListItem icon="options-outline" label="Privacy choices" onPress={() => router.push("/privacy-choices")} />
        <ListItem icon="trash-outline" label="Delete account" tone="danger" onPress={() => router.push("/delete-account")} />
      </ListGroup>

      <Button
        title="Sign out"
        kind="secondary"
        onPress={() =>
          Alert.alert("Sign out?", "You'll need your password to sign back in.", [
            { text: "Stay", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => void signOut() },
          ])
        }
      />
      <Pressable accessible={false}>
        <T variant="small" style={{ textAlign: "center" }}>
          Marsa Wholesale {Application.nativeApplicationVersion ?? ""}
          {Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ""}
        </T>
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.page,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
