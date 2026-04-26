import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/api_service.dart';

class MarginScreen extends ConsumerStatefulWidget {
  const MarginScreen({super.key});

  @override
  ConsumerState<MarginScreen> createState() => _MarginScreenState();
}

class _MarginScreenState extends ConsumerState<MarginScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _items = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final result = await api.get('margin/getAccount');
      setState(() {
        _items = List<Map<String, dynamic>>.from(
          result is List ? result : (result['items'] ?? result['data'] ?? []),
        );
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: const Color(0xFF0a0f1a),
      appBar: AppBar(
        backgroundColor: const Color(0xFF111827),
        title: Text(
          'Margin Account',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF10b981)),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF10b981)))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, color: Color(0xFFef4444), size: 48),
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10b981)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  color: const Color(0xFF10b981),
                  child: _items.isEmpty
                      ? const Center(
                          child: Text('No data available', style: TextStyle(color: Colors.white54)),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _items.length,
                          itemBuilder: (context, index) {
                            final item = _items[index];
                            return Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFF111827),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFF374151)),
                              ),
                              child: ListTile(
                                title: Text(
                                  item['name'] ?? item['title'] ?? item['symbol'] ?? item['id']?.toString() ?? 'Item ${index + 1}',
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                                ),
                                subtitle: item['status'] != null || item['type'] != null
                                    ? Text(
                                        item['status'] ?? item['type'] ?? '',
                                        style: const TextStyle(color: Colors.white54),
                                      )
                                    : null,
                                trailing: item['value'] != null || item['amount'] != null || item['price'] != null
                                    ? Text(
                                        '₦${item['value'] ?? item['amount'] ?? item['price'] ?? ''}',
                                        style: const TextStyle(color: Color(0xFF10b981), fontWeight: FontWeight.w600),
                                      )
                                    : null,
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
