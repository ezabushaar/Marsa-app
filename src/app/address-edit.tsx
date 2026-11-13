import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { US_STATES, isUsState } from "@contracts/portal";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { Banner, Button, Field, Loading, Screen, T } from "@/components/ui";
import { colors, space } from "@/theme";

/** Add a ship-to address, or edit one (moving the billing address goes to Marsa for approval). */
export default function AddressEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const list = useApi(account.listAddresses);
  const existing = id ? list.data?.rows.find((a) => a.id === id) : undefined;
  if (id && list.isPending) return <Loading />;
  return <Form key={existing?.id ?? "new"} existing={existing} />;
}

type Address = NonNullable<ReturnType<typeof useApi<typeof account.listAddresses>>["data"]>["rows"][number];

function Form({ existing }: { existing?: Address }) {
  const deps = [account.listAddresses, shop.getCart];
  const add = useApiMutation(account.addAddress, { invalidates: deps });
  const update = useApiMutation(account.updateAddress, { invalidates: deps });
  const [label, setLabel] = useState(existing?.label ?? "");
  const [line1, setLine1] = useState(existing?.line1 ?? "");
  const [line2, setLine2] = useState(existing?.line2 ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [state, setState] = useState(existing?.state ?? "");
  const [zip, setZip] = useState(existing?.postalCode ?? "");
  const [hours, setHours] = useState(existing?.receivingHours ?? "");
  const [dock, setDock] = useState(existing?.dock ?? false);
  const [makeDefault, setMakeDefault] = useState(false);

  const st = state.trim().toUpperCase();
  const stateOk = isUsState(st);
  const valid = line1.trim() && city.trim() && stateOk && /^\d{5}(-\d{4})?$/.test(zip.trim());
  const busy = add.isPending || update.isPending;
  const error = add.error ?? update.error;

  const save = () => {
    const fields = {
      label: label.trim() || null,
      line1: line1.trim(),
      line2: line2.trim() || null,
      city: city.trim(),
      state: st,
      postalCode: zip.trim(),
      receivingHours: hours.trim() || null,
      dock,
    };
    if (existing) {
      update.mutate(
        { params: { id: existing.id }, body: { version: existing.version, ...fields } },
        {
          onSuccess: (r) => {
            if (r.changeRequest) Alert.alert("Sent to Marsa", "Moving this address needs Marsa's approval. It stays as it was until then.");
            router.back();
          },
        },
      );
    } else {
      add.mutate({ body: { ...fields, makeDefault } }, { onSuccess: () => router.back() });
    }
  };

  return (
    <Screen>
      {existing?.kind === "billing" ? (
        <Banner tone="info">Changes to the billing address go to Marsa for approval.</Banner>
      ) : null}
      <Field label="Name for this address (optional)" value={label} onChangeText={setLabel} placeholder="Main store" />
      <Field label="Street address" value={line1} onChangeText={setLine1} autoComplete="street-address" textContentType="streetAddressLine1" />
      <Field label="Suite, unit (optional)" value={line2} onChangeText={setLine2} textContentType="streetAddressLine2" />
      <Field label="City" value={city} onChangeText={setCity} textContentType="addressCity" />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="State"
            value={state}
            onChangeText={setState}
            autoCapitalize="characters"
            maxLength={2}
            placeholder="IN"
            error={state && !stateOk ? "Two letters, like IN" : null}
            textContentType="addressState"
          />
        </View>
        <View style={{ flex: 1.4 }}>
          <Field label="ZIP" value={zip} onChangeText={setZip} keyboardType="number-pad" maxLength={10} textContentType="postalCode" />
        </View>
      </View>
      <Field label="Receiving hours (optional)" value={hours} onChangeText={setHours} placeholder="Mon–Fri 9–5" />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T>Loading dock</T>
        <Switch value={!!dock} onValueChange={setDock} trackColor={{ true: colors.accent }} />
      </View>
      {!existing ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T>Make this my default ship-to</T>
          <Switch value={makeDefault} onValueChange={setMakeDefault} trackColor={{ true: colors.accent }} />
        </View>
      ) : null}
      {!existing ? <T variant="small">New addresses are taxed at the local rate once Marsa sets it up (usually the same day).</T> : null}
      {error ? <Banner tone="neg">{messageOf(error)}</Banner> : null}
      <Button title={existing ? "Save" : "Add address"} disabled={!valid} loading={busy} onPress={save} />
      <T variant="small" style={{ textAlign: "center" }}>
        {US_STATES.length} states and DC supported.
      </T>
    </Screen>
  );
}
