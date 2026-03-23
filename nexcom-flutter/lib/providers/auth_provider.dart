import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../services/api_service.dart';

const _storage = FlutterSecureStorage();

class AuthState {
  final bool isLoggedIn;
  final Map<String, dynamic>? user;
  final bool isLoading;
  final String? error;

  const AuthState({
    this.isLoggedIn = false,
    this.user,
    this.isLoading = false,
    this.error,
  });

  AuthState copyWith({
    bool? isLoggedIn,
    Map<String, dynamic>? user,
    bool? isLoading,
    String? error,
  }) => AuthState(
    isLoggedIn: isLoggedIn ?? this.isLoggedIn,
    user: user ?? this.user,
    isLoading: isLoading ?? this.isLoading,
    error: error,
  );

  String get displayName {
    if (user == null) return 'Guest';
    return user!['name'] as String? ?? user!['email'] as String? ?? 'User';
  }

  String? get avatarUrl => user?['avatarUrl'] as String?;
  String? get role => user?['role'] as String?;
  bool get isAdmin => role == 'admin';
}

class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    return _checkSession();
  }

  Future<AuthState> _checkSession() async {
    try {
      final token = await _storage.read(key: 'session_token');
      if (token == null) return const AuthState(isLoggedIn: false);

      final userData = await nexcomApi.getMe();
      if (userData.isEmpty) {
        await _storage.delete(key: 'session_token');
        return const AuthState(isLoggedIn: false);
      }

      return AuthState(isLoggedIn: true, user: userData);
    } catch (_) {
      return const AuthState(isLoggedIn: false);
    }
  }

  Future<void> logout() async {
    state = const AsyncValue.loading();
    try {
      await nexcomApi.logout();
    } catch (_) {
      // Best-effort logout
    }
    await _storage.delete(key: 'session_token');
    state = const AsyncValue.data(AuthState(isLoggedIn: false));
  }

  Future<void> refresh() async {
    state = AsyncValue.data(state.valueOrNull?.copyWith(isLoading: true) ?? const AuthState(isLoading: true));
    final newState = await _checkSession();
    state = AsyncValue.data(newState);
  }

  /// Called after OAuth web login completes and returns a session token
  Future<void> setToken(String token) async {
    await _storage.write(key: 'session_token', value: token);
    await refresh();
  }
}

final authStateProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

// Convenience provider for current user
final currentUserProvider = Provider<Map<String, dynamic>?>((ref) {
  return ref.watch(authStateProvider).valueOrNull?.user;
});

final isAdminProvider = Provider<bool>((ref) {
  return ref.watch(authStateProvider).valueOrNull?.isAdmin ?? false;
});
