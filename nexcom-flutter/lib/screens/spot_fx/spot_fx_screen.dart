import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

/// NEXCOM Flutter — Spot FX Screen
/// Live FX rates, pair selection, and order submission for spot currency trading.
class SpotFxScreen extends ConsumerStatefulWidget {
  const SpotFxScreen({super.key});

  @override
  ConsumerState<SpotFxScreen> createState() => _SpotFxScreenState();
}

class _SpotFxScreenState extends ConsumerState<SpotFxScreen> {
  static const _bg = Color(0xFF0a0f1a);
  static const _surface = Color(0xFF111827);
  static const _surfaceAlt = Color(0xFF1f2937);
  static const _border = Color(0xFF374151);
  static const _primary = Color(0xFF10b981);
  static const _errorColor = Color(0xFFef4444);
  static const _warning = Color(0xFFf59e0b);
  static const _textMuted = Color(0xFF9ca3af);

  static const _pairs = [
    {'base': 'USD', 'quote': 'NGN', 'rate': '1,580.00', 'change': '+0.3%'},
    {'base': 'USD', 'quote': 'GHS', 'rate': '15.20', 'change': '-0.1%'},
    {'base': 'USD', 'quote': 'KES', 'rate': '129.50', 'change': '+0.5%'},
    {'base': 'EUR', 'quote': 'USD', 'rate': '1.0820', 'change': '+0.2%'},
    {'base': 'GBP', 'quote': 'USD', 'rate': '1.2710', 'change': '-0.4%'},
    {'base': 'USD', 'quote': 'ZAR', 'rate': '18.45', 'change': '+0.8%'},
    {'base': 'XOF', 'quote': 'USD', 'rate': '0.00165', 'change': '0.0%'},
    {'base': 'ETB', 'quote': 'USD', 'rate': '0.0179', 'change': '-0.2%'},
  ];

  Map<String, String>? _selectedPair;
  String _side = 'BUY';
  String _orderType = 'MARKET';
  final _quantityCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _quantityCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

  Future<void> _submitOrder() async {
    if (_selectedPair == null) return;
    final qty = double.tryParse(_quantityCtrl.text);
    if (qty == null || qty <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid quantity'), backgroundColor: _errorColor),
      );
      return;
    }
    if (_orderType == 'LIMIT') {
      final price = double.tryParse(_priceCtrl.text);
      if (price == null || price <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enter a valid limit price'), backgroundColor: _errorColor),
        );
        return;
      }
    }
    setState(() { _isSubmitting = true; });
    try {
      final api = ref.read(apiServiceProvider);
      final symbol = '${_selectedPair!['base']}/${_selectedPair!['quote']}';
      final body = {
        'symbol': symbol,
        'side': _side,
        'orderType': _orderType,
        'quantity': qty,
        if (_orderType == 'LIMIT') 'price': double.parse(_priceCtrl.text),
      };
      await api.post('order/placeOrder', body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Order submitted successfully'), backgroundColor: _primary),
        );
        _quantityCtrl.clear();
        _priceCtrl.clear();
        setState(() { _selectedPair = null; });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Order failed: $e'), backgroundColor: _errorColor),
        );
      }
    } finally {
      if (mounted) setState(() { _isSubmitting = false; });
    }
  }

  Color _changeColor(String change) {
    if (change.startsWith('+')) return _primary;
    if (change.startsWith('-')) return _errorColor;
    return _textMuted;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        title: const Text('Spot FX',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Rates Table
            const Text('Live Rates',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                color: _surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: _border),
              ),
              child: Column(
                children: _pairs.map((pair) {
                  final isSelected = _selectedPair != null &&
                      _selectedPair!['base'] == pair['base'] &&
                      _selectedPair!['quote'] == pair['quote'];
                  return InkWell(
                    onTap: () => setState(() => _selectedPair = Map<String, String>.from(pair)),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: isSelected ? _surfaceAlt : Colors.transparent,
                        border: const Border(bottom: BorderSide(color: _border)),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('${pair['base']}/${pair['quote']}',
                                style: const TextStyle(
                                    color: Colors.white, fontFamily: 'monospace', fontSize: 13)),
                          ),
                          Text(pair['rate']!,
                              style: const TextStyle(
                                  color: Colors.white, fontFamily: 'monospace', fontSize: 13)),
                          const SizedBox(width: 12),
                          SizedBox(
                            width: 56,
                            child: Text(pair['change']!,
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                    color: _changeColor(pair['change']!), fontSize: 12)),
                          ),
                          const SizedBox(width: 8),
                          Text('Trade →',
                              style: TextStyle(
                                  color: isSelected ? _primary : _textMuted, fontSize: 11)),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),

            // Order Form
            if (_selectedPair != null) ...[
              const SizedBox(height: 24),
              Text(
                'New Order — ${_selectedPair!['base']}/${_selectedPair!['quote']}',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
              ),
              const SizedBox(height: 12),

              // Side toggle
              Row(
                children: ['BUY', 'SELL'].map((s) {
                  final isActive = _side == s;
                  final activeColor = s == 'BUY' ? _primary : _errorColor;
                  return Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _side = s),
                      child: Container(
                        margin: EdgeInsets.only(right: s == 'BUY' ? 6 : 0, left: s == 'SELL' ? 6 : 0),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: isActive ? activeColor : _surfaceAlt,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: isActive ? activeColor : _border),
                        ),
                        child: Center(
                          child: Text(s,
                              style: TextStyle(
                                  color: isActive ? Colors.white : _textMuted,
                                  fontWeight: FontWeight.bold)),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 10),

              // Order type toggle
              Row(
                children: ['MARKET', 'LIMIT'].map((t) {
                  final isActive = _orderType == t;
                  return Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _orderType = t),
                      child: Container(
                        margin: EdgeInsets.only(right: t == 'MARKET' ? 6 : 0, left: t == 'LIMIT' ? 6 : 0),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        decoration: BoxDecoration(
                          color: isActive ? _primary : _surfaceAlt,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: isActive ? _primary : _border),
                        ),
                        child: Center(
                          child: Text(t,
                              style: TextStyle(
                                  color: isActive ? Colors.white : _textMuted,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),

              // Quantity
              const Text('Quantity', style: TextStyle(color: _textMuted, fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _quantityCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
                decoration: InputDecoration(
                  hintText: '0.00',
                  hintStyle: const TextStyle(color: _textMuted),
                  filled: true,
                  fillColor: _surfaceAlt,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: _border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: _border),
                  ),
                ),
              ),
              if (_orderType == 'LIMIT') ...[
                const SizedBox(height: 10),
                const Text('Limit Price', style: TextStyle(color: _textMuted, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: _priceCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
                  decoration: InputDecoration(
                    hintText: '0.00',
                    hintStyle: const TextStyle(color: _textMuted),
                    filled: true,
                    fillColor: _surfaceAlt,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: const BorderSide(color: _border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: const BorderSide(color: _border),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isSubmitting ? null : _submitOrder,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _side == 'BUY' ? _primary : _errorColor,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 20, width: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : Text(
                          '$_side ${_selectedPair!['base']}',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
