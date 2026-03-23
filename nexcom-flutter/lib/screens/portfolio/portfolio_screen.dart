import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';
import '../../widgets/price_change_badge.dart';

final _portfolioProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return nexcomApi.getPortfolioSummary();
});
final _positionsProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getPositions();
});
final _tradeHistoryProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getTradeHistory();
});

class PortfolioScreen extends ConsumerStatefulWidget {
  const PortfolioScreen({super.key});
  @override
  ConsumerState<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends ConsumerState<PortfolioScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);
    final portfolioAsync = ref.watch(_portfolioProvider);
    final positionsAsync = ref.watch(_positionsProvider);
    final historyAsync = ref.watch(_tradeHistoryProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Portfolio'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(_portfolioProvider);
              ref.invalidate(_positionsProvider);
              ref.invalidate(_tradeHistoryProvider);
            },
          ),
        ],
        bottom: TabBar(
          controller: _tab,
          tabs: const [Tab(text: 'Positions'), Tab(text: 'History')],
          labelColor: NexcomTheme.primary,
          unselectedLabelColor: const Color(0xFF6B7280),
          indicatorColor: NexcomTheme.primary,
        ),
      ),
      body: Column(
        children: [
          portfolioAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(16),
              child: LoadingShimmer(height: 80),
            ),
            error: (e, _) => const SizedBox.shrink(),
            data: (p) => Container(
              padding: const EdgeInsets.all(16),
              color: NexcomTheme.darkSurface,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Total Value',
                            style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        Text(
                          fmt.format((p['totalValue'] as num?)?.toDouble() ?? 0),
                          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      const Text('P&L',
                          style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                      Text(
                        fmt.format((p['totalPnl'] as num?)?.toDouble() ?? 0),
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: ((p['totalPnl'] as num?)?.toDouble() ?? 0) >= 0
                              ? NexcomTheme.positive
                              : NexcomTheme.negative,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tab,
              children: [
                // Positions tab
                positionsAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(16),
                    child: LoadingShimmerList(),
                  ),
                  error: (e, _) => Center(child: Text('Error: $e')),
                  data: (positions) => positions.isEmpty
                      ? const Center(
                          child: Text('No open positions',
                              style: TextStyle(color: Color(0xFF6B7280))),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: positions.length,
                          itemBuilder: (ctx, i) {
                            final pos = positions[i];
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
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(pos['symbol'] as String? ?? '',
                                            style: const TextStyle(fontWeight: FontWeight.w600)),
                                        Text(
                                          'Qty: ${pos['quantity']} @ ${fmt.format((pos['avgPrice'] as num?)?.toDouble() ?? 0)}',
                                          style: const TextStyle(
                                              color: Color(0xFF9CA3AF), fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        fmt.format((pos['currentValue'] as num?)?.toDouble() ?? 0),
                                        style: const TextStyle(fontWeight: FontWeight.w600),
                                      ),
                                      PriceChangeBadge(
                                          changePct:
                                              (pos['pnlPct'] as num?)?.toDouble() ?? 0),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
                // History tab
                historyAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(16),
                    child: LoadingShimmerList(),
                  ),
                  error: (e, _) => Center(child: Text('Error: $e')),
                  data: (trades) => trades.isEmpty
                      ? const Center(
                          child: Text('No trade history',
                              style: TextStyle(color: Color(0xFF6B7280))),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: trades.length,
                          itemBuilder: (ctx, i) {
                            final trade = trades[i];
                            final side = trade['side'] as String? ?? 'BUY';
                            final sideColor =
                                side == 'BUY' ? NexcomTheme.positive : NexcomTheme.negative;
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
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: sideColor.withOpacity(0.15),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(side,
                                        style: TextStyle(
                                            color: sideColor,
                                            fontWeight: FontWeight.w700,
                                            fontSize: 12)),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text('${trade['symbol']}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w600, fontSize: 13)),
                                        Text(
                                          '${trade['quantity']} MT @ ${fmt.format((trade['price'] as num?)?.toDouble() ?? 0)}',
                                          style: const TextStyle(
                                              color: Color(0xFF9CA3AF), fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    fmt.format((trade['total'] as num?)?.toDouble() ?? 0),
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600, fontSize: 13),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
