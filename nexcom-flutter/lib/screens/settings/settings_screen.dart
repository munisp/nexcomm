import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../theme.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';

// ── Providers ─────────────────────────────────────────────────────────────────
final _preferencesProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return nexcomApi.getPreferences();
});

final _notifPrefsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return nexcomApi.getNotifPreferences();
});

final _biometricProvider = FutureProvider<bool>((ref) async {
  return nexcomApi.getBiometricEnabled();
});

// ── Screen ────────────────────────────────────────────────────────────────────
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _savingBiometric = false;
  bool _savingDarkMode = false;
  bool _savingNotif = false;

  Future<void> _toggleBiometric(bool value) async {
    setState(() => _savingBiometric = true);
    try {
      await nexcomApi.setBiometricEnabled(value);
      ref.invalidate(_biometricProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update biometric: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _savingBiometric = false);
    }
  }

  Future<void> _toggleDarkMode(bool value) async {
    setState(() => _savingDarkMode = true);
    try {
      await nexcomApi.updatePreferences({'theme': value ? 'dark' : 'light'});
      ref.invalidate(_preferencesProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update theme: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _savingDarkMode = false);
    }
  }

  Future<void> _toggleNotif(String key, bool value) async {
    setState(() => _savingNotif = true);
    try {
      await nexcomApi.updateNotifPreferences({key: value});
      ref.invalidate(_notifPrefsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update notification preference: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _savingNotif = false);
    }
  }

  Future<void> _logout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(onPressed: () => ctx.pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => ctx.pop(true),
            child: const Text('Sign Out', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(authStateProvider.notifier).logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final user = authState.valueOrNull?.user;
    final prefsAsync = ref.watch(_preferencesProvider);
    final notifAsync = ref.watch(_notifPrefsProvider);
    final biometricAsync = ref.watch(_biometricProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(_preferencesProvider);
              ref.invalidate(_notifPrefsProvider);
              ref.invalidate(_biometricProvider);
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Profile section ─────────────────────────────────────────────
          if (user != null) ...[
            const _SectionHeader('Account'),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: NexcomTheme.primary.withOpacity(0.15),
                child: Text(
                  (user['name'] as String? ?? 'U').substring(0, 1).toUpperCase(),
                  style: const TextStyle(color: NexcomTheme.primary, fontWeight: FontWeight.bold),
                ),
              ),
              title: Text(user['name'] as String? ?? 'User'),
              subtitle: Text(user['email'] as String? ?? ''),
              trailing: Chip(
                label: Text(
                  (user['role'] as String? ?? 'user').toUpperCase(),
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600),
                ),
                backgroundColor: NexcomTheme.primary.withOpacity(0.1),
              ),
              contentPadding: EdgeInsets.zero,
            ),
            const Divider(height: 1),
          ],

          // ── Notifications ────────────────────────────────────────────────
          const _SectionHeader('Notifications'),
          notifAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: LinearProgressIndicator(),
            ),
            error: (e, _) => ListTile(
              leading: const Icon(Icons.error_outline, color: Colors.red),
              title: Text('Failed to load: $e'),
              contentPadding: EdgeInsets.zero,
            ),
            data: (notif) => Column(
              children: [
                _NotifTile(
                  icon: Icons.price_change_outlined,
                  title: 'Price Alerts',
                  value: (notif['priceAlerts'] as bool?) ?? true,
                  saving: _savingNotif,
                  onChanged: (v) => _toggleNotif('priceAlerts', v),
                ),
                _NotifTile(
                  icon: Icons.swap_horiz,
                  title: 'Order Updates',
                  value: (notif['orderUpdates'] as bool?) ?? true,
                  saving: _savingNotif,
                  onChanged: (v) => _toggleNotif('orderUpdates', v),
                ),
                _NotifTile(
                  icon: Icons.account_balance_wallet_outlined,
                  title: 'Deposit / Withdrawal',
                  value: (notif['depositWithdrawal'] as bool?) ?? true,
                  saving: _savingNotif,
                  onChanged: (v) => _toggleNotif('depositWithdrawal', v),
                ),
                _NotifTile(
                  icon: Icons.campaign_outlined,
                  title: 'System Announcements',
                  value: (notif['systemAnnouncements'] as bool?) ?? true,
                  saving: _savingNotif,
                  onChanged: (v) => _toggleNotif('systemAnnouncements', v),
                ),
              ],
            ),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined, color: NexcomTheme.primary),
            title: const Text('Push Notifications'),
            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
            onTap: () => context.push('/settings/push-notifications'),
            contentPadding: EdgeInsets.zero,
          ),
          const Divider(height: 1),

          // ── Security ─────────────────────────────────────────────────────
          const _SectionHeader('Security'),
          biometricAsync.when(
            loading: () => const ListTile(
              leading: Icon(Icons.fingerprint, color: NexcomTheme.primary),
              title: Text('Biometric Login'),
              trailing: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              contentPadding: EdgeInsets.zero,
            ),
            error: (_, __) => const ListTile(
              leading: Icon(Icons.fingerprint, color: NexcomTheme.primary),
              title: Text('Biometric Login'),
              subtitle: Text('Unavailable', style: TextStyle(color: Colors.red, fontSize: 12)),
              contentPadding: EdgeInsets.zero,
            ),
            data: (enabled) => ListTile(
              leading: const Icon(Icons.fingerprint, color: NexcomTheme.primary),
              title: const Text('Biometric Login'),
              trailing: _savingBiometric
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Switch(value: enabled, onChanged: _toggleBiometric, activeColor: NexcomTheme.primary),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.lock_outline, color: NexcomTheme.primary),
            title: const Text('Two-Factor Authentication'),
            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
            onTap: () => context.push('/settings/totp'),
            contentPadding: EdgeInsets.zero,
          ),
          ListTile(
            leading: const Icon(Icons.devices_outlined, color: NexcomTheme.primary),
            title: const Text('Active Sessions'),
            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
            onTap: () => context.push('/settings/sessions'),
            contentPadding: EdgeInsets.zero,
          ),
          const Divider(height: 1),

          // ── Display ──────────────────────────────────────────────────────
          const _SectionHeader('Display'),
          prefsAsync.when(
            loading: () => const ListTile(
              leading: Icon(Icons.dark_mode_outlined, color: NexcomTheme.primary),
              title: Text('Dark Mode'),
              trailing: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              contentPadding: EdgeInsets.zero,
            ),
            error: (_, __) => ListTile(
              leading: const Icon(Icons.dark_mode_outlined, color: NexcomTheme.primary),
              title: const Text('Dark Mode'),
              trailing: Switch(value: true, onChanged: _toggleDarkMode, activeColor: NexcomTheme.primary),
              contentPadding: EdgeInsets.zero,
            ),
            data: (prefs) {
              final isDark = (prefs['theme'] as String? ?? 'dark') == 'dark';
              return ListTile(
                leading: const Icon(Icons.dark_mode_outlined, color: NexcomTheme.primary),
                title: const Text('Dark Mode'),
                trailing: _savingDarkMode
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Switch(value: isDark, onChanged: _toggleDarkMode, activeColor: NexcomTheme.primary),
                contentPadding: EdgeInsets.zero,
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.language_outlined, color: NexcomTheme.primary),
            title: const Text('Language & Currency'),
            trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
            onTap: () => context.push('/settings/preferences'),
            contentPadding: EdgeInsets.zero,
          ),
          const Divider(height: 1),

          // ── About ────────────────────────────────────────────────────────
          const _SectionHeader('About'),
          const ListTile(
            leading: Icon(Icons.info_outline, color: NexcomTheme.primary),
            title: Text('Version'),
            trailing: Text('1.0.0', style: TextStyle(color: Color(0xFF6B7280))),
            contentPadding: EdgeInsets.zero,
          ),
          const Divider(height: 1),

          // ── Sign out ─────────────────────────────────────────────────────
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _logout,
            icon: const Icon(Icons.logout, color: Colors.red),
            label: const Text('Sign Out', style: TextStyle(color: Colors.red)),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Colors.red),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

// ── Helper widgets ────────────────────────────────────────────────────────────
class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Text(
      title,
      style: const TextStyle(
        color: Color(0xFF6B7280),
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.5,
      ),
    ),
  );
}

class _NotifTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final bool value;
  final bool saving;
  final ValueChanged<bool> onChanged;

  const _NotifTile({
    required this.icon,
    required this.title,
    required this.value,
    required this.saving,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icon, color: NexcomTheme.primary),
    title: Text(title),
    trailing: saving
        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
        : Switch(value: value, onChanged: onChanged, activeColor: NexcomTheme.primary),
    contentPadding: EdgeInsets.zero,
  );
}
