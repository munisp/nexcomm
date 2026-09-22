import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
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
import { hydrateOfflineCache, initOfflineReadCache } from '../lib/offlineCache';
import { useOfflineOrderQueue } from '../lib/useOfflineOrderQueue';
import { useReduceMotion } from '../lib/useReduceMotion';
import { CONFIG, COLORS } from '../constants/config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // Serve cache first, refetch in background — critical on 2G/3G.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
      // Retry only transient failures: network errors and 5xx. Client
      // errors (4xx) fail immediately. Max 2 retries.
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
        if (status == null) return true; // network-level failure (incl. 12s timeout)
        return status >= 500;
      },
      // Capped exponential backoff with 50–100% jitter (thundering-herd
      // protection when a cell tower flaps for many users at once).
      retryDelay: (attempt) => {
        const cap = Math.min(1_000 * 2 ** attempt, 8_000);
        return cap / 2 + Math.random() * (cap / 2);
      },
    },
  },
});

// Token is resolved per-request from the in-memory cache inside lib/trpc.ts.
const trpcClient = getTRPCClient(CONFIG.BASE_URL);

function DeepLinkHandler() {
  usePushDeepLink();
  return null;
}

/** Mounts offline order-queue replay triggers app-wide (AppState + link recovery). */
function OfflineOrderSync() {
  useOfflineOrderQueue();
  return null;
}

/** Redirect guard: unauthenticated users can only see /auth/*. */
function AuthGate() {
  const segments = useSegments();
  const { isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return null; // native splash covers this window
  const onAuthRoute = segments[0] === 'auth';
  if (!isAuthenticated && !onAuthRoute) return <Redirect href="/auth" />;
  if (isAuthenticated && onAuthRoute) return <Redirect href="/tabs" />;
  return null;
}

export default function RootLayout() {
  const { setToken, setLoading, isLoading } = useAuthStore();
  const reduceMotion = useReduceMotion();

  // Hydrate the MMKV offline read cache synchronously before the first
  // screen mounts (runs once, during first render — ~1ms) so the dashboard
  // can paint cached prices immediately on cold/offline launches.
  const [cacheHydrated] = useState(() => {
    hydrateOfflineCache(queryClient);
    return true;
  });

  useEffect(() => {
    // Bootstrap session: restore the persisted Keycloak token from
    // SecureStore. The splash stays up only for THIS — nothing else gates it.
    const initApp = async () => {
      try {
        const tokens = await restoreTokens();
        if (tokens) {
          setToken(tokens.accessToken);
        }
      } catch (e) {
        console.error('Failed to initialize app:', e);
      } finally {
        setLoading(false);
      }
    };
    initApp();

    // Defer every non-critical init past the first frame (cold-start TTI
    // budget): notification handler + push token registration hit the
    // network and native bridges and must not block first paint.
    const deferred = InteractionManager.runAfterInteractions(() => {
      configureNotificationHandler();
      // Re-register the push token on every cold start (tokens rotate).
      if (useAuthStore.getState().isAuthenticated) {
        registerDevicePushToken().catch(() => {});
      }
    });
    return () => deferred.cancel();
  }, []);

  // Splash gate: render NOTHING until the auth bootstrap completes. The OS
  // splash screen stays visible until the first React frame, so gating the
  // first render on auth rehydrate (and only that) keeps cold-start honest —
  // no spinner wall, no premature white flash.
  if (isLoading) return null;

  // Write-through subscription: persist allowlisted market reads to MMKV.
  useEffect(() => {
    if (!cacheHydrated) return undefined;
    return initOfflineReadCache(queryClient);
  }, [cacheHydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <DeepLinkHandler />
            <OfflineOrderSync />
            <AuthGate />
            <StatusBar style="light" backgroundColor={COLORS.background} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.surface },
                headerTintColor: COLORS.text,
                headerTitleStyle: { fontWeight: 'bold' },
                contentStyle: { backgroundColor: COLORS.background },
                animation: reduceMotion ? 'none' : 'slide_from_right',
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
