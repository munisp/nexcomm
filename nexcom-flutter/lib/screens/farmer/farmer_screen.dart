import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../services/api_service.dart';
import '../../theme.dart';
import '../../widgets/loading_shimmer.dart';

final _farmersProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return nexcomApi.getFarmers();
});

class FarmerScreen extends ConsumerStatefulWidget {
  const FarmerScreen({super.key});
  @override
  ConsumerState<FarmerScreen> createState() => _FarmerScreenState();
}

class _FarmerScreenState extends ConsumerState<FarmerScreen> {
  final _searchCtrl = TextEditingController();
  String _search = '';
  @override
  void dispose() { _searchCtrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final farmersAsync = ref.watch(_farmersProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Field Agents'), actions: [
        IconButton(icon: const Icon(Icons.person_add_outlined), onPressed: () => context.push('/farmer/new')),
        IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(_farmersProvider)),
      ]),
      body: Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: TextField(controller: _searchCtrl, onChanged: (v) => setState(() => _search = v), decoration: const InputDecoration(hintText: 'Search farmers...', prefixIcon: Icon(Icons.search, size: 18), isDense: true))),
        Expanded(child: farmersAsync.when(
          loading: () => const Padding(padding: EdgeInsets.all(16), child: LoadingShimmerList()),
          error: (e, _) => Center(child: Text('Error: $e')),
          data: (farmers) {
            final filtered = _search.isEmpty ? farmers : farmers.where((f) => '${f['name']} ${f['phone']}'.toLowerCase().contains(_search.toLowerCase())).toList();
            return filtered.isEmpty ? const Center(child: Text('No farmers found', style: TextStyle(color: Color(0xFF6B7280)))) : ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: filtered.length,
              itemBuilder: (ctx, i) {
                final f = filtered[i];
                return ListTile(
                  onTap: () => context.push('/farmer/${f['id']}'),
                  leading: CircleAvatar(backgroundColor: NexcomTheme.primary.withOpacity(0.2), child: Text((f['name'] as String? ?? 'F').substring(0, 1), style: const TextStyle(color: NexcomTheme.primary, fontWeight: FontWeight.w700))),
                  title: Text(f['name'] as String? ?? ''),
                  subtitle: Text('${f['location'] ?? ''} • ${f['cropCount'] ?? 0} crops', style: const TextStyle(fontSize: 12)),
                  trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
                );
              },
            );
          },
        )),
      ]),
    );
  }
}
