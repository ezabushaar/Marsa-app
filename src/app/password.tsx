import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import * as auth from "@contracts/routes/portal/auth";
import { messageOf } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { Banner, Button, Field, Screen, T } from "@/components/ui";

export default function Password() {
  const change = useApiMutation(auth.changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again.length > 0 && again !== next;
  const tooShort = next.length > 0 && next.length < 10;

  return (
    <Screen>
      <T variant="muted">Use at least 10 characters. A short phrase works well.</T>
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Field
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={tooShort ? "At least 10 characters" : null}
      />
      <Field
        label="New password again"
        value={again}
        onChangeText={setAgain}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={mismatch ? "The two don't match" : null}
      />
      {change.isError ? <Banner tone="neg">{messageOf(change.error)}</Banner> : null}
      <Button
        title="Change password"
        disabled={!current || next.length < 10 || next !== again}
        loading={change.isPending}
        onPress={() =>
          change.mutate(
            { body: { currentPassword: current, newPassword: next } },
            {
              onSuccess: () => {
                Alert.alert("Password changed", "Use it next time you sign in.");
                router.back();
              },
            },
          )
        }
      />
    </Screen>
  );
}
