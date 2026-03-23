import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { trpc, getTRPCClient } from '../lib/trpc';
import { useAuthStore } from '../lib/store';
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

const trpcClient = getTRPCClient(CONFIG.BASE_URL);

export default function RootLayout() {
  const { setLoading } = useAuthStore();

  useEffect(() => {
    // Initialize app - check stored auth token
    const initApp = async () => {
      try {
        // In production, retrieve token from SecureStore
        // const token = await SecureStore.getItemAsync('nexcom_token');
        // if (token) { setToken(token); }
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
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
