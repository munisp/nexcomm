import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/price_change_badge.dart';
import '../../widgets/loading_shimmer.dart';
import '../../widgets/order_book_widget.dart';

final _currentPriceProvider =
    FutureProvider.family.autoDispose<Map<String, dynamic>, String>(
        (ref, symbol) async => nexcomApi.getCurrentPrice(symbol));

class MarketDetailScreen extends ConsumerStatefulWidget {
  final String symbol;
  const MarketDetailScreen({super.key, required this.symbol});

  @override
  ConsumerState<MarketDetailScreen> createState() => _MarketDetailScreenState();
}

class _MarketDetailScreenState extends ConsumerState<MarketDetailScreen> {
  String _interval = '1d';
  String _activeTab = 'Chart'; // 'Chart' | 'Order Book'

  @override
  Widget build(BuildContext context) {
    final priceAsync = ref.watch(_currentPriceProvider(widget.symbol));
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.symbol),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_add_outlined),
            onPressed: () => context.push('/alerts'),
            tooltip: 'Set Price Alert',
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Price header ────────────────────────────────────────────────
          priceAsync.when(
            loading: () => const Padding(
                padding: EdgeInsets.all(16),
                child: LoadingShimmer(height: 80)),
            error: (e, _) => const SizedBox.shrink(),
            data: (price) {
              final currentPrice =
                  (price['price'] as num?)?.toDouble() ?? 0;
              final changePct =
                  (price['changePct'] as num?)?.toDouble() ?? 0;
              return Container(
                padding: const EdgeInsets.all(16),
                color: NexcomTheme.darkSurface,
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.symbol,
                              style: const TextStyle(
                                  color: Color(0xFF9CA3AF), fontSize: 13)),
                          Text(fmt.format(currentPrice),
                              style: const TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w700)),
                          PriceChangeBadge(changePct: changePct),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                            'H: ${fmt.format((price['high'] as num?)?.toDouble() ?? 0)}',
                            style: const TextStyle(
                                color: NexcomTheme.positive, fontSize: 12)),
                        Text(
                            'L: ${fmt.format((price['low'] as num?)?.toDouble() ?? 0)}',
                            style: const TextStyle(
                                color: NexcomTheme.negative, fontSize: 12)),
                        Text('Vol: ${price['volume'] ?? 'N/A'}',
                            style: const TextStyle(
                                color: Color(0xFF6B7280), fontSize: 12)),
                      ],
                    ),
                  ],
                ),
              );
            },
          ),

          // ── Tab bar: Chart | Order Book ─────────────────────────────────
          Container(
            height: 40,
            color: NexcomTheme.darkSurface,
            child: Row(
              children: ['Chart', 'Order Book'].map((tab) {
                final isActive = _activeTab == tab;
                return GestureDetector(
                  onTap: () => setState(() => _activeTab = tab),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(
                          color: isActive
                              ? NexcomTheme.primary
                              : Colors.transparent,
                          width: 2,
                        ),
                      ),
                    ),
                    child: Text(
                      tab,
                      style: TextStyle(
                        color: isActive
                            ? NexcomTheme.primary
                            : const Color(0xFF6B7280),
                        fontSize: 13,
                        fontWeight: isActive
                            ? FontWeight.w600
                            : FontWeight.normal,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),

          // ── Interval selector (only for Chart tab) ──────────────────────
          if (_activeTab == 'Chart')
            Container(
              height: 36,
              color: NexcomTheme.darkSurface,
              child: Row(
                children: ['1h', '4h', '1d', '1w', '1M']
                    .map((interval) => GestureDetector(
                          onTap: () =>
                              setState(() => _interval = interval),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 14),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              border: Border(
                                bottom: BorderSide(
                                  color: _interval == interval
                                      ? NexcomTheme.primary
                                      : Colors.transparent,
                                  width: 2,
                                ),
                              ),
                            ),
                            child: Text(
                              interval,
                              style: TextStyle(
                                color: _interval == interval
                                    ? NexcomTheme.primary
                                    : const Color(0xFF6B7280),
                                fontSize: 13,
                                fontWeight: _interval == interval
                                    ? FontWeight.w600
                                    : FontWeight.normal,
                              ),
                            ),
                          ),
                        ))
                    .toList(),
              ),
            ),

          // ── Content area ────────────────────────────────────────────────
          Expanded(
            child: _activeTab == 'Chart'
                ? Container(
                    color: NexcomTheme.darkBg,
                    child: const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.candlestick_chart_outlined,
                              size: 64, color: Color(0xFF374151)),
                          SizedBox(height: 12),
                          Text('Chart data loading…',
                              style: TextStyle(
                                  color: Color(0xFF6B7280))),
                          SizedBox(height: 4),
                          Text(
                              'Connect to TimescaleDB for live OHLCV',
                              style: TextStyle(
                                  color: Color(0xFF4B5563),
                                  fontSize: 12)),
                        ],
                      ),
                    ),
                  )
                // Live order book via WebSocket
                : SingleChildScrollView(
                    child: OrderBookWidget(symbol: widget.symbol),
                  ),
          ),
        ],
      ),

      // ── Buy / Sell action bar ─────────────────────────────────────────
      bottomNavigationBar: Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(
          color: NexcomTheme.darkSurface,
          border:
              Border(top: BorderSide(color: NexcomTheme.darkBorder)),
        ),
        child: Row(
          children: [
            Expanded(
              child: ElevatedButton(
                onPressed: () => context.push('/trade'),
                style: ElevatedButton.styleFrom(
                    backgroundColor: NexcomTheme.positive),
                child: const Text('BUY',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: () => context.push('/trade'),
                style: ElevatedButton.styleFrom(
                    backgroundColor: NexcomTheme.negative),
                child: const Text('SELL',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
