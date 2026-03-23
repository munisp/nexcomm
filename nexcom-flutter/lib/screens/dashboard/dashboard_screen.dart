import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/price_change_badge.dart';
import '../../widgets/stat_card.dart';
import '../../widgets/loading_shimmer.dart';

final _portfolioProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return nexcomApi.getPortfolioSummary();
});

final _marketSummaryProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return nexcomApi.getMarketSummary();
});

final _livePricesProvider = FutureProvider<List<dynamic>>((ref) async {
  return nexcomApi.getLivePrices();
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider).valueOrNull;
    final portfolioAsync = ref.watch(_portfolioProvider);
    final marketAsync = ref.watch(_marketSummaryProvider);
    final pricesAsync = ref.watch(_livePricesProvider);

    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);
    final pctFmt = NumberFormat('+0.00%;-0.00%');

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('NEXCOM Exchange', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            Text(
              'Welcome back, ${authState?.displayName ?? '...'}',
              style: const TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {
              ref.invalidate(_portfolioProvider);
              ref.invalidate(_marketSummaryProvider);
              ref.invalidate(_livePricesProvider);
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        color: NexcomTheme.primary,
        onRefresh: () async {
          ref.invalidate(_portfolioProvider);
          ref.invalidate(_marketSummaryProvider);
          ref.invalidate(_livePricesProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Portfolio Summary Card
            portfolioAsync.when(
              loading: () => const LoadingShimmer(height: 140),
              error: (e, _) => _ErrorCard(message: e.toString()),
              data: (portfolio) => _PortfolioCard(portfolio: portfolio, fmt: fmt, pctFmt: pctFmt),
            ),
            const SizedBox(height: 16),

            // Quick Actions
            _QuickActionsRow(),
            const SizedBox(height: 16),

            // Market Summary
            marketAsync.when(
              loading: () => const LoadingShimmer(height: 100),
              error: (e, _) => const SizedBox.shrink(),
              data: (summary) => _MarketSummaryRow(summary: summary),
            ),
            const SizedBox(height: 16),

            // Live Prices
            const Text('Live Prices', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            pricesAsync.when(
              loading: () => Column(
                children: List.generate(5, (_) => const Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: LoadingShimmer(height: 60),
                )),
              ),
              error: (e, _) => _ErrorCard(message: e.toString()),
              data: (prices) => Column(
                children: prices.take(8).map((p) => _PriceRow(price: p)).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PortfolioCard extends StatelessWidget {
  final Map<String, dynamic> portfolio;
  final NumberFormat fmt;
  final NumberFormat pctFmt;

  const _PortfolioCard({required this.portfolio, required this.fmt, required this.pctFmt});

  @override
  Widget build(BuildContext context) {
    final totalValue = (portfolio['totalValue'] as num?)?.toDouble() ?? 0;
    final dayChange = (portfolio['dayChange'] as num?)?.toDouble() ?? 0;
    final dayChangePct = (portfolio['dayChangePct'] as num?)?.toDouble() ?? 0;
    final isPositive = dayChange >= 0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [NexcomTheme.primary.withOpacity(0.2), NexcomTheme.secondary.withOpacity(0.1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: NexcomTheme.primary.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Portfolio Value', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
          const SizedBox(height: 4),
          Text(
            fmt.format(totalValue),
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(
                isPositive ? Icons.arrow_upward : Icons.arrow_downward,
                color: isPositive ? NexcomTheme.positive : NexcomTheme.negative,
                size: 16,
              ),
              const SizedBox(width: 4),
              Text(
                '${fmt.format(dayChange.abs())} (${(dayChangePct * 100).toStringAsFixed(2)}%)',
                style: TextStyle(
                  color: isPositive ? NexcomTheme.positive : NexcomTheme.negative,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 8),
              const Text('Today', style: TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: StatCard(
                label: 'Positions',
                value: '${portfolio['positionCount'] ?? 0}',
                icon: Icons.bar_chart,
              )),
              const SizedBox(width: 8),
              Expanded(child: StatCard(
                label: 'Open Orders',
                value: '${portfolio['openOrderCount'] ?? 0}',
                icon: Icons.pending_outlined,
              )),
              const SizedBox(width: 8),
              Expanded(child: StatCard(
                label: 'P&L',
                value: fmt.format((portfolio['totalPnl'] as num?)?.toDouble() ?? 0),
                icon: Icons.trending_up,
                valueColor: ((portfolio['totalPnl'] as num?)?.toDouble() ?? 0) >= 0
                    ? NexcomTheme.positive
                    : NexcomTheme.negative,
              )),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickActionsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _QuickAction(icon: Icons.swap_horiz, label: 'Trade', onTap: () => context.go('/trade')),
        const SizedBox(width: 8),
        _QuickAction(icon: Icons.show_chart, label: 'Markets', onTap: () => context.go('/markets')),
        const SizedBox(width: 8),
        _QuickAction(icon: Icons.notifications_active_outlined, label: 'Alerts', onTap: () => context.push('/alerts')),
        const SizedBox(width: 8),
        _QuickAction(icon: Icons.warehouse_outlined, label: 'Warehouse', onTap: () => context.push('/warehouse')),
      ],
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickAction({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: NexcomTheme.darkCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: NexcomTheme.darkBorder),
          ),
          child: Column(
            children: [
              Icon(icon, color: NexcomTheme.primary, size: 22),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
            ],
          ),
        ),
      ),
    );
  }
}

class _MarketSummaryRow extends StatelessWidget {
  final Map<String, dynamic> summary;

  const _MarketSummaryRow({required this.summary});

  @override
  Widget build(BuildContext context) {
    final gainers = (summary['gainers'] as num?)?.toInt() ?? 0;
    final losers = (summary['losers'] as num?)?.toInt() ?? 0;
    final unchanged = (summary['unchanged'] as num?)?.toInt() ?? 0;

    return Row(
      children: [
        Expanded(child: StatCard(label: 'Gainers', value: '$gainers', icon: Icons.trending_up, valueColor: NexcomTheme.positive)),
        const SizedBox(width: 8),
        Expanded(child: StatCard(label: 'Losers', value: '$losers', icon: Icons.trending_down, valueColor: NexcomTheme.negative)),
        const SizedBox(width: 8),
        Expanded(child: StatCard(label: 'Unchanged', value: '$unchanged', icon: Icons.remove)),
      ],
    );
  }
}

class _PriceRow extends StatelessWidget {
  final dynamic price;

  const _PriceRow({required this.price});

  @override
  Widget build(BuildContext context) {
    final symbol = price['symbol'] as String? ?? '';
    final name = price['name'] as String? ?? symbol;
    final currentPrice = (price['price'] as num?)?.toDouble() ?? 0;
    final changePct = (price['changePct'] as num?)?.toDouble() ?? 0;
    final isPositive = changePct >= 0;

    return GestureDetector(
      onTap: () => context.push('/markets/$symbol'),
      child: Container(
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
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: NexcomTheme.primary.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Center(
                child: Text(
                  symbol.substring(0, symbol.length > 2 ? 2 : symbol.length),
                  style: const TextStyle(color: NexcomTheme.primary, fontWeight: FontWeight.w700, fontSize: 11),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(symbol, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(name, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  NumberFormat.currency(symbol: '₦', decimalDigits: 2).format(currentPrice),
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                ),
                PriceChangeBadge(changePct: changePct),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  final String message;

  const _ErrorCard({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: NexcomTheme.negative.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: NexcomTheme.negative.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: NexcomTheme.negative, size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(color: NexcomTheme.negative, fontSize: 12))),
        ],
      ),
    );
  }
}
