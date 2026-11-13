import { router } from "expo-router";
import { useState } from "react";
import * as auth from "@contracts/routes/portal/auth";
import { messageOf } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { Banner, Button, Field, Screen, T } from "@/components/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const req = useApiMutation(auth.requestPasswordReset);

  if (req.isSuccess) {
    return (
      <Screen>
        <T variant="h2">Check your email</T>
        <T variant="muted">
          If {email.trim()} has a Marsa wholesale account, we sent a link to set a new password. It works for one hour.
          Open it on this phone or your computer, then come back and sign in.
        </T>
        <Button title="Back to sign in" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T variant="muted">Enter the email you sign in with and we'll send you a link to set a new password.</T>
      {req.isError ? <Banner tone="neg">{messageOf(req.error)}</Banner> : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Button
        title="Send reset link"
        loading={req.isPending}
        disabled={!email.trim()}
        onPress={() => req.mutate({ body: { email: email.trim() } })}
      />
    </Screen>
  );
}
