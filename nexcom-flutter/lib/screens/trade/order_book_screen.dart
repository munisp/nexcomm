import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _orderbookProvider = FutureProvider.family.autoDispose<Map<String, dynamic>, String>((ref, symbol) async {
  return nexcomApi.getPriceHistory(symbol, '1h');
});

class OrderBookScreen extends ConsumerWidget {
  final String symbol;
  const OrderBookScreen({super.key, required this.symbol});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);
    return Scaffold(
      appBar: AppBar(title: Text('Order Book — $symbol')),
      body: const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(Icons.list_alt_outlined, size: 64, color: Color(0xFF374151)),
        SizedBox(height: 12),
        Text('Order book requires WebSocket connection', style: TextStyle(color: Color(0xFF6B7280))),
        SizedBox(height: 4),
        Text('Connect to the matching engine for live depth', style: TextStyle(color: Color(0xFF4B5563), fontSize: 12)),
      ])),
    );
  }
}
