import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Banner, Button, Card, Screen, T } from "@/components/ui";
import { LEGAL, SUPPORT_EMAIL } from "@/config";
import { colors, space } from "@/theme";

/**
 * Account deletion, reachable from Account (App Store 5.1.1(v), Google Play account deletion policy). The request
 * goes to the customer's rep (or the wholesale desk) by email with the account named, and Marsa closes the sign-in
 * and removes personal details; invoices and orders stay on file as US tax law requires.
 */
export default function DeleteAccount() {
  const { me, signOut } = useSession();
  const rep = useApi(shop.rep);
  const [sent, setSent] = useState(false);
  if (!me) return null;
  const to = rep.data?.email ?? SUPPORT_EMAIL;
  const subject = `Delete my Marsa Wholesale account (${me.customer.number})`;
  const body = [
    "Please delete my Marsa Wholesale sign-in and the personal details tied to it.",
    "",
    `Name: ${me.user.name}`,
    `Email: ${me.user.email}`,
    `Store: ${me.customer.name} (${me.customer.number})`,
    `Role: ${me.user.role}`,
  ].join("\n");

  const request = async () => {
    const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      // openURL rather than canOpenURL: Android 11+ answers false for mailto without a manifest query entry.
      await Linking.openURL(url);
    } catch {
      await Clipboard.setStringAsync(`${to}\n\n${subject}\n\n${body}`);
      Alert.alert("No email app found", `We copied the request. Send it to ${to} from any email app.`);
    }
    setSent(true);
  };

  return (
    <Screen>
      <T variant="h2">Delete your account</T>
      <Card>
        <T>When Marsa deletes your account:</T>
        {[
          "Your sign-in is closed on every device and you can't sign in again.",
          "Your name, email, phone and preferences are removed.",
          "Orders, invoices and payments stay on file for your store, as US tax and accounting law requires.",
          me.user.role === "owner"
            ? "If you're the store's only owner, the store's wholesale account closes too. Open balances still need to be paid."
            : "Your store's account and the rest of its team aren't affected.",
        ].map((t) => (
          <View key={t} style={{ flexDirection: "row", gap: space.sm }}>
            <T style={{ color: colors.muted }}>•</T>
            <T style={{ flex: 1 }}>{t}</T>
          </View>
        ))}
      </Card>
      <T variant="muted">
        Marsa confirms by email once it's done. Our privacy policy ({LEGAL.privacy}) explains what we keep and why.
      </T>
      {sent ? (
        <Banner tone="pos">Request ready. Once you send the email, Marsa will confirm. You can sign out now.</Banner>
      ) : null}
      <Button title="Request account deletion" kind="danger" onPress={() => void request()} />
      {sent ? <Button title="Sign out" kind="secondary" onPress={() => void signOut()} /> : null}
    </Screen>
  );
}
