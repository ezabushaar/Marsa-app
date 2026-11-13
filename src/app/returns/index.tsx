import { router } from "expo-router";
import { FlatList, Pressable, View } from "react-native";
import * as account from "@contracts/routes/portal/account";
import { useApi } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { ErrorState, Pill, T, styles } from "@/components/ui";
import { money, plural } from "@/lib/format";
import { returnTone } from "@/lib/orders";
import { colors, space } from "@/theme";

/** The store's return requests and where each stands (RMA number once Marsa approves it). */
export default function Returns() {
  const q = useApi(account.listReturns);
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={q.data?.rows ?? []}
      keyExtractor={(r) => r.id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      renderItem={({ item: r }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: "/returns/[id]", params: { id: r.id } })}
        >
          <View style={styles.row}>
            <T variant="h3" style={{ flex: 1 }}>
              {r.number ?? "Return request"} · {r.orderNumber}
            </T>
            <Pill label={r.statusLabel} tone={returnTone(r.status)} />
          </View>
          <T variant="small">
            {plural(r.units, "unit")} · {r.outcome === "credit" ? "credit" : "replacement"} · about {money(r.estimateCents)}
          </T>
        </Pressable>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons count={2} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState
            icon="return-down-back-outline"
            title="No returns"
            body="Something arrive damaged or wrong? Open the order and tap Start a return."
          />
        )
      }
    />
  );
}
