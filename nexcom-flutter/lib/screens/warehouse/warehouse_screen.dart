import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _receiptsProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getWarehouseReceipts();
});

class WarehouseScreen extends ConsumerWidget {
  const WarehouseScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final receiptsAsync = ref.watch(_receiptsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Warehouse Receipts'),
        actions: [
          IconButton(icon: const Icon(Icons.add), onPressed: () => _showCreateDialog(context, ref)),
          IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(_receiptsProvider)),
        ],
      ),
      body: receiptsAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (receipts) => receipts.isEmpty
          ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.warehouse_outlined, size: 64, color: Color(0xFF374151)),
              SizedBox(height: 12),
              Text('No warehouse receipts', style: TextStyle(color: Color(0xFF6B7280))),
            ]))
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: receipts.length,
              itemBuilder: (ctx, i) {
                final r = receipts[i];
                final status = r['status'] as String? ?? 'ACTIVE';
                final statusColor = status == 'ACTIVE' ? NexcomTheme.positive : status == 'PLEDGED' ? NexcomTheme.accent : const Color(0xFF6B7280);
                return GestureDetector(
                  onTap: () => context.push('/warehouse/${r['id']}'),
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: NexcomTheme.darkCard, borderRadius: BorderRadius.circular(12), border: Border.all(color: NexcomTheme.darkBorder)),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Receipt #${r['receiptNumber'] ?? r['id']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('${r['commodity']} — ${r['quantity']} MT', style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        Text(r['warehouseName'] as String? ?? '', style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                      ])),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)), child: Text(status, style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w600))),
                        const SizedBox(height: 4),
                        Text(NumberFormat.currency(symbol: '₦', decimalDigits: 0).format((r['value'] as num?)?.toDouble() ?? 0), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                      ]),
                    ]),
                  ),
                );
              },
            ),
      ),
    );
  }

  void _showCreateDialog(BuildContext context, WidgetRef ref) {
    showDialog(context: context, builder: (_) => AlertDialog(
      backgroundColor: NexcomTheme.darkCard,
      title: const Text('New Warehouse Receipt'),
      content: const Text('Use the web platform to create warehouse receipts with full document upload support.', style: TextStyle(color: Color(0xFF9CA3AF))),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
    ));
  }
}
