/// order_book_provider.dart
/// ─────────────────────────────────────────────────────────────────────────────
/// Riverpod StreamProvider that connects to the NEXCOM Exchange WebSocket at
/// /ws/orderbook and emits live order book snapshots for a given symbol.
///
/// Usage:
///   final ob = ref.watch(orderBookProvider('MAIZE'));
///   ob.when(data: (snap) => ..., loading: ..., error: ...);

import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

// ─── Data models ─────────────────────────────────────────────────────────────

class OrderBookLevel {
  final double price;
  final double qty;
  final double total;
  final double depth; // 0–100 bar width percentage

  const OrderBookLevel({
    required this.price,
    required this.qty,
    required this.total,
    required this.depth,
  });

  factory OrderBookLevel.fromMap(Map<String, dynamic> m) => OrderBookLevel(
        price: (m['price'] as num).toDouble(),
        qty: (m['qty'] as num).toDouble(),
        total: (m['total'] as num).toDouble(),
        depth: (m['depth'] as num?)?.toDouble() ?? 0,
      );
}

class OrderBookSnapshot {
  final List<OrderBookLevel> bids;
  final List<OrderBookLevel> asks;
  final double spread;
  final double spreadPct;
  final double price;
  final double bid;
  final double ask;
  final double changePct;
  final double volume;
  final String source; // 'live' | 'simulated' | 'demo'
  final bool isLive;

  const OrderBookSnapshot({
    required this.bids,
    required this.asks,
    required this.spread,
    required this.spreadPct,
    required this.price,
    required this.bid,
    required this.ask,
    required this.changePct,
    required this.volume,
    required this.source,
    required this.isLive,
  });

  OrderBookSnapshot copyWith({
    List<OrderBookLevel>? bids,
    List<OrderBookLevel>? asks,
    double? spread,
    double? spreadPct,
    double? price,
    double? bid,
    double? ask,
    double? changePct,
    double? volume,
    String? source,
    bool? isLive,
  }) =>
      OrderBookSnapshot(
        bids: bids ?? this.bids,
        asks: asks ?? this.asks,
        spread: spread ?? this.spread,
        spreadPct: spreadPct ?? this.spreadPct,
        price: price ?? this.price,
        bid: bid ?? this.bid,
        ask: ask ?? this.ask,
        changePct: changePct ?? this.changePct,
        volume: volume ?? this.volume,
        source: source ?? this.source,
        isLive: isLive ?? this.isLive,
      );
}

// ─── Demo fallback data ───────────────────────────────────────────────────────

const _demoPrices = <String, double>{
  'MAIZE': 285000,
  'SOYBEAN': 520000,
  'COCOA': 4850000,
  'GINGER': 1250000,
  'SESAME': 890000,
  'SORGHUM': 195000,
  'MILLET': 210000,
  'CASSAVA': 85000,
  'PALM_OIL': 1650000,
  'GROUNDNUT': 420000,
  'WHEAT': 380000,
  'RICE': 650000,
};

OrderBookSnapshot _buildDemo(String symbol) {
  final base = _demoPrices[symbol] ?? 100000.0;
  final spread = base * 0.0004;
  final bid = base - spread / 2;
  final ask = base + spread / 2;

  List<OrderBookLevel> buildSide(double startPrice, double step, bool isBid) {
    final levels = List.generate(8, (i) {
      final price = isBid ? startPrice - i * step : startPrice + i * step;
      final qty = 20.0 + (i * 23.7 % 180);
      return OrderBookLevel(price: price, qty: qty, total: price * qty, depth: 0);
    });
    final maxQty = levels.map((l) => l.qty).reduce((a, b) => a > b ? a : b);
    return levels
        .map((l) => OrderBookLevel(
              price: l.price,
              qty: l.qty,
              total: l.total,
              depth: (l.qty / maxQty) * 100,
            ))
        .toList();
  }

  return OrderBookSnapshot(
    bids: buildSide(bid, base * 0.001, true),
    asks: buildSide(ask, base * 0.001, false),
    spread: spread,
    spreadPct: (spread / base) * 100,
    price: base,
    bid: bid,
    ask: ask,
    changePct: 1.2,
    volume: 1500,
    source: 'demo',
    isLive: false,
  );
}

// ─── WebSocket URL ────────────────────────────────────────────────────────────

Uri _wsUri() {
  // In release builds, connect to the deployed server.
  // In debug builds, connect to localhost.
  // ignore: do_not_use_environment
  const bool isRelease = bool.fromEnvironment('dart.vm.product');
  const prod = 'wss://nexcom-exchange.manus.space/ws/orderbook';
  const dev = 'ws://localhost:3000/ws/orderbook';
  return Uri.parse(isRelease ? prod : dev);
}

// ─── Provider ────────────────────────────────────────────────────────────────

/// StreamProvider that emits live [OrderBookSnapshot] updates for [symbol].
/// Automatically reconnects on disconnect. Falls back to demo data on error.
final orderBookProvider =
    StreamProvider.family.autoDispose<OrderBookSnapshot, String>((ref, symbol) {
  return _orderBookStream(symbol);
});

Stream<OrderBookSnapshot> _orderBookStream(String symbol) async* {
  // Emit demo snapshot immediately so the UI has data while connecting
  var current = _buildDemo(symbol);
  yield current;

  while (true) {
    WebSocketChannel? channel;
    try {
      channel = WebSocketChannel.connect(_wsUri());

      // Send subscribe message once connected
      channel.sink.add(jsonEncode({'type': 'subscribe', 'symbols': [symbol]}));

      await for (final raw in channel.stream) {
        try {
          final msg = jsonDecode(raw as String) as Map<String, dynamic>;
          final type = msg['type'] as String?;
          final msgSymbol = msg['symbol'] as String?;

          if (msgSymbol != null && msgSymbol != symbol) continue;

          if (type == 'tick') {
            current = current.copyWith(
              price: (msg['price'] as num?)?.toDouble() ?? current.price,
              bid: (msg['bid'] as num?)?.toDouble() ?? current.bid,
              ask: (msg['ask'] as num?)?.toDouble() ?? current.ask,
              changePct: (msg['changePct'] as num?)?.toDouble() ?? current.changePct,
              volume: (msg['volume'] as num?)?.toDouble() ?? current.volume,
              isLive: true,
              source: 'live',
            );
            yield current;
          } else if (type == 'book') {
            final rawBids = msg['bids'] as List?;
            final rawAsks = msg['asks'] as List?;
            final bids = rawBids
                    ?.map((b) => OrderBookLevel.fromMap(b as Map<String, dynamic>))
                    .toList() ??
                current.bids;
            final asks = rawAsks
                    ?.map((a) => OrderBookLevel.fromMap(a as Map<String, dynamic>))
                    .toList() ??
                current.asks;
            current = current.copyWith(
              bids: bids,
              asks: asks,
              spread: (msg['spread'] as num?)?.toDouble() ?? current.spread,
              spreadPct: (msg['spreadPct'] as num?)?.toDouble() ?? current.spreadPct,
              source: msg['source'] == 'rust' ? 'live' : 'simulated',
              isLive: true,
            );
            yield current;
          }
        } catch (_) {
          // Ignore malformed frames — keep streaming
        }
      }
    } catch (_) {
      // Connection failed or dropped — yield demo data and retry
      yield _buildDemo(symbol);
    } finally {
      await channel?.sink.close();
    }

    // Reconnect after 3 seconds
    await Future.delayed(const Duration(seconds: 3));
  }
}
