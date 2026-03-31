/**
 * Order Book Screen — NEXCOM Mobile
 * Real-time order book for a given symbol, connected via WebSocket.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { WS_BASE_URL, COLORS } from "../../constants/config";

interface OrderLevel { price: number; quantity: number; total: number; }
interface OrderBook { bids: OrderLevel[]; asks: OrderLevel[]; spread: number; spreadPct: number; }

export default function OrderBookScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const [book, setBook] = useState<OrderBook | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!symbol) return;
    const ws = new WebSocket(`${WS_BASE_URL}/ws/orderbook/${symbol}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      try { setBook(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    return () => { ws.close(); };
  }, [symbol]);

  const maxTotal = book
    ? Math.max(...book.bids.map((b) => b.total), ...book.asks.map((a) => a.total), 1)
    : 1;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>{symbol ?? "Order Book"}</Text>
        <View style={[s.badge, connected ? s.badgeOn : s.badgeOff]}>
          <Text style={s.badgeText}>{connected ? "LIVE" : "OFFLINE"}</Text>
        </View>
      </View>

      {!book ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={s.hint}>Connecting to order book…</Text>
        </View>
      ) : (
        <ScrollView>
          {/* Spread */}
          <View style={s.spreadRow}>
            <Text style={s.spreadLabel}>Spread</Text>
            <Text style={s.spreadValue}>{book.spread.toFixed(4)} ({book.spreadPct.toFixed(3)}%)</Text>
          </View>

          {/* Column headers */}
          <View style={s.colHeader}>
            <Text style={[s.col, { flex: 1.2 }]}>PRICE</Text>
            <Text style={[s.col, { flex: 1, textAlign: "right" }]}>QTY</Text>
            <Text style={[s.col, { flex: 1.2, textAlign: "right" }]}>TOTAL</Text>
          </View>

          {/* Asks (reversed so lowest ask is at bottom) */}
          {[...book.asks].reverse().map((ask, i) => (
            <View key={`ask-${i}`} style={s.levelRow}>
              <View style={[s.depthBar, { width: `${(ask.total / maxTotal) * 100}%`, backgroundColor: "rgba(248,81,73,0.12)" }]} />
              <Text style={[s.price, s.askPrice]}>{ask.price.toFixed(4)}</Text>
              <Text style={[s.qty, { flex: 1, textAlign: "right" }]}>{ask.quantity.toFixed(2)}</Text>
              <Text style={[s.qty, { flex: 1.2, textAlign: "right" }]}>{ask.total.toFixed(2)}</Text>
            </View>
          ))}

          <View style={s.divider} />

          {/* Bids */}
          {book.bids.map((bid, i) => (
            <View key={`bid-${i}`} style={s.levelRow}>
              <View style={[s.depthBar, { width: `${(bid.total / maxTotal) * 100}%`, backgroundColor: "rgba(63,185,80,0.12)" }]} />
              <Text style={[s.price, s.bidPrice]}>{bid.price.toFixed(4)}</Text>
              <Text style={[s.qty, { flex: 1, textAlign: "right" }]}>{bid.quantity.toFixed(2)}</Text>
              <Text style={[s.qty, { flex: 1.2, textAlign: "right" }]}>{bid.total.toFixed(2)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d1117" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: "#e6edf3" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeOn: { backgroundColor: "rgba(63,185,80,0.2)" },
  badgeOff: { backgroundColor: "rgba(139,148,158,0.2)" },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#e6edf3" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  hint: { color: "#8b949e", fontSize: 14 },
  spreadRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#161b22" },
  spreadLabel: { fontSize: 12, color: "#8b949e" },
  spreadValue: { fontSize: 12, color: "#e6edf3" },
  colHeader: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#21262d" },
  col: { fontSize: 11, color: "#8b949e", fontWeight: "600", letterSpacing: 0.5, flex: 1 },
  levelRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 5, position: "relative" },
  depthBar: { position: "absolute", right: 0, top: 0, bottom: 0 },
  price: { flex: 1.2, fontSize: 13, fontWeight: "600" },
  askPrice: { color: "#f85149" },
  bidPrice: { color: "#3fb950" },
  qty: { fontSize: 13, color: "#e6edf3" },
  divider: { height: 1, backgroundColor: "#30363d", marginVertical: 4 },
});
