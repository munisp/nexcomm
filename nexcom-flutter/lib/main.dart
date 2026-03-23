import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'router.dart';
import 'theme.dart';
import 'services/notification_service.dart';

final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait + landscape
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // Status bar style
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  // Firebase (optional — graceful fallback if not configured)
  try {
    await Firebase.initializeApp();
    await NotificationService.initialize(flutterLocalNotificationsPlugin);
  } catch (_) {
    // Firebase not configured — push notifications disabled
  }

  runApp(const ProviderScope(child: NexcomApp()));
}

class NexcomApp extends ConsumerWidget {
  const NexcomApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'NEXCOM Exchange',
      debugShowCheckedModeBanner: false,
      theme: NexcomTheme.light,
      darkTheme: NexcomTheme.dark,
      themeMode: ThemeMode.dark,
      routerConfig: router,
    );
  }
}
