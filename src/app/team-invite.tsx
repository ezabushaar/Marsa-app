import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import * as team from "@contracts/routes/portal/team";
import { PORTAL_ROLES, type PortalRole } from "@contracts/portal";
import { messageOf } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { Banner, Button, Field, Screen, T } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles";
import { colors, radius, space } from "@/theme";

/** Invite a teammate: they get an email with a link to set their password (valid 7 days). */
export default function TeamInvite() {
  const invite = useApiMutation(team.inviteTeamMember, { invalidates: [team.listTeam] });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<PortalRole>("buyer");
  const valid = name.trim() && /\S+@\S+\.\S+/.test(email.trim());

  return (
    <Screen>
      <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Mobile for WhatsApp (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <T variant="label">What can they do?</T>
      {PORTAL_ROLES.map((r) => (
        <Pressable
          key={r}
          onPress={() => setRole(r)}
          accessibilityRole="radio"
          accessibilityState={{ checked: role === r }}
          style={{
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: role === r ? 2 : 1,
            borderColor: role === r ? colors.accent : colors.line,
            backgroundColor: role === r ? colors.accentTint : colors.page,
            gap: 2,
          }}
        >
          <T variant="h3">{ROLE_LABELS[r].label}</T>
          <T variant="small">{ROLE_LABELS[r].about}</T>
        </Pressable>
      ))}
      {invite.isError ? <Banner tone="neg">{messageOf(invite.error)}</Banner> : null}
      <View style={{ height: space.sm }} />
      <Button
        title="Send invite"
        disabled={!valid}
        loading={invite.isPending}
        onPress={() =>
          invite.mutate(
            { body: { name: name.trim(), email: email.trim(), phone: phone.trim() || null, role } },
            {
              onSuccess: () => {
                Alert.alert("Invite sent", `${name.trim()} will get an email to set a password.`);
                router.back();
              },
            },
          )
        }
      />
    </Screen>
  );
}
