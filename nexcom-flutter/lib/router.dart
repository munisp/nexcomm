import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers/auth_provider.dart';
import 'screens/auth/login_screen.dart';
import 'screens/shell/main_shell.dart';
import 'screens/dashboard/dashboard_screen.dart';
import 'screens/markets/markets_screen.dart';
import 'screens/markets/market_detail_screen.dart';
import 'screens/trade/trade_screen.dart';
import 'screens/trade/order_book_screen.dart';
import 'screens/portfolio/portfolio_screen.dart';
import 'screens/warehouse/warehouse_screen.dart';
import 'screens/warehouse/warehouse_detail_screen.dart';
import 'screens/profile/profile_screen.dart';
import 'screens/profile/kyc_screen.dart';
import 'screens/alerts/price_alerts_screen.dart';
import 'screens/farmer/farmer_screen.dart';
import 'screens/farmer/farmer_detail_screen.dart';
import 'screens/notifications/notifications_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'screens/settings/push_notification_settings_screen.dart';
import 'screens/banking/banking_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: '/dashboard',
    redirect: (context, state) {
      final isLoggedIn = authState.valueOrNull?.isLoggedIn ?? false;
      final isAuthRoute = state.matchedLocation.startsWith('/auth');

      if (!isLoggedIn && !isAuthRoute) return '/auth/login';
      if (isLoggedIn && isAuthRoute) return '/dashboard';
      return null;
    },
    routes: [
      // Auth routes (no shell)
      GoRoute(
        path: '/auth/login',
        builder: (context, state) => const LoginScreen(),
      ),

      // Main app shell with bottom navigation
      ShellRoute(
        builder: (context, state, child) => MainShell(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/markets',
            builder: (context, state) => const MarketsScreen(),
            routes: [
              GoRoute(
                path: ':symbol',
                builder: (context, state) => MarketDetailScreen(
                  symbol: state.pathParameters['symbol']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/trade',
            builder: (context, state) => const TradeScreen(),
            routes: [
              GoRoute(
                path: 'orderbook/:symbol',
                builder: (context, state) => OrderBookScreen(
                  symbol: state.pathParameters['symbol']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/portfolio',
            builder: (context, state) => const PortfolioScreen(),
          ),
          GoRoute(
            path: '/warehouse',
            builder: (context, state) => const WarehouseScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) => WarehouseDetailScreen(
                  receiptId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
            routes: [
              GoRoute(
                path: 'kyc',
                builder: (context, state) => const KycScreen(),
              ),
            ],
          ),
          GoRoute(
            path: '/alerts',
            builder: (context, state) => const PriceAlertsScreen(),
          ),
          GoRoute(
            path: '/farmer',
            builder: (context, state) => const FarmerScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) => FarmerDetailScreen(
                  farmerId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/notifications',
            builder: (context, state) => const NotificationsScreen(),
          ),
          GoRoute(
            path: '/settings',
            builder: (context, state) => const SettingsScreen(),
            routes: [
              GoRoute(
                path: 'push-notifications',
                builder: (context, state) => const PushNotificationSettingsScreen(),
              ),
            ],
          ),
          GoRoute(
            path: '/banking',
            builder: (context, state) => const BankingScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Text('Page not found: ${state.error}'),
      ),
    ),
  );
});
