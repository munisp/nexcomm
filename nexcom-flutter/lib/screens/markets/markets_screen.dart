import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/price_change_badge.dart';
import '../../widgets/loading_shimmer.dart';

final _pricesProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getLivePrices();
});

class MarketsScreen extends ConsumerStatefulWidget {
  const MarketsScreen({super.key});

  @override
  ConsumerState<MarketsScreen> createState() => _MarketsScreenState();
}

class _MarketsScreenState extends ConsumerState<MarketsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _searchController = TextEditingController();
  String _searchQuery = '';
  String _sortBy = 'symbol';
  bool _sortAsc = true;

  static const _assetClasses = ['All', 'COMMODITY', 'METALS', 'ENERGY'];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _assetClasses.length, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  List<dynamic> _filterAndSort(List<dynamic> prices, String assetClass) {
    var filtered = prices.where((p) {
      final matchesSearch = _searchQuery.isEmpty ||
          (p['symbol'] as String? ?? '').toLowerCase().contains(_searchQuery.toLowerCase()) ||
          (p['name'] as String? ?? '').toLowerCase().contains(_searchQuery.toLowerCase());
      final matchesClass = assetClass == 'All' || p['assetClass'] == assetClass;
      return matchesSearch && matchesClass;
    }).toList();

    filtered.sort((a, b) {
      dynamic aVal, bVal;
      switch (_sortBy) {
        case 'price': aVal = (a['price'] as num?)?.toDouble() ?? 0; bVal = (b['price'] as num?)?.toDouble() ?? 0; break;
        case 'change': aVal = (a['changePct'] as num?)?.toDouble() ?? 0; bVal = (b['changePct'] as num?)?.toDouble() ?? 0; break;
        default: aVal = a['symbol'] ?? ''; bVal = b['symbol'] ?? '';
      }
      final cmp = Comparable.compare(aVal, bVal);
      return _sortAsc ? cmp : -cmp;
    });

    return filtered;
  }

  @override
  Widget build(BuildContext context) {
    final pricesAsync = ref.watch(_pricesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Markets'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            onSelected: (value) => setState(() {
              if (_sortBy == value) _sortAsc = !_sortAsc;
              else { _sortBy = value; _sortAsc = true; }
            }),
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'symbol', child: Text('Sort by Symbol')),
              const PopupMenuItem(value: 'price', child: Text('Sort by Price')),
              const PopupMenuItem(value: 'change', child: Text('Sort by Change')),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(_pricesProvider),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(96),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: TextField(
                  controller: _searchController,
                  onChanged: (v) => setState(() => _searchQuery = v),
                  decoration: InputDecoration(
                    hintText: 'Search commodities...',
                    prefixIcon: const Icon(Icons.search, size: 18),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 16),
                            onPressed: () { _searchController.clear(); setState(() => _searchQuery = ''); },
                          )
                        : null,
                    contentPadding: const EdgeInsets.symmetric(vertical: 8),
                    isDense: true,
                  ),
                ),
              ),
              TabBar(
                controller: _tabController,
                tabs: _assetClasses.map((c) => Tab(text: c)).toList(),
                labelColor: NexcomTheme.primary,
                unselectedLabelColor: const Color(0xFF6B7280),
                indicatorColor: NexcomTheme.primary,
                indicatorSize: TabBarIndicatorSize.label,
                labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
      body: pricesAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(16),
          child: LoadingShimmerList(count: 8),
        ),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (prices) => TabBarView(
          controller: _tabController,
          children: _assetClasses.map((assetClass) {
            final filtered = _filterAndSort(prices, assetClass);
            if (filtered.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.search_off, size: 48, color: Color(0xFF374151)),
                    SizedBox(height: 12),
                    Text('No commodities found', style: TextStyle(color: Color(0xFF6B7280))),
                  ],
                ),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: filtered.length,
              itemBuilder: (context, i) => _PriceTile(price: filtered[i]),
            );
          }).toList(),
        ),
      ),
    );
  }
}

class _PriceTile extends StatelessWidget {
  final dynamic price;

  const _PriceTile({required this.price});

  @override
  Widget build(BuildContext context) {
    final symbol = price['symbol'] as String? ?? '';
    final name = price['name'] as String? ?? symbol;
    final currentPrice = (price['price'] as num?)?.toDouble() ?? 0;
    final changePct = (price['changePct'] as num?)?.toDouble() ?? 0;
    final high = (price['high'] as num?)?.toDouble();
    final low = (price['low'] as num?)?.toDouble();
    final fmt = NumberFormat.currency(symbol: '₦', decimalDigits: 2);

    return GestureDetector(
      onTap: () => context.push('/markets/$symbol'),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: NexcomTheme.darkCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: NexcomTheme.darkBorder),
        ),
        child: Row(
          children: [
            // Symbol badge
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: NexcomTheme.primary.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: Text(
                  symbol.length > 3 ? symbol.substring(0, 3) : symbol,
                  style: const TextStyle(color: NexcomTheme.primary, fontWeight: FontWeight.w700, fontSize: 10),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
            const SizedBox(width: 12),
            // Name & symbol
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(symbol, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(name, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (high != null && low != null)
                    Text(
                      'H: ${fmt.format(high)}  L: ${fmt.format(low)}',
                      style: const TextStyle(color: Color(0xFF4B5563), fontSize: 10),
                    ),
                ],
              ),
            ),
            // Price & change
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(fmt.format(currentPrice), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 4),
                PriceChangeBadge(changePct: changePct),
              ],
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: Color(0xFF4B5563), size: 18),
          ],
        ),
      ),
    );
  }
}
