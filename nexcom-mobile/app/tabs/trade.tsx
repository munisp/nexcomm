import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, TYPOGRAPHY } from '../../constants/config';

const COMMODITIES = ['MAIZE', 'SOYBEAN', 'COCOA', 'SESAME', 'SORGHUM', 'CASHEW', 'COTTON'];
const ORDER_TYPES = ['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT'];
const MARKET_TYPES = ['SPOT', 'FUTURES', 'OPTIONS'];

const PRICES: Record<string, number> = {
  MAIZE: 285000,
  SOYBEAN: 520000,
  COCOA: 4850000,
  SESAME: 1250000,
  SORGHUM: 195000,
  CASHEW: 3200000,
  COTTON: 1850000,
};

export default function TradeScreen() {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [commodity, setCommodity] = useState('MAIZE');
  const [orderType, setOrderType] = useState('LIMIT');
  const [marketType, setMarketType] = useState('SPOT');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState(String(PRICES['MAIZE']));
  const [stopPrice, setStopPrice] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tif, setTif] = useState('GTC');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPrice = PRICES[commodity] || 0;
  const qty = parseFloat(quantity) || 0;
  const lmt = parseFloat(price) || 0;
  const totalValue = qty * lmt;
  const commission = totalValue * 0.001; // 0.1% commission
  const netTotal = totalValue + commission;

  const handleCommodityChange = (sym: string) => {
    setCommodity(sym);
    setPrice(String(PRICES[sym] || 0));
  };

  const handleSubmit = () => {
    if (!quantity || !price) {
      Alert.alert('Missing Fields', 'Please enter quantity and price.');
      return;
    }
    if (qty <= 0) {
      Alert.alert('Invalid Quantity', 'Quantity must be greater than 0.');
      return;
    }

    Alert.alert(
      `Confirm ${side} Order`,
      `${side} ${qty} MT of ${commodity}\n@ ₦${lmt.toLocaleString()}/MT\n\nTotal: ₦${netTotal.toLocaleString()}\nCommission: ₦${commission.toLocaleString()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: side === 'SELL' ? 'destructive' : 'default',
          onPress: () => {
            setIsSubmitting(true);
            setTimeout(() => {
              setIsSubmitting(false);
              Alert.alert('Order Submitted', `Your ${side} order for ${qty} MT of ${commodity} has been placed.`);
              setQuantity('');
            }, 1500);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Buy/Sell Toggle */}
        <View style={styles.sideToggle}>
          <TouchableOpacity
            style={[styles.sideBtn, side === 'BUY' && styles.sideBtnBuy]}
            onPress={() => setSide('BUY')}
          >
            <Text style={[styles.sideBtnText, side === 'BUY' && styles.sideBtnTextActive]}>
              BUY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sideBtn, side === 'SELL' && styles.sideBtnSell]}
            onPress={() => setSide('SELL')}
          >
            <Text style={[styles.sideBtnText, side === 'SELL' && styles.sideBtnTextActive]}>
              SELL
            </Text>
          </TouchableOpacity>
        </View>

        {/* Market Type */}
        <View style={styles.field}>
          <Text style={styles.label}>Market Type</Text>
          <View style={styles.optionRow}>
            {MARKET_TYPES.map((mt) => (
              <TouchableOpacity
                key={mt}
                style={[styles.optionBtn, marketType === mt && styles.optionBtnActive]}
                onPress={() => setMarketType(mt)}
              >
                <Text
                  style={[styles.optionText, marketType === mt && styles.optionTextActive]}
                >
                  {mt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Commodity Selector */}
        <View style={styles.field}>
          <Text style={styles.label}>Commodity</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.optionRow}>
              {COMMODITIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.optionBtn, commodity === c && styles.optionBtnActive]}
                  onPress={() => handleCommodityChange(c)}
                >
                  <Text
                    style={[styles.optionText, commodity === c && styles.optionTextActive]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Current Price Display */}
        <View style={styles.priceDisplay}>
          <Text style={styles.priceDisplayLabel}>Market Price</Text>
          <Text style={styles.priceDisplayValue}>
            ₦{currentPrice.toLocaleString()}/MT
          </Text>
          <Text style={[styles.priceDisplayChange, { color: COLORS.success }]}>▲ 2.4%</Text>
        </View>

        {/* Order Type */}
        <View style={styles.field}>
          <Text style={styles.label}>Order Type</Text>
          <View style={styles.optionRow}>
            {ORDER_TYPES.map((ot) => (
              <TouchableOpacity
                key={ot}
                style={[styles.optionBtn, orderType === ot && styles.optionBtnActive]}
                onPress={() => setOrderType(ot)}
              >
                <Text
                  style={[styles.optionText, orderType === ot && styles.optionTextActive]}
                >
                  {ot.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quantity */}
        <View style={styles.field}>
          <Text style={styles.label}>Quantity (MT)</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="e.g. 50"
            placeholderTextColor={COLORS.textDim}
          />
          <View style={styles.quickQtyRow}>
            {[10, 25, 50, 100].map((q) => (
              <TouchableOpacity
                key={q}
                style={styles.quickQtyBtn}
                onPress={() => setQuantity(String(q))}
              >
                <Text style={styles.quickQtyText}>{q} MT</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Price (for LIMIT orders) */}
        {orderType !== 'MARKET' && (
          <View style={styles.field}>
            <Text style={styles.label}>
              {orderType === 'STOP' ? 'Stop Price (₦/MT)' : 'Limit Price (₦/MT)'}
            </Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="Enter price"
              placeholderTextColor={COLORS.textDim}
            />
          </View>
        )}

        {/* Stop Price for STOP_LIMIT */}
        {orderType === 'STOP_LIMIT' && (
          <View style={styles.field}>
            <Text style={styles.label}>Stop Trigger Price (₦/MT)</Text>
            <TextInput
              style={styles.input}
              value={stopPrice}
              onChangeText={setStopPrice}
              keyboardType="decimal-pad"
              placeholder="Enter stop price"
              placeholderTextColor={COLORS.textDim}
            />
          </View>
        )}

        {/* Advanced Options Toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Text style={styles.advancedToggleText}>
            Advanced Options {showAdvanced ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {showAdvanced && (
          <View style={styles.advancedSection}>
            <View style={styles.field}>
              <Text style={styles.label}>Time in Force</Text>
              <View style={styles.optionRow}>
                {['GTC', 'DAY', 'IOC', 'FOK'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.optionBtn, tif === t && styles.optionBtnActive]}
                    onPress={() => setTif(t)}
                  >
                    <Text
                      style={[styles.optionText, tif === t && styles.optionTextActive]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Order Summary */}
        {qty > 0 && lmt > 0 && (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Order Summary</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₦{totalValue.toLocaleString()}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Commission (0.1%)</Text>
              <Text style={styles.summaryValue}>₦{commission.toLocaleString()}</Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={styles.summaryTotalValue}>₦{netTotal.toLocaleString()}</Text>
            </View>
          </View>
        )}

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            side === 'BUY' ? styles.submitBtnBuy : styles.submitBtnSell,
            isSubmitting && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Text style={styles.submitBtnText}>
            {isSubmitting
              ? 'Submitting...'
              : `Place ${side} Order`}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, padding: 16 },

  sideToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sideBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  sideBtnBuy: { backgroundColor: `${COLORS.success}30` },
  sideBtnSell: { backgroundColor: `${COLORS.error}30` },
  sideBtnText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sideBtnTextActive: { color: COLORS.text },

  field: { marginBottom: 16 },
  label: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionBtnActive: {
    backgroundColor: `${COLORS.primary}20`,
    borderColor: COLORS.primary,
  },
  optionText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '500',
  },
  optionTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  priceDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  priceDisplayLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    flex: 1,
  },
  priceDisplayValue: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  priceDisplayChange: {
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },

  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '600',
    padding: 14,
  },

  quickQtyRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickQtyBtn: {
    flex: 1,
    paddingVertical: 6,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickQtyText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
  },

  advancedToggle: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  advancedToggleText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
  },
  advancedSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  summary: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  summaryTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: { color: COLORS.textMuted, fontSize: TYPOGRAPHY.sizes.sm },
  summaryValue: { color: COLORS.text, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '600' },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    marginTop: 4,
  },
  summaryTotalLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },
  summaryTotalValue: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
  },

  submitBtn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  submitBtnBuy: { backgroundColor: COLORS.success },
  submitBtnSell: { backgroundColor: COLORS.error },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
