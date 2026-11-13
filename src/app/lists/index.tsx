import { router } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { messageOf } from "@/api/client";
import { useApi, useApiMutation } from "@/api/hooks";
import { CardSkeletons, EmptyState } from "@/components/kit";
import { Button, Card, ErrorState, Field, T, styles } from "@/components/ui";
import { plural } from "@/lib/format";
import { colors, space } from "@/theme";

/** Saved lists: a store's regular orders, seasonal sets or favorites, each one tap from the cart. */
export default function Lists() {
  const q = useApi(shop.listLists);
  const create = useApiMutation(shop.createList, { invalidates: [shop.listLists] });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={q.data?.rows ?? []}
      keyExtractor={(r) => r.id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      ListHeaderComponent={
        naming ? (
          <Card>
            <Field label="List name" value={name} onChangeText={setName} autoFocus maxLength={100} placeholder="Weekly restock" />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button title="Cancel" kind="ghost" style={{ flex: 1 }} onPress={() => setNaming(false)} />
              <Button
                title="Create"
                style={{ flex: 1 }}
                disabled={!name.trim()}
                loading={create.isPending}
                onPress={() =>
                  create.mutate(
                    { body: { name: name.trim() } },
                    {
                      onSuccess: (l) => {
                        setNaming(false);
                        setName("");
                        router.push({ pathname: "/lists/[id]", params: { id: l.id } });
                      },
                      onError: (e) => Alert.alert("Couldn't create it", messageOf(e)),
                    },
                  )
                }
              />
            </View>
          </Card>
        ) : (
          <Button title="New list" kind="secondary" onPress={() => setNaming(true)} />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          onPress={() => router.push({ pathname: "/lists/[id]", params: { id: item.id } })}
          accessibilityRole="button"
        >
          <T variant="h3">{item.name}</T>
          <T variant="small">{plural(item.itemCount, "item")}</T>
        </Pressable>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <CardSkeletons count={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState
            icon="bookmark-outline"
            title="No saved lists yet"
            body="Save your cart as a list, or tap Save to list on any product, and reorder the whole list in one tap."
          />
        )
      }
    />
  );
}
