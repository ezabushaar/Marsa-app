import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Linking, Platform, Switch, View } from "react-native";
import { Banner, Button, Card, Screen, T } from "@/components/ui";
import { LEGAL } from "@/config";
import { AD_ATTRIBUTION, getAdConsent, setAdConsent } from "@/lib/analytics";
import { colors, space } from "@/theme";

/**
 * The person's privacy choices: whether Marsa may share app activity (orders, email) with ad platforms to measure
 * its ads. This is the "Do Not Sell or Share My Personal Information" switch US state privacy laws (CCPA/CPRA and
 * similar) expect; on iPhone it also follows Apple's Allow Apps to Request to Track setting.
 */
export default function PrivacyChoices() {
  const [consent, setConsent] = useState(getAdConsent());
  const on = consent === "granted";

  return (
    <Screen>
      <T variant="muted">
        Marsa uses what you do in the app (like orders and searches) to run the app and improve it. That stays with
        Marsa and is never sold.
      </T>
      {AD_ATTRIBUTION ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="h3">Ad measurement</T>
              <T variant="small">
                Lets Marsa tell ad platforms (Meta, Google, TikTok, Snapchat) when an order came from one of our ads,
                using a scrambled form of your email. Turning it off opts you out of sharing.
              </T>
            </View>
            <Switch
              value={on}
              accessibilityLabel="Ad measurement"
              trackColor={{ true: colors.accent }}
              onValueChange={(v) => {
                const next = v ? "granted" : "denied";
                setConsent(next);
                void setAdConsent(next);
              }}
            />
          </View>
          {Platform.OS === "ios" && on ? (
            <T variant="small">You can also turn off tracking for every app in iPhone Settings › Privacy & Security › Tracking.</T>
          ) : null}
        </Card>
      ) : (
        <Banner tone="info">This version of the app doesn't share anything with ad platforms.</Banner>
      )}
      <Button title="Read the privacy policy" kind="secondary" onPress={() => void WebBrowser.openBrowserAsync(LEGAL.privacy)} />
      {Platform.OS === "ios" ? (
        <Button title="Open iPhone Settings" kind="ghost" onPress={() => void Linking.openSettings()} />
      ) : null}
    </Screen>
  );
}
