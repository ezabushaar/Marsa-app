import { useState } from "react";
import { Alert, View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { useSession } from "@/api/session";
import { Banner, Button, Card, Chip, ErrorState, Field, Loading, Pill, Row, Screen, Section, T } from "@/components/ui";
import { day } from "@/lib/format";
import { space } from "@/theme";

type Askable = (typeof account.ASKABLE_CHANGES)[number];
const ASK_LABELS: Record<Askable, { label: string; hint: string }> = {
  legal_name: { label: "Legal name", hint: "As on your resale certificate" },
  tax_id: { label: "Tax ID (EIN)", hint: "9 digits" },
  terms: { label: "Payment terms", hint: "For example Net 30" },
};

/** The store's profile; Owners also see legal details and can ask Marsa to change them. */
export default function Business() {
  const { can } = useSession();
  const owner = can("team");
  const profile = useApi(account.getProfile);
  const requests = useApi(account.listChangeRequests, undefined, { enabled: owner });
  const ask = useApiMutation(account.requestChange, { invalidates: [account.listChangeRequests] });
  const [kind, setKind] = useState<Askable | null>(null);
  const [value, setValue] = useState("");

  if (profile.isPending) return <Loading />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const p = profile.data;

  return (
    <Screen>
      <Card>
        <Row label="Store" value={p.storeName} />
        <Row label="Customer number" value={p.customerNumber} />
        <Row label="Customer since" value={day(p.customerSince.slice(0, 10))} />
        <Row label="Your rep" value={p.rep?.name ?? "The Marsa team"} />
        {p.business ? (
          <>
            <Row label="Legal name" value={p.business.legalName} />
            {p.business.phone ? <Row label="Phone" value={p.business.phone} /> : null}
            {p.business.taxIdLast4 ? <Row label="Tax ID" value={`•••••${p.business.taxIdLast4}`} /> : null}
          </>
        ) : null}
      </Card>

      {owner ? (
        <Section title="Ask Marsa for a change">
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {account.ASKABLE_CHANGES.map((k) => (
              <Chip key={k} label={ASK_LABELS[k].label} active={kind === k} onPress={() => setKind(kind === k ? null : k)} />
            ))}
          </View>
          {kind ? (
            <Card>
              <Field label={`New ${ASK_LABELS[kind].label.toLowerCase()}`} hint={ASK_LABELS[kind].hint} value={value} onChangeText={setValue} />
              {ask.isError ? <Banner tone="neg">{messageOf(ask.error)}</Banner> : null}
              <Button
                title="Send request"
                disabled={!value.trim()}
                loading={ask.isPending}
                onPress={() =>
                  ask.mutate(
                    { body: { kind, value: value.trim() } },
                    {
                      onSuccess: () => {
                        setKind(null);
                        setValue("");
                        Alert.alert("Sent", "Marsa reviews it and lets you know.");
                      },
                    },
                  )
                }
              />
            </Card>
          ) : null}
          {(requests.data?.rows ?? []).map((r) => (
            <Card key={r.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <T variant="h3" style={{ flex: 1 }}>
                  {r.kindLabel}
                </T>
                <Pill label={r.status} tone={r.status === "approved" ? "pos" : r.status === "rejected" ? "neg" : "warn"} />
              </View>
              <T variant="small">{r.after}</T>
              {r.note ? <T variant="small">{r.note}</T> : null}
            </Card>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
