/// NEXCOM Flutter — Loan Notification Provider
///
/// Subscribes to real-time loan lifecycle events from the NEXCOM Exchange
/// WebSocket server using the subscribe_loans protocol.
///
/// Events are delivered via the same /ws/orderbook endpoint.
/// Client sends: { "type": "subscribe_loans", "userId": <int> }
/// Server sends: { "type": "loan_event", "event": { ... } }

import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'auth_provider.dart';

// ─── Types ────────────────────────────────────────────────────────────────────

enum LoanEventType {
  loanApplied,
  loanApproved,
  loanRejected,
  loanDisbursed,
  loanRepaymentDue,
  loanRepaid,
  loanOverdue,
  insuranceSubmitted,
  insuranceApproved,
  insuranceClaim,
}

LoanEventType? _parseLoanEventType(String? raw) {
  switch (raw) {
    case 'LOAN_APPLIED':
      return LoanEventType.loanApplied;
    case 'LOAN_APPROVED':
      return LoanEventType.loanApproved;
    case 'LOAN_REJECTED':
      return LoanEventType.loanRejected;
    case 'LOAN_DISBURSED':
      return LoanEventType.loanDisbursed;
    case 'LOAN_REPAYMENT_DUE':
      return LoanEventType.loanRepaymentDue;
    case 'LOAN_REPAID':
      return LoanEventType.loanRepaid;
    case 'LOAN_OVERDUE':
      return LoanEventType.loanOverdue;
    case 'INSURANCE_SUBMITTED':
      return LoanEventType.insuranceSubmitted;
    case 'INSURANCE_APPROVED':
      return LoanEventType.insuranceApproved;
    case 'INSURANCE_CLAIM':
      return LoanEventType.insuranceClaim;
    default:
      return null;
  }
}

String loanEventLabel(LoanEventType type) {
  switch (type) {
    case LoanEventType.loanApplied:
      return 'Loan Application Received';
    case LoanEventType.loanApproved:
      return 'Loan Approved ✓';
    case LoanEventType.loanRejected:
      return 'Loan Application Rejected';
    case LoanEventType.loanDisbursed:
      return 'Loan Funds Disbursed';
    case LoanEventType.loanRepaymentDue:
      return 'Repayment Due Soon';
    case LoanEventType.loanRepaid:
      return 'Loan Fully Repaid ✓';
    case LoanEventType.loanOverdue:
      return 'Loan Repayment Overdue';
    case LoanEventType.insuranceSubmitted:
      return 'Insurance Application Submitted';
    case LoanEventType.insuranceApproved:
      return 'Crop Insurance Policy Issued ✓';
    case LoanEventType.insuranceClaim:
      return 'Insurance Claim Filed';
  }
}

class LoanNotificationEvent {
  final LoanEventType event;
  final int? loanId;
  final String? applicationRef;
  final double? amount;
  final String? currency;
  final String? dueDate;
  final String? message;
  final DateTime timestamp;

  const LoanNotificationEvent({
    required this.event,
    this.loanId,
    this.applicationRef,
    this.amount,
    this.currency,
    this.dueDate,
    this.message,
    required this.timestamp,
  });

  factory LoanNotificationEvent.fromMap(Map<String, dynamic> map) {
    return LoanNotificationEvent(
      event: _parseLoanEventType(map['event'] as String?) ?? LoanEventType.loanApplied,
      loanId: map['loanId'] as int?,
      applicationRef: map['applicationRef'] as String?,
      amount: (map['amount'] as num?)?.toDouble(),
      currency: map['currency'] as String?,
      dueDate: map['dueDate'] as String?,
      message: map['message'] as String?,
      timestamp: DateTime.now(),
    );
  }

  String get label => loanEventLabel(event);
  bool get isLoanEvent => event.name.startsWith('loan');
}

// ─── State ────────────────────────────────────────────────────────────────────

class LoanNotificationsState {
  final List<LoanNotificationEvent> events;
  final int unreadCount;
  final bool isConnected;

  const LoanNotificationsState({
    this.events = const [],
    this.unreadCount = 0,
    this.isConnected = false,
  });

  LoanNotificationsState copyWith({
    List<LoanNotificationEvent>? events,
    int? unreadCount,
    bool? isConnected,
  }) {
    return LoanNotificationsState(
      events: events ?? this.events,
      unreadCount: unreadCount ?? this.unreadCount,
      isConnected: isConnected ?? this.isConnected,
    );
  }
}

// ─── Notifier ─────────────────────────────────────────────────────────────────

class LoanNotificationsNotifier extends StateNotifier<LoanNotificationsState> {
  final int? userId;
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  bool _disposed = false;

  LoanNotificationsNotifier(this.userId) : super(const LoanNotificationsState()) {
    if (userId != null) _connect();
  }

  Uri get _wsUri {
    // ignore: do_not_use_environment
    const bool isRelease = bool.fromEnvironment('dart.vm.product');
    const prod = 'wss://nexcom-exchange.manus.space/ws/orderbook';
    const dev = 'ws://localhost:3000/ws/orderbook';
    return Uri.parse(isRelease ? prod : dev);
  }

  void _connect() {
    if (_disposed || userId == null) return;
    try {
      _channel = WebSocketChannel.connect(_wsUri);
      _channel!.sink.add(jsonEncode({'type': 'subscribe_loans', 'userId': userId}));
      state = state.copyWith(isConnected: true);

      _channel!.stream.listen(
        (raw) {
          if (_disposed) return;
          try {
            final msg = jsonDecode(raw as String) as Map<String, dynamic>;
            if (msg['type'] == 'loan_event' && msg['event'] != null) {
              final event = LoanNotificationEvent.fromMap(
                msg['event'] as Map<String, dynamic>,
              );
              final updated = [event, ...state.events.take(49)].toList();
              state = state.copyWith(
                events: updated,
                unreadCount: state.unreadCount + 1,
              );
            }
          } catch (_) {
            // Ignore malformed frames
          }
        },
        onError: (_) {
          if (!_disposed) {
            state = state.copyWith(isConnected: false);
            _scheduleReconnect();
          }
        },
        onDone: () {
          if (!_disposed) {
            state = state.copyWith(isConnected: false);
            _scheduleReconnect();
          }
        },
      );
    } catch (_) {
      state = state.copyWith(isConnected: false);
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (!_disposed) _connect();
    });
  }

  void markAllRead() {
    state = state.copyWith(unreadCount: 0);
  }

  void clearEvents() {
    state = state.copyWith(events: [], unreadCount: 0);
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    super.dispose();
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

final loanNotificationsProvider = StateNotifierProvider.autoDispose<
    LoanNotificationsNotifier, LoanNotificationsState>((ref) {
  final user = ref.watch(currentUserProvider);
  final userIdStr = user?['id'] as String?;
  final userId = userIdStr != null ? int.tryParse(userIdStr) : null;
  return LoanNotificationsNotifier(userId);
});
