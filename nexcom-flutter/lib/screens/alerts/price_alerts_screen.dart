import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _alertsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getPriceAlerts();
});

class PriceAlertsScreen extends ConsumerStatefulWidget {
  const PriceAlertsScreen({super.key});
  @override
  ConsumerState<PriceAlertsScreen> createState() => _PriceAlertsScreenState();
}

class _PriceAlertsScreenState extends ConsumerState<PriceAlertsScreen> {
  final _symbolCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  String _condition = 'ABOVE';

  @override
  void dispose() { _symbolCtrl.dispose(); _priceCtrl.dispose(); super.dispose(); }

  Future<void> _createAlert() async {
    final price = double.tryParse(_priceCtrl.text);
    if (_symbolCtrl.text.isEmpty || price == null) return;
    await nexcomApi.createPriceAlert(symbol: _symbolCtrl.text.toUpperCase(), condition: _condition, targetPrice: price);
    ref.invalidate(_alertsProvider);
    if (mounted) { _symbolCtrl.clear(); _priceCtrl.clear(); Navigator.pop(context); }
  }

  void _showCreateDialog() {
    showModalBottomSheet(context: context, backgroundColor: NexcomTheme.darkCard, isScrollControlled: true,
      builder: (_) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('New Price Alert', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          TextField(controller: _symbolCtrl, decoration: const InputDecoration(labelText: 'Symbol (e.g. WHEAT-SPOT)'), textCapitalization: TextCapitalization.characters),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(value: _condition, decoration: const InputDecoration(labelText: 'Condition'),
            items: ['ABOVE', 'BELOW', 'CROSS_ABOVE', 'CROSS_BELOW'].map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
            onChanged: (v) => setState(() => _condition = v!)),
          const SizedBox(height: 12),
          TextField(controller: _priceCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Target Price (₦)')),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: _createAlert, child: const Text('Create Alert'))),
          const SizedBox(height: 16),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final alertsAsync = ref.watch(_alertsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Price Alerts'), actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(_alertsProvider))]),
      floatingActionButton: FloatingActionButton(onPressed: _showCreateDialog, backgroundColor: NexcomTheme.primary, child: const Icon(Icons.add)),
      body: alertsAsync.when(
        loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (data) {
          final active = data['active'] as List? ?? [];
          final triggered = data['triggered'] as List? ?? [];
          if (active.isEmpty && triggered.isEmpty) return const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(Icons.notifications_off_outlined, size: 64, color: Color(0xFF374151)),
            SizedBox(height: 12),
            Text('No price alerts', style: TextStyle(color: Color(0xFF6B7280))),
          ]));
          return ListView(padding: const EdgeInsets.all(12), children: [
            if (active.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Active', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF9CA3AF)))),
              ...active.map((a) => _AlertTile(alert: a, onDelete: () async { await nexcomApi.deletePriceAlert(a['id'] as int); ref.invalidate(_alertsProvider); })),
            ],
            if (triggered.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Triggered', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF9CA3AF)))),
              ...triggered.map((a) => _AlertTile(alert: a, onDelete: () async { await nexcomApi.deletePriceAlert(a['id'] as int); ref.invalidate(_alertsProvider); }, triggered: true)),
            ],
          ]);
        },
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  final dynamic alert;
  final VoidCallback onDelete;
  final bool triggered;
  const _AlertTile({required this.alert, required this.onDelete, this.triggered = false});
  @override
  Widget build(BuildContext context) {
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);
    return Container(margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: NexcomTheme.darkCard, borderRadius: BorderRadius.circular(10), border: Border.all(color: triggered ? NexcomTheme.accent.withOpacity(0.3) : NexcomTheme.darkBorder)),
      child: Row(children: [
        Icon(triggered ? Icons.notifications_active : Icons.notifications_outlined, color: triggered ? NexcomTheme.accent : NexcomTheme.primary, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${alert['symbol']} ${alert['condition']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          Text(fmt.format((alert['targetPrice'] as num?)?.toDouble() ?? 0), style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
        ])),
        IconButton(icon: const Icon(Icons.delete_outline, color: NexcomTheme.negative, size: 18), onPressed: onDelete),
      ]),
    );
  }
}
