import { router } from "expo-router";
import { Alert, FlatList, View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { Banner, Button, ErrorState, Pill, T, styles } from "@/components/ui";
import { colors, space } from "@/theme";

/** The store's billing address and ship-to addresses (Owners). */
export default function Addresses() {
  const q = useApi(account.listAddresses);
  const deps = [account.listAddresses];
  const makeDefault = useApiMutation(account.defaultAddress, { invalidates: deps });
  const deactivate = useApiMutation(account.deactivateAddress, { invalidates: deps });
  const rows = q.data?.rows ?? [];

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={rows}
      keyExtractor={(a) => a.id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      ListHeaderComponent={<Button title="Add a ship-to address" kind="secondary" onPress={() => router.push("/address-edit")} />}
      renderItem={({ item: a }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <T variant="h3" style={{ flex: 1 }}>
              {a.label ?? (a.kind === "billing" ? "Billing address" : "Ship-to")}
            </T>
            {a.kind === "billing" ? <Pill label="Billing" /> : a.isDefault ? <Pill label="Default" tone="pos" /> : null}
          </View>
          <T>{[a.line1, a.line2, `${a.city}, ${a.state} ${a.postalCode}`].filter(Boolean).join("\n")}</T>
          <T variant="small">
            {a.taxStatus === "exempt" ? "Tax exempt" : a.taxRatePpm != null ? `Sales tax ${(a.taxRatePpm / 10000).toFixed(2)}%` : "Taxable"}
            {a.receivingHours ? ` · receiving ${a.receivingHours}` : ""}
            {a.dock ? " · dock" : ""}
          </T>
          {a.waitingForRate ? <Banner tone="info">Marsa is setting up tax for this address; orders to it confirm once that's done.</Banner> : null}
          {a.pendingChange ? <Banner tone="warn">{`Change waiting for Marsa: ${a.pendingChange.after}`}</Banner> : null}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button
              title="Edit"
              kind="secondary"
              style={{ minHeight: 38 }}
              onPress={() => router.push({ pathname: "/address-edit", params: { id: a.id } })}
            />
            {a.kind === "ship_to" && !a.isDefault ? (
              <>
                <Button
                  title="Make default"
                  kind="ghost"
                  style={{ minHeight: 38 }}
                  onPress={() =>
                    makeDefault.mutate(
                      { params: { id: a.id }, body: { version: a.version } },
                      { onError: (e) => Alert.alert("Couldn't change it", messageOf(e)) },
                    )
                  }
                />
                <Button
                  title="Remove"
                  kind="ghost"
                  style={{ minHeight: 38 }}
                  onPress={() =>
                    Alert.alert("Remove this address?", "Past orders keep it; new orders can't ship there.", [
                      { text: "Keep", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () =>
                          deactivate.mutate(
                            { params: { id: a.id }, body: { version: a.version } },
                            { onError: (e) => Alert.alert("Couldn't remove it", messageOf(e)) },
                          ),
                      },
                    ])
                  }
                />
              </>
            ) : null}
          </View>
        </View>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons count={2} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState icon="location-outline" title="No addresses yet" />
        )
      }
    />
  );
}
