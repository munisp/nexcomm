import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect, useSegments } from 'expo-router';
import { trpc, getTRPCClient } from '../lib/trpc';
import { usePushDeepLink } from '../lib/usePushDeepLink';
import { useAuthStore } from '../lib/store';
import { restoreTokens } from '../lib/auth';
import { configureNotificationHandler, registerDevicePushToken } from '../lib/notifications';
import { CONFIG, COLORS } from '../constants/config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    },
  },
});

// Token is resolved per-request from SecureStore inside lib/trpc.ts headers().
const trpcClient = getTRPCClient(CONFIG.BASE_URL);

function DeepLinkHandler() {
  usePushDeepLink();
  return null;
}

/** Redirect guard: unauthenticated users can only see /auth/*. */
function AuthGate() {
  const segments = useSegments();
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return null; // bootstrap splash below handles this window
  const onAuthRoute = segments[0] === 'auth';
  if (!isAuthenticated && !onAuthRoute) return <Redirect href="/auth" />;
  if (isAuthenticated && onAuthRoute) return <Redirect href="/tabs" />;
  return null;
}

export default function RootLayout() {
  const { setToken, setLoading } = useAuthStore();

  useEffect(() => {
    configureNotificationHandler();
    // Bootstrap session: restore the persisted Keycloak token from SecureStore.
    // Validity/refresh happens lazily in getValidAccessToken() on first call.
    const initApp = async () => {
      try {
        const tokens = await restoreTokens();
        if (tokens) {
          setToken(tokens.accessToken);
          // Re-register the push token on every cold start (tokens rotate)
          registerDevicePushToken().catch(() => {});
        }
      } catch (e) {
        console.error('Failed to initialize app:', e);
      } finally {
        setLoading(false);
      }
    };
    initApp();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <DeepLinkHandler />
            <AuthGate />
            <StatusBar style="light" backgroundColor={COLORS.background} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.surface },
                headerTintColor: COLORS.text,
                headerTitleStyle: { fontWeight: 'bold' },
                contentStyle: { backgroundColor: COLORS.background },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="tabs" options={{ headerShown: false }} />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen
                name="trading/[symbol]"
                options={{
                  title: 'Trade',
                  headerBackTitle: 'Markets',
                }}
              />
              <Stack.Screen
                name="warehouse/[id]"
                options={{
                  title: 'Warehouse Receipt',
                  headerBackTitle: 'Warehouse',
                }}
              />
              <Stack.Screen
                name="farmer/[id]"
                options={{
                  title: 'Farmer Profile',
                  headerBackTitle: 'Farmers',
                }}
              />
              <Stack.Screen
                name="banking/index"
                options={{
                  title: 'Banking',
                  headerBackTitle: 'Back',
                }}
              />
              <Stack.Screen
                name="notifications/index"
                options={{
                  title: 'Notifications',
                  headerBackTitle: 'Back',
                }}
              />
              <Stack.Screen
                name="alerts/index"
                options={{
                  title: 'Price Alerts',
                  headerBackTitle: 'Back',
                }}
              />
            </Stack>
          </QueryClientProvider>
        </trpc.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
