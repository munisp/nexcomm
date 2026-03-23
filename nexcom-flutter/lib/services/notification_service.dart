import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

class NotificationService {
  static Future<void> initialize(FlutterLocalNotificationsPlugin plugin) async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(requestAlertPermission: true, requestBadgePermission: true, requestSoundPermission: true);
    const settings = InitializationSettings(android: androidSettings, iOS: iosSettings);
    await plugin.initialize(settings);

    // Request FCM permission
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification != null) {
        plugin.show(notification.hashCode, notification.title, notification.body,
          const NotificationDetails(
            android: AndroidNotificationDetails('nexcom_channel', 'NEXCOM Alerts', importance: Importance.high, priority: Priority.high),
            iOS: DarwinNotificationDetails(),
          ),
        );
      }
    });
  }

  static Future<String?> getToken() async {
    return FirebaseMessaging.instance.getToken();
  }
}
