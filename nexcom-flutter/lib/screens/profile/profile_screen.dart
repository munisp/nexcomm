import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _profileProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getAccountProfile();
});
final _balanceProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getAccountBalance();
});

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider).valueOrNull;
    final profileAsync = ref.watch(_profileProvider);
    final balanceAsync = ref.watch(_balanceProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // Avatar & name
        Center(child: Column(children: [
          CircleAvatar(radius: 40, backgroundColor: NexcomTheme.primary.withOpacity(0.2),
            child: Text(authState?.displayName.substring(0, 1).toUpperCase() ?? 'U',
              style: const TextStyle(fontSize: 32, color: NexcomTheme.primary, fontWeight: FontWeight.w700))),
          const SizedBox(height: 12),
          Text(authState?.displayName ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          Text(authState?.role?.toUpperCase() ?? 'USER', style: const TextStyle(color: NexcomTheme.primary, fontSize: 12)),
        ])),
        const SizedBox(height: 24),
        // Balance card
        balanceAsync.when(
          loading: () => const LoadingShimmer(height: 80),
          error: (e, _) => const SizedBox.shrink(),
          data: (b) => Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: NexcomTheme.darkCard, borderRadius: BorderRadius.circular(12), border: Border.all(color: NexcomTheme.darkBorder)),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Available Balance', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                Text('₦${((b['available'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              ])),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                const Text('Margin Used', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                Text('₦${((b['marginUsed'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: NexcomTheme.accent)),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        // Menu items
        _MenuItem(icon: Icons.verified_user_outlined, label: 'KYC Verification', onTap: () => context.push('/profile/kyc')),
        _MenuItem(icon: Icons.notifications_outlined, label: 'Push Notifications', onTap: () => context.push('/settings/push-notifications')),
        _MenuItem(icon: Icons.notifications_active_outlined, label: 'Price Alerts', onTap: () => context.push('/alerts')),
        _MenuItem(icon: Icons.settings_outlined, label: 'Settings', onTap: () => context.push('/settings')),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => ref.read(authStateProvider.notifier).logout(),
          icon: const Icon(Icons.logout, color: NexcomTheme.negative),
          label: const Text('Sign Out', style: TextStyle(color: NexcomTheme.negative)),
          style: OutlinedButton.styleFrom(side: const BorderSide(color: NexcomTheme.negative)),
        ),
      ]),
    );
  }
}

class _MenuItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _MenuItem({required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) => ListTile(
    leading: Icon(icon, color: NexcomTheme.primary),
    title: Text(label),
    trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
    onTap: onTap,
    contentPadding: EdgeInsets.zero,
  );
}
