import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../theme.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const _SectionHeader('Notifications'),
        ListTile(leading: const Icon(Icons.notifications_outlined, color: NexcomTheme.primary), title: const Text('Push Notifications'), trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)), onTap: () => context.push('/settings/push-notifications'), contentPadding: EdgeInsets.zero),
        const Divider(height: 1),
        const _SectionHeader('Security'),
        ListTile(leading: const Icon(Icons.fingerprint, color: NexcomTheme.primary), title: const Text('Biometric Login'), trailing: Switch(value: true, onChanged: (_) {}, activeColor: NexcomTheme.primary), contentPadding: EdgeInsets.zero),
        const Divider(height: 1),
        const _SectionHeader('Display'),
        ListTile(leading: const Icon(Icons.dark_mode_outlined, color: NexcomTheme.primary), title: const Text('Dark Mode'), trailing: Switch(value: true, onChanged: (_) {}, activeColor: NexcomTheme.primary), contentPadding: EdgeInsets.zero),
        const Divider(height: 1),
        const _SectionHeader('About'),
        const ListTile(leading: Icon(Icons.info_outline, color: NexcomTheme.primary), title: Text('Version'), trailing: Text('1.0.0', style: TextStyle(color: Color(0xFF6B7280))), contentPadding: EdgeInsets.zero),
      ]),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 16, bottom: 8), child: Text(title, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.5)));
}
