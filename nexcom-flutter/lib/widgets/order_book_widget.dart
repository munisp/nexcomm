/// order_book_widget.dart
/// ─────────────────────────────────────────────────────────────────────────────
/// Reusable Flutter widget that renders a live order book (bids + asks) for a
/// given commodity symbol. Connects to the NEXCOM Exchange WebSocket via
/// [orderBookProvider] and updates in real-time.
///
/// Usage:
///   OrderBookWidget(symbol: 'MAIZE')

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../providers/order_book_provider.dart';
import '../theme.dart';

class OrderBookWidget extends ConsumerWidget {
  final String symbol;

  const OrderBookWidget({super.key, required this.symbol});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final obAsync = ref.watch(orderBookProvider(symbol));
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 0);

    return obAsync.when(
      loading: () => const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      ),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('Order book unavailable: $e',
              style: const TextStyle(color: NexcomTheme.negative)),
        ),
      ),
      data: (ob) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Connection status badge ──────────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: ob.isLive ? NexcomTheme.positive : Colors.orange,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  ob.isLive ? 'Live · ${ob.source}' : 'Demo data',
                  style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 11),
                ),
                const Spacer(),
                Text(
                  'Updated ${DateTime.now().toLocal().toString().substring(11, 19)}',
                  style: const TextStyle(color: Color(0xFF6B7280), fontSize: 10),
                ),
              ],
            ),
          ),

          // ── Column headers ───────────────────────────────────────────────
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text('Price (₦/MT)',
                      style: TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5)),
                ),
                Expanded(
                  child: Text('Qty (MT)',
                      style: TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5)),
                ),
                Expanded(
                  child: Text('Total (₦)',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          color: Color(0xFF6B7280),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5)),
                ),
              ],
            ),
          ),
          const Divider(color: NexcomTheme.darkBorder, height: 1),

          // ── Asks (sell side) — lowest ask nearest spread ─────────────────
          ...ob.asks.reversed.map((ask) => _BookRow(
                level: ask,
                isBid: false,
                fmt: fmt,
              )),

          // ── Spread row ───────────────────────────────────────────────────
          Container(
            margin: const EdgeInsets.symmetric(vertical: 2),
            padding: const EdgeInsets.symmetric(vertical: 6),
            color: NexcomTheme.primary.withOpacity(0.08),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Spread: ${fmt.format(ob.spread)}',
                  style: const TextStyle(
                      color: NexcomTheme.primary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600),
                ),
                const SizedBox(width: 8),
                Text(
                  '(${ob.spreadPct.toStringAsFixed(3)}%)',
                  style: const TextStyle(
                      color: NexcomTheme.primary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),

          // ── Bids (buy side) ──────────────────────────────────────────────
          ...ob.bids.map((bid) => _BookRow(
                level: bid,
                isBid: true,
                fmt: fmt,
              )),
        ],
      ),
    );
  }
}

// ─── Single order book row ────────────────────────────────────────────────────

class _BookRow extends StatelessWidget {
  final OrderBookLevel level;
  final bool isBid;
  final NumberFormat fmt;

  const _BookRow({
    required this.level,
    required this.isBid,
    required this.fmt,
  });

  @override
  Widget build(BuildContext context) {
    final color = isBid ? NexcomTheme.positive : NexcomTheme.negative;
    final barColor = color.withOpacity(0.12);

    return Stack(
      children: [
        // Depth bar
        Positioned.fill(
          child: Align(
            alignment: isBid ? Alignment.centerLeft : Alignment.centerRight,
            child: FractionallySizedBox(
              widthFactor: level.depth / 100,
              child: Container(color: barColor),
            ),
          ),
        ),
        // Row content
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  fmt.format(level.price),
                  style: TextStyle(
                      color: color,
                      fontSize: 12,
                      fontWeight: FontWeight.w600),
                ),
              ),
              Expanded(
                child: Text(
                  level.qty.toStringAsFixed(1),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
              Expanded(
                child: Text(
                  '${(level.total / 1e6).toStringAsFixed(1)}M',
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                      color: Color(0xFF9CA3AF), fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
