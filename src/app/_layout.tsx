import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import { SessionProvider, useSession } from "@/api/session";
import { Loading } from "@/components/ui";
import { colors } from "@/theme";

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

function RootStack() {
  const { me, loading } = useSession();
  useAppFocus();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <Loading />
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
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="product/[id]" options={{ title: "" }} />
        <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
        <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
        <Stack.Screen name="invoices" options={{ title: "Invoices" }} />
        <Stack.Screen name="scan" options={{ title: "Scan to order", presentation: "fullScreenModal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
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
