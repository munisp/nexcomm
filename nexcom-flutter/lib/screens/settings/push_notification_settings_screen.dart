import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';
import '../../theme.dart';

class PushNotificationSettingsScreen extends ConsumerStatefulWidget {
  const PushNotificationSettingsScreen({super.key});
  @override
  ConsumerState<PushNotificationSettingsScreen> createState() => _PushNotificationSettingsScreenState();
}

class _PushNotificationSettingsScreenState extends ConsumerState<PushNotificationSettingsScreen> {
  bool _priceAlerts = true;
  bool _tradeConfirmations = true;
  bool _settlementReminders = true;
  bool _kycUpdates = true;
  bool _systemAnnouncements = false;
  bool _isSaving = false;

  Future<void> _save() async {
    setState(() => _isSaving = true);
    try {
      await nexcomApi.registerPushToken(token: 'flutter-device-token', platform: 'android');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Notification preferences saved'), backgroundColor: NexcomTheme.positive));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: NexcomTheme.negative));
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Push Notifications')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        _Toggle('Price Alerts', 'Get notified when your price targets are hit', _priceAlerts, (v) => setState(() => _priceAlerts = v)),
        _Toggle('Trade Confirmations', 'Order fills and cancellations', _tradeConfirmations, (v) => setState(() => _tradeConfirmations = v)),
        _Toggle('Settlement Reminders', 'T+2 settlement due dates', _settlementReminders, (v) => setState(() => _settlementReminders = v)),
        _Toggle('KYC Updates', 'Verification status changes', _kycUpdates, (v) => setState(() => _kycUpdates = v)),
        _Toggle('System Announcements', 'Platform news and maintenance', _systemAnnouncements, (v) => setState(() => _systemAnnouncements = v)),
        const SizedBox(height: 24),
        SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _isSaving ? null : _save, child: _isSaving ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Save Preferences'))),
      ]),
    );
  }
}

class _Toggle extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  const _Toggle(this.title, this.subtitle, this.value, this.onChanged);
  @override
  Widget build(BuildContext context) => SwitchListTile(value: value, onChanged: onChanged, title: Text(title), subtitle: Text(subtitle, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)), activeColor: NexcomTheme.primary, contentPadding: EdgeInsets.zero);
}
