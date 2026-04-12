/// push_deep_link_service.dart
///
/// Handles Firebase Cloud Messaging (FCM) push notification deep-links
/// for the NEXCOM Exchange Flutter app.
///
/// Supported deep-link targets via notification `data` payload:
///   screen: "markets"       → /markets
///   screen: "trade"         → /trade?symbol=MAIZE
///   screen: "banking"       → /banking
///   screen: "portfolio"     → /portfolio
///   screen: "alerts"        → /alerts
///   screen: "kyc"           → /kyc
///   screen: "notifications" → /notifications
///   screen: "order"         → /trade?orderId=xxx
///   screen: "loan"          → /banking?tab=loans
///   screen: "warehouse"     → /warehouse
///   screen: "security"      → /security
library;

import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

class PushDeepLinkService {
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  /// Call once from main.dart after GoRouter is initialised.
  Future<void> init(GoRouter router) async {
    // Request permission (iOS / macOS)
    await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    // App opened from a terminated state via notification
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      await Future.delayed(const Duration(milliseconds: 500));
      _handleMessage(initialMessage, router);
    }

    // App in background, notification tapped
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _handleMessage(message, router);
    });

    // App in foreground — show in-app banner (optional)
    FirebaseMessaging.onMessage.listen((message) {
      debugPrint('[PushDeepLink] Foreground message: ${message.notification?.title}');
      // In production, show an in-app snackbar/banner here
    });
  }

  void _handleMessage(RemoteMessage message, GoRouter router) {
    final data = message.data;
    final screen = data['screen'] as String?;
    if (screen == null) return;

    debugPrint('[PushDeepLink] Navigating to screen: $screen');

    switch (screen) {
      case 'markets':
        router.go('/markets');
        break;
      case 'trade':
        final symbol = data['symbol'] as String?;
        if (symbol != null) {
          router.go('/trade?symbol=$symbol');
        } else {
          router.go('/trade');
        }
        break;
      case 'order':
        final orderId = data['orderId'] as String?;
        if (orderId != null) {
          router.go('/trade?orderId=$orderId');
        } else {
          router.go('/trade');
        }
        break;
      case 'banking':
        final tab = data['tab'] as String?;
        if (tab != null) {
          router.go('/banking?tab=$tab');
        } else {
          router.go('/banking');
        }
        break;
      case 'loan':
        router.go('/banking?tab=loans');
        break;
      case 'portfolio':
        router.go('/portfolio');
        break;
      case 'alerts':
        router.go('/alerts');
        break;
      case 'kyc':
        router.go('/kyc');
        break;
      case 'notifications':
        router.go('/notifications');
        break;
      case 'warehouse':
        router.go('/warehouse');
        break;
      case 'security':
        router.go('/security');
        break;
      default:
        router.go('/dashboard');
        break;
    }
  }

  /// Get the FCM token for this device (used to register for push notifications).
  Future<String?> getDeviceToken() async {
    try {
      return await _messaging.getToken();
    } catch (e) {
      debugPrint('[PushDeepLink] Failed to get FCM token: $e');
      return null;
    }
  }

  /// Subscribe to a topic (e.g., commodity price alerts).
  Future<void> subscribeToTopic(String topic) async {
    await _messaging.subscribeToTopic(topic);
    debugPrint('[PushDeepLink] Subscribed to topic: $topic');
  }

  /// Unsubscribe from a topic.
  Future<void> unsubscribeFromTopic(String topic) async {
    await _messaging.unsubscribeFromTopic(topic);
    debugPrint('[PushDeepLink] Unsubscribed from topic: $topic');
  }
}
