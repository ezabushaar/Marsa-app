import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import * as auth from "@contracts/routes/portal/auth";
import { PORTAL_EMAIL_CATEGORIES, PORTAL_EMAIL_CATEGORY_LABELS, type PortalEmailCategory } from "@contracts/portal";
import { messageOf } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Button, Card, Divider, Field, Screen, Section, T } from "@/components/ui";
import { colors, space } from "@/theme";

function Toggle({ title, about, value, onChange, disabled }: { title: string; about: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{title}</T>
        <T variant="small">{about}</T>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.accent }} accessibilityLabel={title} />
    </View>
  );
}

/** What Marsa sends this person: WhatsApp updates, new-arrival alerts and each email category. */
export default function Notifications() {
  const { me, adopt } = useSession();
  const save = useApiMutation(auth.updateNotifications);
  const [phone, setPhone] = useState(me?.user.phone ?? "");
  if (!me) return null;
  const u = me.user;

  const patch = (body: Parameters<typeof save.mutate>[0]["body"]) =>
    save.mutate(
      { body },
      {
        onSuccess: (user) => {
          adopt({ ...me, user });
          setPhone(user.phone ?? "");
        },
        onError: (e) => Alert.alert("Couldn't save", messageOf(e)),
      },
    );

  const emailOn = (c: PortalEmailCategory) => !u.emailOff.includes(c);

  return (
    <Screen>
      <Section title="WhatsApp">
        <Card>
          <Field
            label="Mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            placeholder="(317) 555-0123"
          />
          {phone.trim() !== (u.phone ?? "") ? (
            <Button title="Save number" kind="secondary" loading={save.isPending} onPress={() => patch({ phone: phone.trim() || null })} />
          ) : null}
          <Divider />
          <Toggle
            title="Order updates on WhatsApp"
            about={u.phone ? "Confirmed, shipped and delivered." : "Add your number first."}
            value={u.whatsappUpdates}
            disabled={!u.phone || save.isPending}
            onChange={(v) => patch({ whatsappUpdates: v })}
          />
          <Divider />
          <Toggle
            title="New arrivals and restocks"
            about="Hear first when new fragrances land or your alerts come back in stock."
            value={u.newArrivalsAlerts}
            disabled={save.isPending}
            onChange={(v) => patch({ newArrivalsAlerts: v })}
          />
        </Card>
      </Section>
      <Section title="Email">
        <Card>
          {PORTAL_EMAIL_CATEGORIES.map((c, i) => (
            <View key={c} style={{ gap: space.md }}>
              {i > 0 ? <Divider /> : null}
              <Toggle
                title={PORTAL_EMAIL_CATEGORY_LABELS[c].label}
                about={PORTAL_EMAIL_CATEGORY_LABELS[c].about}
                value={emailOn(c)}
                disabled={save.isPending}
                onChange={(v) => patch({ emailOff: v ? u.emailOff.filter((x) => x !== c) : [...u.emailOff, c] })}
              />
            </View>
          ))}
          <T variant="small">Account and security emails always go out.</T>
        </Card>
      </Section>
    </Screen>
  );
}
