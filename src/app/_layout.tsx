import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import { SessionProvider, useSession } from "@/api/session";
import { CartButton } from "@/components/kit";
import { ErrorState } from "@/components/ui";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A refusal (4xx) won't change by asking again; a network blip or 5xx might.
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

/** Refetch stale screens when the app comes back to the foreground (stock and prices move). */
function useAppFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (Platform.OS !== "web") focusManager.setFocused(s === "active");
    });
    return () => sub.remove();
  }, []);
}

const withCart = { headerRight: () => <CartButton /> };

function RootStack() {
  const { me, loading, unreachable, recheck } = useSession();
  useAppFocus();
  useEffect(() => {
    if (!loading) SplashScreen.hide();
  }, [loading]);
  if (loading) return null;
  if (unreachable) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <ErrorState error={unreachable} onRetry={recheck} />
      </View>
    );
  }
  const signedIn = !!me;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.accentDeep,
        headerTitleStyle: { color: colors.inkStrong },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.canvas },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="product/[id]" options={{ title: "", ...withCart }} />
        <Stack.Screen name="cart" options={{ title: "Cart" }} />
        <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
        <Stack.Screen name="placed/[id]" options={{ title: "Order sent", headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
        <Stack.Screen name="quote/[id]" options={{ title: "Quote" }} />
        <Stack.Screen name="invoices" options={{ title: "Invoices and payments" }} />
        <Stack.Screen name="deals" options={{ title: "Clearance deals", ...withCart }} />
        <Stack.Screen name="lists/index" options={{ title: "Saved lists" }} />
        <Stack.Screen name="lists/[id]" options={{ title: "List", ...withCart }} />
        <Stack.Screen name="alerts" options={{ title: "Restock alerts" }} />
        <Stack.Screen name="returns/index" options={{ title: "Returns" }} />
        <Stack.Screen name="returns/[id]" options={{ title: "Return" }} />
        <Stack.Screen name="returns/new" options={{ title: "Start a return" }} />
        <Stack.Screen name="addresses" options={{ title: "Addresses" }} />
        <Stack.Screen name="address-edit" options={{ title: "Address", presentation: "modal" }} />
        <Stack.Screen name="team" options={{ title: "Your team" }} />
        <Stack.Screen name="team-invite" options={{ title: "Invite someone", presentation: "modal" }} />
        <Stack.Screen name="business" options={{ title: "Business details" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="password" options={{ title: "Change password" }} />
        <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
        <Stack.Screen name="scan" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="browse/index" options={{ title: "Catalog" }} />
        <Stack.Screen name="browse/[id]" options={{ title: "" }} />
        <Stack.Screen name="sign-in" options={{ title: "", headerTransparent: true, headerTintColor: "#fff" }} />
        <Stack.Screen name="forgot-password" options={{ title: "Reset password" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <RootStack />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
