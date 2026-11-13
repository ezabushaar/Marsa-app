import type { ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { colors, space } from "@/theme";
import { type CatalogItem, type Deal, ProductCard } from "./ProductCard";
import { Section } from "./ui";

/** A titled horizontal row of product cards that runs edge to edge. */
export function Shelf({
  title,
  rows,
  more,
  dealOf,
  subtitle,
}: {
  title: string;
  rows: CatalogItem[];
  more?: () => void;
  dealOf?: (item: CatalogItem) => Deal | undefined;
  subtitle?: ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <Section
      title={title}
      action={
        more ? (
          <Pressable onPress={more} hitSlop={8} accessibilityRole="link" accessibilityLabel={`See all ${title}`}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>See all</Text>
          </Pressable>
        ) : undefined
      }
    >
      {subtitle}
      <FlatList
        horizontal
        data={rows}
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}
        style={{ marginHorizontal: -space.lg }}
        renderItem={({ item }) => (
          <View style={{ width: 172 }}>
            <ProductCard item={item} deal={dealOf?.(item)} />
          </View>
        )}
      />
    </Section>
  );
}
