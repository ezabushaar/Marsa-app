import { Ionicons } from "@expo/vector-icons";
import Tabs from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import * as shop from "@contracts/routes/portal/shop";
import { useApi } from "@/api/hooks";
import { useSession } from "@/api/session";
import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const { can } = useSession();
  const shops = can("shop");
  const cart = useApi(shop.getCart, undefined, { enabled: shops });
  const lines = cart.data?.lines.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { color: colors.inkStrong },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Marsa Wholesale", tabBarLabel: "Shop", tabBarIcon: icon("storefront-outline"), href: shops ? undefined : null }}
      />
      <Tabs.Screen
        name="catalog"
        options={{ title: "Catalog", tabBarIcon: icon("search"), href: shops ? undefined : null }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: icon("bag-outline"),
          tabBarBadge: lines > 0 ? lines : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.badge },
          href: shops ? undefined : null,
        }}
      />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("receipt-outline") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
