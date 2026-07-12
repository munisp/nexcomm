import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

/// NEXCOM Flutter — Ledger Screen
/// Displays the user's full transaction ledger with debit/credit entries.
class LedgerScreen extends ConsumerStatefulWidget {
  const LedgerScreen({super.key});

  @override
  ConsumerState<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends ConsumerState<LedgerScreen> {
  bool _isLoading = true;
  bool _isLoadingMore = false;
  List<Map<String, dynamic>> _entries = [];
  int _total = 0;
  int _page = 1;
  String? _error;

  static const _bg = Color(0xFF0a0f1a);
  static const _surface = Color(0xFF111827);
  static const _border = Color(0xFF374151);
  static const _primary = Color(0xFF10b981);
  static const _errorColor = Color(0xFFef4444);
  static const _textMuted = Color(0xFF9ca3af);
  static const _textDim = Color(0xFF6b7280);

  static const Map<String, String> _icons = {
    'DEBIT': '↓',
    'CREDIT': '↑',
    'FEE': '⊖',
    'TRANSFER': '⇄',
    'SETTLEMENT': '✓',
  };

  @override
  void initState() {
    super.initState();
    _loadData(reset: true);
  }

  Future<void> _loadData({bool reset = false}) async {
    if (reset) {
      setState(() { _isLoading = true; _error = null; _page = 1; });
    } else {
      setState(() { _isLoadingMore = true; });
    }
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('ledger/getMyEntries?page=$_page&pageSize=30');
      final data = result is Map ? result : {};
      final newEntries = List<Map<String, dynamic>>.from(data['entries'] ?? []);
      setState(() {
        if (reset) {
          _entries = newEntries;
        } else {
          _entries.addAll(newEntries);
        }
        _total = (data['total'] as num?)?.toInt() ?? _entries.length;
        _isLoading = false;
        _isLoadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; _isLoadingMore = false; });
    }
  }

  Future<void> _loadMore() async {
    if (_isLoadingMore || _entries.length >= _total) return;
    _page++;
    await _loadData();
  }

  Color _amountColor(String? type) {
    if (type == 'DEBIT' || type == 'FEE') return _errorColor;
    return _primary;
  }

  String _formatAmount(dynamic amount, String? currency, String? type) {
    final n = double.tryParse(amount?.toString() ?? '0') ?? 0;
    final sign = (type == 'DEBIT' || type == 'FEE') ? '-' : '+';
    final formatted = n.abs().toStringAsFixed(2).replaceAllMapped(
        RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');
    return '$sign${currency ?? ''} $formatted';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Ledger',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            Text('$_total entries', style: const TextStyle(color: _textMuted, fontSize: 12)),
          ],
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _primary),
            onPressed: () => _loadData(reset: true),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _primary))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: _errorColor)))
              : RefreshIndicator(
                  onRefresh: () => _loadData(reset: true),
                  color: _primary,
                  child: _entries.isEmpty
                      ? const Center(child: Text('No ledger entries.', style: TextStyle(color: _textMuted)))
                      : NotificationListener<ScrollNotification>(
                          onNotification: (n) {
                            if (n is ScrollEndNotification &&
                                n.metrics.pixels >= n.metrics.maxScrollExtent - 100) {
                              _loadMore();
                            }
                            return false;
                          },
                          child: ListView.builder(
                            itemCount: _entries.length + (_isLoadingMore ? 1 : 0),
                            itemBuilder: (ctx, i) {
                              if (i == _entries.length) {
                                return const Padding(
                                  padding: EdgeInsets.all(16),
                                  child: Center(child: CircularProgressIndicator(color: _primary)),
                                );
                              }
                              final e = _entries[i];
                              final type = e['entryType']?.toString();
                              final amtColor = _amountColor(type);
                              final amtText = _formatAmount(e['amount'], e['currency']?.toString(), type);
                              final icon = _icons[type] ?? '•';
                              final date = e['createdAt'] != null
                                  ? DateTime.tryParse(e['createdAt'].toString())?.toLocal().toString().split(' ')[0] ?? '—'
                                  : '—';
                              final balance = e['runningBalance'];
                              return Container(
                                decoration: const BoxDecoration(
                                  border: Border(bottom: BorderSide(color: _border)),
                                ),
                                child: ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                                  leading: Container(
                                    width: 36,
                                    height: 36,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: _surface,
                                      border: Border.all(color: _border),
                                    ),
                                    child: Center(
                                      child: Text(icon,
                                          style: TextStyle(color: amtColor, fontSize: 16, fontWeight: FontWeight.bold)),
                                    ),
                                  ),
                                  title: Text(
                                    e['description']?.toString() ?? e['reference']?.toString() ?? 'Transaction',
                                    style: const TextStyle(color: Colors.white, fontSize: 14),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  subtitle: Text(date, style: const TextStyle(color: _textMuted, fontSize: 11)),
                                  trailing: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(amtText,
                                          style: TextStyle(
                                              color: amtColor,
                                              fontFamily: 'monospace',
                                              fontWeight: FontWeight.bold,
                                              fontSize: 13)),
                                      if (balance != null)
                                        Text(
                                          'Bal: ${double.tryParse(balance.toString())?.toStringAsFixed(2) ?? balance}',
                                          style: const TextStyle(color: _textDim, fontSize: 10),
                                        ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                ),
    );
  }
}
