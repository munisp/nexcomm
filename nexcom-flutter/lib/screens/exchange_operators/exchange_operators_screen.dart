import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

/// NEXCOM Flutter — Exchange Operators Screen
/// Admin view of registered exchange operators with activate/suspend actions.
class ExchangeOperatorsScreen extends ConsumerStatefulWidget {
  const ExchangeOperatorsScreen({super.key});

  @override
  ConsumerState<ExchangeOperatorsScreen> createState() =>
      _ExchangeOperatorsScreenState();
}

class _ExchangeOperatorsScreenState
    extends ConsumerState<ExchangeOperatorsScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _operators = [];
  String? _error;

  static const _bg = Color(0xFF0a0f1a);
  static const _surface = Color(0xFF111827);
  static const _border = Color(0xFF374151);
  static const _primary = Color(0xFF10b981);
  static const _warning = Color(0xFFf59e0b);
  static const _errorColor = Color(0xFFef4444);
  static const _textMuted = Color(0xFF9ca3af);

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('exchangeOperator/list?page=1&pageSize=50');
      final data = result is Map ? result : {};
      setState(() {
        _operators = List<Map<String, dynamic>>.from(data['operators'] ?? data['result'] ?? []);
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  Future<void> _activateOperator(int id, String code) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _surface,
        title: const Text('Activate Operator', style: TextStyle(color: Colors.white)),
        content: Text('Activate $code?', style: const TextStyle(color: _textMuted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: _primary),
            child: const Text('Activate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final api = ref.read(apiServiceProvider);
      await api.post('exchangeOperator/activate', {'operatorId': id});
      _loadData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: _errorColor),
        );
      }
    }
  }

  Future<void> _suspendOperator(int id, String code) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _surface,
        title: const Text('Suspend Operator', style: TextStyle(color: Colors.white)),
        content: Text('Suspend $code?', style: const TextStyle(color: _textMuted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: _errorColor),
            child: const Text('Suspend'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final api = ref.read(apiServiceProvider);
      await api.post('exchangeOperator/suspend', {'operatorId': id, 'reason': 'Suspended via mobile admin'});
      _loadData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: _errorColor),
        );
      }
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'active': return _primary;
      case 'pending': return _warning;
      case 'suspended': return _errorColor;
      default: return _textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        title: const Text('Exchange Operators',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _primary),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _primary))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: _errorColor)))
              : RefreshIndicator(
                  onRefresh: _loadData,
                  color: _primary,
                  child: _operators.isEmpty
                      ? const Center(child: Text('No exchange operators registered.',
                          style: TextStyle(color: _textMuted)))
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _operators.length,
                          itemBuilder: (ctx, i) {
                            final op = _operators[i];
                            final status = op['status']?.toString() ?? 'unknown';
                            final isActive = status == 'active';
                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: _surface,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: _border),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(op['operatorCode']?.toString() ?? '—',
                                          style: const TextStyle(color: _primary, fontWeight: FontWeight.bold, fontSize: 16)),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: _statusColor(status),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(status.toUpperCase(),
                                            style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(op['legalName']?.toString() ?? '—',
                                      style: const TextStyle(color: Colors.white, fontSize: 14)),
                                  if (op['tradingName'] != null)
                                    Text(op['tradingName'].toString(),
                                        style: const TextStyle(color: _textMuted, fontSize: 12)),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      _metaChip('Jurisdiction', op['jurisdiction']?.toString() ?? '—'),
                                      const SizedBox(width: 8),
                                      _metaChip('Tier', op['tier']?.toString() ?? '—'),
                                      const SizedBox(width: 8),
                                      _metaChip('CCY', op['settlementCurrency']?.toString() ?? '—'),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  Row(
                                    children: [
                                      if (!isActive)
                                        Expanded(
                                          child: ElevatedButton(
                                            onPressed: () => _activateOperator(op['id'] as int, op['operatorCode'].toString()),
                                            style: ElevatedButton.styleFrom(backgroundColor: _primary),
                                            child: const Text('Activate', style: TextStyle(color: Colors.white)),
                                          ),
                                        ),
                                      if (isActive)
                                        Expanded(
                                          child: ElevatedButton(
                                            onPressed: () => _suspendOperator(op['id'] as int, op['operatorCode'].toString()),
                                            style: ElevatedButton.styleFrom(backgroundColor: _errorColor),
                                            child: const Text('Suspend', style: TextStyle(color: Colors.white)),
                                          ),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
    );
  }

  Widget _metaChip(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF1f2937),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text('$label: $value', style: const TextStyle(color: _textMuted, fontSize: 10)),
    );
  }
}
