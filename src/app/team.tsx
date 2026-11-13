import { router } from "expo-router";
import { ActionSheetIOS, Alert, FlatList, Platform, View } from "react-native";
import * as team from "@contracts/routes/portal/team";
import { PORTAL_ROLES } from "@contracts/portal";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { Button, ErrorState, Pill, T, styles } from "@/components/ui";
import { day } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { colors, space } from "@/theme";

/** The people at the store who can sign in (Owners manage them). */
export default function Team() {
  const q = useApi(team.listTeam);
  const deps = [team.listTeam];
  const update = useApiMutation(team.updateTeamMember, { invalidates: deps });
  const deactivate = useApiMutation(team.deactivateTeamMember, { invalidates: deps });
  const reactivate = useApiMutation(team.reactivateTeamMember, { invalidates: deps });
  const resend = useApiMutation(team.resendTeamInvite, { invalidates: deps });
  const fail = (e: unknown) => Alert.alert("Couldn't do that", messageOf(e));

  type Member = NonNullable<typeof q.data>["rows"][number];
  const manage = (m: Member) => {
    const actions: { text: string; destructive?: boolean; run: () => void }[] = [
      ...PORTAL_ROLES.filter((r) => r !== m.role).map((r) => ({
        text: `Make ${ROLE_LABELS[r].label}`,
        run: () => update.mutate({ params: { userId: m.id }, body: { version: m.version, role: r } }, { onError: fail }),
      })),
      ...(m.status === "invited"
        ? [{ text: "Resend invite", run: () => resend.mutate({ params: { userId: m.id }, body: { version: m.version } }, { onError: fail }) }]
        : []),
      m.status === "deactivated"
        ? { text: "Reactivate", run: () => reactivate.mutate({ params: { userId: m.id }, body: { version: m.version } }, { onError: fail }) }
        : {
            text: "Deactivate (signs them out)",
            destructive: true,
            run: () => deactivate.mutate({ params: { userId: m.id }, body: { version: m.version } }, { onError: fail }),
          },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: m.name,
          options: [...actions.map((a) => a.text), "Cancel"],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: actions.findIndex((a) => a.destructive),
        },
        (i) => actions[i]?.run(),
      );
    } else {
      Alert.alert(m.name, undefined, [
        ...actions.slice(0, 2).map((a) => ({ text: a.text, onPress: a.run, style: a.destructive ? ("destructive" as const) : undefined })),
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={q.data?.rows ?? []}
      keyExtractor={(m) => m.id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      ListHeaderComponent={<Button title="Invite someone" kind="secondary" onPress={() => router.push("/team-invite")} />}
      renderItem={({ item: m }) => (
        <View style={[styles.card, m.status === "deactivated" && { opacity: 0.6 }]}>
          <View style={styles.row}>
            <T variant="h3" style={{ flex: 1 }}>
              {m.name}
              {m.you ? " (you)" : ""}
            </T>
            <Pill
              label={m.status === "active" ? ROLE_LABELS[m.role].label : m.status === "invited" ? "Invited" : "Deactivated"}
              tone={m.status === "active" ? "pos" : m.status === "invited" ? "warn" : "neutral"}
            />
          </View>
          <T variant="small">
            {m.email}
            {m.lastLoginAt ? ` · last in ${day(m.lastLoginAt.slice(0, 10), false)}` : ""}
          </T>
          {!m.you ? <Button title="Manage" kind="ghost" style={{ alignSelf: "flex-start", minHeight: 36, paddingHorizontal: 0 }} onPress={() => manage(m)} /> : null}
        </View>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons count={2} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState icon="people-outline" title="Just you so far" body="Invite a buyer or your bookkeeper." />
        )
      }
    />
  );
}
