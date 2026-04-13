import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _openOrdersProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getOpenOrders();
});

final _orderHistoryProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getOrderHistory(page: 1, limit: 50);
});

final _pricesProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getLivePrices();
});

class TradeScreen extends ConsumerStatefulWidget {
  const TradeScreen({super.key});

  @override
  ConsumerState<TradeScreen> createState() => _TradeScreenState();
}

class _TradeScreenState extends ConsumerState<TradeScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _selectedSymbol = 'WHEAT-SPOT';
  String _side = 'BUY';
  String _orderType = 'LIMIT';
  final _quantityController = TextEditingController();
  final _priceController = TextEditingController();
  final _stopPriceController = TextEditingController();
  bool _isPlacing = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _quantityController.dispose();
    _priceController.dispose();
    _stopPriceController.dispose();
    super.dispose();
  }

  Future<void> _placeOrder() async {
    final qty = double.tryParse(_quantityController.text);
    final price = double.tryParse(_priceController.text);
    if (qty == null || qty <= 0) {
      _showError('Please enter a valid quantity');
      return;
    }
    if (_orderType != 'MARKET' && (price == null || price <= 0)) {
      _showError('Please enter a valid price');
      return;
    }

    setState(() => _isPlacing = true);
    try {
      await nexcomApi.placeOrder(
        symbol: _selectedSymbol,
        side: _side,
        type: _orderType,
        quantity: qty,
        price: _orderType != 'MARKET' ? price : null,
        stopPrice: _orderType == 'STOP_LIMIT' ? double.tryParse(_stopPriceController.text) : null,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('$_side order placed for $_selectedSymbol'),
          backgroundColor: NexcomTheme.positive,
        ));
        _quantityController.clear();
        _priceController.clear();
        ref.invalidate(_openOrdersProvider);
      }
    } catch (e) {
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _isPlacing = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: NexcomTheme.negative,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final pricesAsync = ref.watch(_pricesProvider);
    final openOrdersAsync = ref.watch(_openOrdersProvider);
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trade'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [Tab(text: 'Place Order'), Tab(text: 'Open Orders'), Tab(text: 'History')],
          labelColor: NexcomTheme.primary,
          unselectedLabelColor: Color(0xFF6B7280),
          indicatorColor: NexcomTheme.primary,
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Place Order Tab
          SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Symbol selector
                pricesAsync.when(
                  loading: () => const LoadingShimmer(height: 56),
                  error: (e, _) => const SizedBox.shrink(),
                  data: (prices) => DropdownButtonFormField<String>(
                    value: _selectedSymbol,
                    decoration: const InputDecoration(labelText: 'Commodity Symbol'),
                    items: prices.map<DropdownMenuItem<String>>((p) => DropdownMenuItem(
                      value: p['symbol'] as String,
                      child: Text('${p['symbol']} — ${p['name']}', overflow: TextOverflow.ellipsis),
                    )).toList(),
                    onChanged: (v) => setState(() => _selectedSymbol = v!),
                  ),
                ),
                const SizedBox(height: 16),

                // Buy / Sell toggle
                Row(
                  children: ['BUY', 'SELL'].map((side) => Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _side = side),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        margin: EdgeInsets.only(right: side == 'BUY' ? 4 : 0, left: side == 'SELL' ? 4 : 0),
                        decoration: BoxDecoration(
                          color: _side == side
                              ? (side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative)
                              : NexcomTheme.darkCard,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative,
                          ),
                        ),
                        child: Text(
                          side,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _side == side ? Colors.white : (side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  )).toList(),
                ),
                const SizedBox(height: 16),

                // Order type
                DropdownButtonFormField<String>(
                  value: _orderType,
                  decoration: const InputDecoration(labelText: 'Order Type'),
                  items: ['MARKET', 'LIMIT', 'STOP_LIMIT', 'STOP_MARKET'].map((t) =>
                    DropdownMenuItem(value: t, child: Text(t))).toList(),
                  onChanged: (v) => setState(() => _orderType = v!),
                ),
                const SizedBox(height: 12),

                // Quantity
                TextField(
                  controller: _quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Quantity (MT)', hintText: '0.00'),
                ),
                const SizedBox(height: 12),

                // Price (hidden for MARKET orders)
                if (_orderType != 'MARKET') ...[
                  TextField(
                    controller: _priceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Price (₦)', hintText: '0.00'),
                  ),
                  const SizedBox(height: 12),
                ],

                // Stop price (only for STOP_LIMIT)
                if (_orderType == 'STOP_LIMIT') ...[
                  TextField(
                    controller: _stopPriceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Stop Price (₦)', hintText: '0.00'),
                  ),
                  const SizedBox(height: 12),
                ],

                // Place Order button
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _isPlacing ? null : _placeOrder,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative,
                    ),
                    child: _isPlacing
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text('Place $_side Order', style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ),
          ),

          // Open Orders Tab
          openOrdersAsync.when(
            loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList()),
            error: (e, _) => Center(child: Text('Error: $e')),
            data: (orders) => orders.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.pending_outlined, size: 48, color: Color(0xFF374151)),
                        SizedBox(height: 12),
                        Text('No open orders', style: TextStyle(color: Color(0xFF6B7280))),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: orders.length,
                    itemBuilder: (context, i) {
                      final order = orders[i];
                      final side = order['side'] as String? ?? 'BUY';
                      final sideColor = side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative;
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: NexcomTheme.darkCard,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: NexcomTheme.darkBorder),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: sideColor.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(side, style: TextStyle(color: sideColor, fontWeight: FontWeight.w700, fontSize: 12)),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${order['symbol']} — ${order['type']}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                  Text('Qty: ${order['quantity']} @ ${fmt.format((order['price'] as num?)?.toDouble() ?? 0)}',
                                    style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                                ],
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.cancel_outlined, color: NexcomTheme.negative, size: 20),
                              onPressed: () async {
                                await nexcomApi.cancelOrder(order['id'] as int);
                                ref.invalidate(_openOrdersProvider);
                              },
                            ),
                          ],
                        ),
                      );
                    },
                              );

          // Order History Tab
          Builder(builder: (context) {
            final orderHistoryAsync = ref.watch(_orderHistoryProvider);
            final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);
            return orderHistoryAsync.when(
              loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList()),
              error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: NexcomTheme.negative))),
              data: (orders) => orders.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.history_outlined, size: 48, color: Color(0xFF374151)),
                          SizedBox(height: 12),
                          Text('No order history', style: TextStyle(color: Color(0xFF6B7280))),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () async => ref.invalidate(_orderHistoryProvider),
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: orders.length,
                        itemBuilder: (context, i) {
                          final order = orders[i];
                          final side = order['side'] as String? ?? 'BUY';
                          final status = order['status'] as String? ?? 'FILLED';
                          final sideColor = side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative;
                          final statusColor = status == 'FILLED'
                              ? NexcomTheme.positive
                              : status == 'CANCELLED'
                                  ? NexcomTheme.negative
                                  : NexcomTheme.primary;
                          final createdAt = order['createdAt'] != null
                              ? DateFormat('dd MMM yyyy HH:mm').format(DateTime.tryParse(order['createdAt'].toString()) ?? DateTime.now())
                              : '';
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: NexcomTheme.darkCard,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: NexcomTheme.darkBorder),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: sideColor.withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(side, style: TextStyle(color: sideColor, fontWeight: FontWeight.w700, fontSize: 11)),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('${order['symbol']} — ${order['type']}',
                                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                                      Text('Qty: ${order['quantity']} @ ${fmt.format((order['price'] as num?)?.toDouble() ?? 0)}',
                                        style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                                      if (createdAt.isNotEmpty)
                                        Text(createdAt, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                                    ],
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: statusColor.withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(status, style: TextStyle(color: statusColor, fontWeight: FontWeight.w600, fontSize: 11)),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
            );
          }),
        ],
      ),
    );
  }
}

