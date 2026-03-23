import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _receiptProvider = FutureProvider.family.autoDispose<Map<String, dynamic>, String>((ref, id) async {
  return nexcomApi.getWarehouseReceipt(id);
});

class WarehouseDetailScreen extends ConsumerWidget {
  final String receiptId;
  const WarehouseDetailScreen({super.key, required this.receiptId});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final receiptAsync = ref.watch(_receiptProvider(receiptId));
    return Scaffold(
      appBar: AppBar(title: Text('Receipt #$receiptId')),
      body: receiptAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList(count: 6)),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (r) => ListView(padding: const EdgeInsets.all(16), children: [
          _DetailRow('Commodity', r['commodity'] as String? ?? ''),
          _DetailRow('Quantity', '${r['quantity']} MT'),
          _DetailRow('Grade', r['grade'] as String? ?? 'N/A'),
          _DetailRow('Warehouse', r['warehouseName'] as String? ?? ''),
          _DetailRow('Status', r['status'] as String? ?? ''),
          _DetailRow('Value', NumberFormat.currency(symbol: '₦', decimalDigits: 2).format((r['value'] as num?)?.toDouble() ?? 0)),
          _DetailRow('Expiry', r['expiryDate'] as String? ?? 'N/A'),
        ]),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;
  const _DetailRow(this.label, this.value);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(children: [
      SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Color(0xFF9CA3AF)))),
      Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w500))),
    ]),
  );
}
