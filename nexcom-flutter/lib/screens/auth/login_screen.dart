import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../theme.dart';

class LoginScreen extends ConsumerWidget {
  const LoginScreen({super.key});

  static const _oauthUrl = String.fromEnvironment('OAUTH_URL', defaultValue: 'https://nexcom-exchange.manus.space/api/oauth/login?returnPath=/');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              // Logo
              Container(width: 80, height: 80, margin: const EdgeInsets.only(bottom: 24),
                decoration: BoxDecoration(color: NexcomTheme.primary.withOpacity(0.15), borderRadius: BorderRadius.circular(20)),
                child: const Icon(Icons.candlestick_chart, color: NexcomTheme.primary, size: 44)),
              const Text('NEXCOM Exchange', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800), textAlign: TextAlign.center),
              const SizedBox(height: 8),
              const Text('African Commodity Trading Platform', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14), textAlign: TextAlign.center),
              const Spacer(),
              // Features
              ...[
                ('📈', 'Live commodity prices across Africa'),
                ('🏭', 'Warehouse receipt financing'),
                ('🔔', 'Smart price alerts'),
                ('🌾', 'Field agent tools'),
              ].map((item) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(children: [
                  Text(item.$1, style: const TextStyle(fontSize: 20)),
                  const SizedBox(width: 12),
                  Text(item.$2, style: const TextStyle(color: Color(0xFF9CA3AF))),
                ]),
              )),
              const Spacer(),
              ElevatedButton(
                onPressed: () async {
                  final uri = Uri.parse(_oauthUrl);
                  if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
                },
                style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                child: const Text('Sign In with NEXCOM', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(height: 12),
              const Text('Secure login via Manus OAuth', style: TextStyle(color: Color(0xFF4B5563), fontSize: 12), textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
