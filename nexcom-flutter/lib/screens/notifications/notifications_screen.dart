import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';
import '../../providers/loan_notification_provider.dart';

final _notificationsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getNotifications();
});

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifAsync = ref.watch(_notificationsProvider);
    final loanState = ref.watch(loanNotificationsProvider);
    final loanNotifier = ref.read(loanNotificationsProvider.notifier);
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          const Text('Notifications'),
          if (loanState.unreadCount > 0) ...[const SizedBox(width: 8), Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(color: NexcomTheme.primary, borderRadius: BorderRadius.circular(10)),
            child: Text('${loanState.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
          )],
        ]),
        actions: [
          TextButton(onPressed: () async { loanNotifier.markAllRead(); await nexcomApi.markAllNotificationsRead(); ref.invalidate(_notificationsProvider); }, child: const Text('Mark All Read', style: TextStyle(color: NexcomTheme.primary, fontSize: 12))),
        ],
      ),
      body: CustomScrollView(slivers: [
        // Live loan notifications
        if (loanState.events.isNotEmpty) ...[SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 8), child: Row(children: [
          const Icon(Icons.bolt, color: NexcomTheme.primary, size: 16), const SizedBox(width: 6),
          const Text('Live Loan Alerts', style: TextStyle(color: NexcomTheme.primary, fontWeight: FontWeight.w700, fontSize: 13)),
          const Spacer(),
          GestureDetector(onTap: loanNotifier.clearEvents, child: const Text('Clear', style: TextStyle(color: Color(0xFF6B7280), fontSize: 12))),
        ]))),
        SliverList(delegate: SliverChildBuilderDelegate((ctx, i) {
          final event = loanState.events[i];
          return Container(margin: const EdgeInsets.fromLTRB(12, 0, 12, 6), padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: NexcomTheme.primary.withOpacity(0.06), borderRadius: BorderRadius.circular(10), border: Border.all(color: NexcomTheme.primary.withOpacity(0.25))),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(event.isLoanEvent ? '💰' : '🛡️', style: const TextStyle(fontSize: 18)),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(event.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                if (event.message != null) Text(event.message!, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                if (event.amount != null) Text('₦${event.amount!.toStringAsFixed(0)}', style: const TextStyle(color: NexcomTheme.primary, fontSize: 12, fontWeight: FontWeight.w600)),
              ])),
            ]),
          );
        }, childCount: loanState.events.length > 5 ? 5 : loanState.events.length)),
        const SliverToBoxAdapter(child: Divider(height: 24))],
        // Persisted DB notifications
        notifAsync.when(
          loading: () => const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList())),
          error: (e, _) => SliverToBoxAdapter(child: Center(child: Padding(padding: const EdgeInsets.all(16), child: Text('Error: $e')))),
          data: (data) {
            final notifs = data['notifications'] as List? ?? [];
            if (notifs.isEmpty && loanState.events.isEmpty) return const SliverFillRemaining(child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.notifications_none, size: 64, color: Color(0xFF374151)), SizedBox(height: 12), Text('No notifications', style: TextStyle(color: Color(0xFF6B7280)))])));
            if (notifs.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());
            return SliverList(delegate: SliverChildBuilderDelegate((ctx, i) {
              final n = notifs[i];
              final isRead = n['read'] == true;
              return GestureDetector(
                onTap: () async { if (!isRead) { await nexcomApi.markNotificationRead(n['id'] as int); ref.invalidate(_notificationsProvider); } },
                child: Container(margin: const EdgeInsets.fromLTRB(12, 0, 12, 6), padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: isRead ? NexcomTheme.darkCard : NexcomTheme.primary.withOpacity(0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: isRead ? NexcomTheme.darkBorder : NexcomTheme.primary.withOpacity(0.3))),
                  child: Row(children: [
                    if (!isRead) Container(width: 8, height: 8, margin: const EdgeInsets.only(right: 10), decoration: const BoxDecoration(color: NexcomTheme.primary, shape: BoxShape.circle)),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(n['title'] as String? ?? '', style: TextStyle(fontWeight: isRead ? FontWeight.normal : FontWeight.w600, fontSize: 13)),
                      Text(n['message'] as String? ?? '', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                    ])),
                  ]),
                ),
              );
            }, childCount: notifs.length));
          },
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 20)),
      ]),
    );
  }
}
