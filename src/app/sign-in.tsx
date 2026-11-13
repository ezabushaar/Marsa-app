import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { messageOf } from "@/api/client";
import { useSession } from "@/api/session";
import { Banner, Button, Field, T } from "@/components/ui";
import { colors, radius, space } from "@/theme";

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, keep);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.foot }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ padding: space.xl, paddingTop: space.xxl * 1.5, gap: space.sm }}>
            <Text style={{ color: colors.panelMint, fontSize: 13, fontWeight: "700", letterSpacing: 1.5 }}>
              MARSA WHOLESALE
            </Text>
            <Text style={{ color: "#fff", fontSize: 30, fontWeight: "700", letterSpacing: -0.5 }}>
              Your store's fragrance wall, restocked in minutes.
            </Text>
            <Text style={{ color: colors.panelInk, fontSize: 15, lineHeight: 21 }}>
              Your prices, live stock, reorders and invoices in one place.
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.page,
              borderTopLeftRadius: radius.lg * 1.5,
              borderTopRightRadius: radius.lg * 1.5,
              padding: space.xl,
              gap: space.lg,
            }}
          >
            <T variant="title">Sign in</T>
            {error ? <Banner tone="neg">{error}</Banner> : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable
              onPress={() => setKeep(!keep)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
            >
              <T>Keep me signed in (30 days)</T>
              <Switch value={keep} onValueChange={setKeep} trackColor={{ true: colors.accent }} />
            </Pressable>
            <Button title="Sign in" loading={busy} onPress={submit} />
            <Link href="/forgot-password" asChild>
              <Pressable style={{ alignSelf: "center", padding: space.sm }}>
                <Text style={{ color: colors.accent, fontWeight: "600" }}>Forgot your password?</Text>
              </Pressable>
            </Link>
            <T variant="muted" style={{ textAlign: "center" }}>
              New to Marsa? Apply for a wholesale account at wholesale.itsmarsa.com. Once approved, sign in here with
              the same email.
            </T>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
