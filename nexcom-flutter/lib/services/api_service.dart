import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:logger/logger.dart';

final _logger = Logger();
const _storage = FlutterSecureStorage();

/// NexcomApiService wraps all tRPC calls as typed Dart methods.
/// The NEXCOM backend exposes tRPC over HTTP POST at /api/trpc/{procedure}.
class NexcomApiService {
  static const String _baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://nexcom-exchange.manus.space',
  );

  late final Dio _dio;

  NexcomApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: 'session_token');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) {
        _logger.e('API Error: ${error.message}', error: error);
        handler.next(error);
      },
    ));
  }

  // ─── tRPC helper ──────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> _query(String procedure, [Map<String, dynamic>? input]) async {
    final params = input != null ? {'input': jsonEncode(input)} : <String, dynamic>{};
    final response = await _dio.get('/api/trpc/$procedure', queryParameters: params);
    return _unwrapTrpc(response.data);
  }

  Future<Map<String, dynamic>> _mutate(String procedure, Map<String, dynamic> input) async {
    final response = await _dio.post('/api/trpc/$procedure', data: {'0': input});
    return _unwrapTrpc(response.data);
  }

  Map<String, dynamic> _unwrapTrpc(dynamic data) {
    if (data is List && data.isNotEmpty) {
      final result = data[0];
      if (result['result'] != null) return result['result']['data'] ?? {};
      if (result['error'] != null) throw Exception(result['error']['message']);
    }
    if (data is Map) {
      if (data['result'] != null) return (data['result']['data'] ?? {}) as Map<String, dynamic>;
      if (data['error'] != null) throw Exception(data['error']['message']);
    }
    return {};
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMe() => _query('auth.me');

  Future<void> logout() async {
    await _mutate('auth.logout', {});
    await _storage.delete(key: 'session_token');
  }

  // ─── Live Prices ──────────────────────────────────────────────────────────

  Future<List<dynamic>> getLivePrices() async {
    final result = await _query('prices.list');
    return result['prices'] as List? ?? [];
  }

  Future<Map<String, dynamic>> getPriceHistory(String symbol, String interval) async {
    return _query('prices.history', {'symbol': symbol, 'interval': interval});
  }

  Future<Map<String, dynamic>> getMarketSummary() => _query('prices.marketSummary');

  // ─── Orders ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> placeOrder({
    required String symbol,
    required String side,
    required String type,
    required double quantity,
    double? price,
    double? stopPrice,
  }) => _mutate('orders.place', {
    'symbol': symbol,
    'side': side,
    'type': type,
    'quantity': quantity,
    if (price != null) 'price': price,
    if (stopPrice != null) 'stopPrice': stopPrice,
  });

  Future<List<dynamic>> getOpenOrders() async {
    final result = await _query('orders.open');
    return result['orders'] as List? ?? [];
  }

  Future<List<dynamic>> getOrderHistory({int page = 1, int limit = 20}) async {
    final result = await _query('orders.history', {'page': page, 'limit': limit});
    return result['orders'] as List? ?? [];
  }

  Future<Map<String, dynamic>> cancelOrder(int orderId) =>
      _mutate('orders.cancel', {'orderId': orderId});

  // ─── Portfolio ────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getPortfolioSummary() => _query('portfolio.summary');

  Future<List<dynamic>> getPositions() async {
    final result = await _query('portfolio.positions');
    return result['positions'] as List? ?? [];
  }

  Future<List<dynamic>> getTradeHistory({int page = 1, int limit = 20}) async {
    final result = await _query('portfolio.tradeHistory', {'page': page, 'limit': limit});
    return result['trades'] as List? ?? [];
  }

  // ─── Warehouse Receipts ───────────────────────────────────────────────────

  Future<List<dynamic>> getWarehouseReceipts() async {
    final result = await _query('warehouse.list');
    return result['receipts'] as List? ?? [];
  }

  Future<Map<String, dynamic>> getWarehouseReceipt(String id) =>
      _query('warehouse.get', {'id': int.parse(id)});

  Future<Map<String, dynamic>> createWarehouseReceipt(Map<String, dynamic> data) =>
      _mutate('warehouse.create', data);

  Future<Map<String, dynamic>> updateWarehouseReceipt(int id, Map<String, dynamic> data) =>
      _mutate('warehouse.update', {'id': id, ...data});

  // ─── Price Alerts ─────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getPriceAlerts() => _query('priceAlerts.list');

  Future<Map<String, dynamic>> createPriceAlert({
    required String symbol,
    required String condition,
    required double targetPrice,
    String? note,
  }) => _mutate('priceAlerts.create', {
    'symbol': symbol,
    'condition': condition,
    'targetPrice': targetPrice,
    if (note != null) 'note': note,
  });

  Future<void> deletePriceAlert(int id) async {
    await _mutate('priceAlerts.delete', {'id': id});
  }

  Future<Map<String, dynamic>> updatePriceAlert(int id, Map<String, dynamic> data) =>
      _mutate('priceAlerts.update', {'id': id, ...data});

  Future<Map<String, dynamic>> getCurrentPrice(String symbol) =>
      _query('priceAlerts.currentPrice', {'symbol': symbol});

  // ─── Notifications ────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getNotifications({int page = 1, int limit = 20}) =>
      _query('notifications.list', {'page': page, 'limit': limit});

  Future<int> getUnreadCount() async {
    final result = await _query('notifications.unreadCount');
    return result['count'] as int? ?? 0;
  }

  Future<void> markNotificationRead(int id) async {
    await _mutate('notifications.markRead', {'id': id});
  }

  Future<void> markAllNotificationsRead() async {
    await _mutate('notifications.markAllRead', {});
  }

  Future<void> registerPushToken({
    required String token,
    required String platform,
    String? deviceName,
  }) async {
    await _mutate('notifications.registerPushToken', {
      'token': token,
      'platform': platform,
      if (deviceName != null) 'deviceName': deviceName,
    });
  }

  // ─── KYC ──────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getKycStatus() => _query('onboarding.getStatus');

  Future<Map<String, dynamic>> submitKycApplication(Map<String, dynamic> data) =>
      _mutate('onboarding.submit', data);

  Future<Map<String, dynamic>> uploadKycDocument({
    required String documentType,
    required String fileUrl,
    required String fileName,
  }) => _mutate('onboarding.uploadKycDocument', {
    'documentType': documentType,
    'fileUrl': fileUrl,
    'fileName': fileName,
  });

  // ─── TOTP (Two-Factor Authentication) ─────────────────────────────────────

  /// Get current TOTP status for the logged-in user.
  /// Returns: { isEnabled: bool, isSetup: bool, confirmedAt: DateTime? }
  Future<Map<String, dynamic>> getTotpStatus() => _query('totp.getStatus');

  /// Generate a new TOTP secret and QR code data URL.
  /// Returns: { secret: String, qrDataUrl: String, otpauthUrl: String, manualEntryKey: String }
  Future<Map<String, dynamic>> generateTotpSecret() => _mutate('totp.generateSecret', {});

  /// Confirm TOTP setup by verifying the first 6-digit code from the authenticator app.
  /// Returns: { success: bool, backupCodes: List<String> }
  Future<Map<String, dynamic>> confirmTotpSetup(String code) =>
      _mutate('totp.confirmSetup', {'code': code});

  /// Verify a TOTP code (used during login step-up or manual verification).
  /// Returns: { valid: bool }
  Future<Map<String, dynamic>> verifyTotpCode(String code) =>
      _mutate('totp.verifyCode', {'code': code});

  /// Disable TOTP for the current user (requires current TOTP code).
  /// Returns: { success: bool }
  Future<Map<String, dynamic>> disableTotp(String code) =>
      _mutate('totp.disable', {'code': code});

  /// Regenerate backup codes (requires current TOTP code).
  /// Returns: { backupCodes: List<String> }
  Future<Map<String, dynamic>> regenerateTotpBackupCodes(String code) =>
      _mutate('totp.regenerateBackupCodes', {'code': code});

  // ─── Device Sessions ───────────────────────────────────────────────────────

  /// List all active device sessions for the current user.
  /// Returns a list of session objects with deviceId, deviceName, platform, lastSeenAt, isCurrent.
  Future<List<dynamic>> getDeviceSessions() async {
    final result = await _query('deviceSession.listMySessions');
    if (result is Map && result['sessions'] != null) {
      return result['sessions'] as List;
    }
    return [];
  }

  /// Revoke a specific device session by deviceId.
  Future<void> revokeDeviceSession(String deviceId) async {
    await _mutate('deviceSession.revokeDevice', {'deviceId': deviceId});
  }

  /// Revoke all device sessions except the current one.
  Future<void> revokeAllOtherSessions() async {
    await _mutate('deviceSession.revokeAllOtherSessions', {});
  }

  /// Trust a specific device (prevents future step-up auth prompts).
  Future<void> trustDevice(String deviceId) async {
    await _mutate('deviceSession.trustDevice', {'deviceId': deviceId});
  }

  // ─── Farmer / Field Agent ─────────────────────────────────────────────────

  Future<List<dynamic>> getFarmers({String? search, int page = 1}) async {
    final result = await _query('farmers.list', {'search': search, 'page': page});
    return result['farmers'] as List? ?? [];
  }

  Future<Map<String, dynamic>> getFarmer(String id) =>
      _query('farmers.get', {'id': int.parse(id)});

  Future<Map<String, dynamic>> createFarmer(Map<String, dynamic> data) =>
      _mutate('farmers.create', data);

  Future<Map<String, dynamic>> updateFarmer(int id, Map<String, dynamic> data) =>
      _mutate('farmers.update', {'id': id, ...data});

  Future<List<dynamic>> getFarmerCrops(int farmerId) async {
    final result = await _query('farmers.crops', {'farmerId': farmerId});
    return result['crops'] as List? ?? [];
  }

  // ─── Account ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getAccountProfile() => _query('account.profile');

  Future<Map<String, dynamic>> updateAccountProfile(Map<String, dynamic> data) =>
      _mutate('account.updateProfile', data);

  Future<Map<String, dynamic>> getAccountBalance() => _query('account.balance');

  Future<Map<String, dynamic>> getApiKeys() => _query('account.apiKeys');

  Future<Map<String, dynamic>> createApiKey(String name) =>
      _mutate('account.createApiKey', {'name': name});

  Future<void> revokeApiKey(int id) async {
    await _mutate('account.revokeApiKey', {'id': id});
  }
}

// Singleton instance
final nexcomApi = NexcomApiService();
