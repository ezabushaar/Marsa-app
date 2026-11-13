import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Tabs from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import { useSession } from "@/api/session";
import { CartButton, type IconName } from "@/components/kit";
import { colors } from "@/theme";

const icon =
  (name: IconName, active: IconName) =>
  ({ color, size, focused }: { color: unknown; size: number; focused: boolean }) => (
    <Ionicons name={focused ? active : name} color={color as string} size={size} />
  );

/** The raised Scan button in the middle of the tab bar: it opens the scanner over everything. */
function ScanButton() {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Pressable
        onPress={() => router.push("/scan")}
        accessibilityRole="button"
        accessibilityLabel="Scan barcodes to order"
        style={({ pressed }) => ({
          width: 58,
          height: 58,
          borderRadius: 29,
          marginTop: -18,
          backgroundColor: pressed ? colors.accentDeep : colors.accent,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 4,
          borderColor: colors.page,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        })}
      >
        <Ionicons name="barcode-outline" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

/** Home · Shop · Scan · Orders · Account (the plan's five tabs, Scan always one tap away). */
export default function TabsLayout() {
  const { can } = useSession();
  const shops = can("shop");
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { color: colors.inkStrong },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.canvas },
        sceneStyle: { backgroundColor: colors.canvas },
        headerRight: () => <CartButton />,
        headerRightContainerStyle: { paddingRight: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: "Marsa Wholesale", tabBarIcon: icon("home-outline", "home") }} />
      <Tabs.Screen
        name="shop"
        options={{ title: "Shop", tabBarIcon: icon("search-outline", "search"), href: shops ? undefined : null }}
      />
      <Tabs.Screen
        name="scan-tab"
        options={shops ? { title: "Scan", tabBarButton: () => <ScanButton /> } : { href: null }}
      />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("receipt-outline", "receipt") }} />
      <Tabs.Screen
        name="account"
        options={{ title: "Account", tabBarIcon: icon("person-circle-outline", "person-circle") }}
      />
    </Tabs>
  );
}
