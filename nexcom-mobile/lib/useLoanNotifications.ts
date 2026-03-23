/**
 * NEXCOM Mobile — Loan Notifications WebSocket Hook
 *
 * Subscribes to real-time loan lifecycle events from the NEXCOM Exchange
 * WebSocket server. Events are delivered via the same /ws/orderbook endpoint
 * using the subscribe_loans protocol.
 *
 * Usage:
 *   const { events, status, clearEvents } = useLoanNotifications(userId);
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoanEventType =
  | 'LOAN_APPLIED'
  | 'LOAN_APPROVED'
  | 'LOAN_REJECTED'
  | 'LOAN_DISBURSED'
  | 'LOAN_REPAYMENT_DUE'
  | 'LOAN_REPAID'
  | 'LOAN_OVERDUE'
  | 'INSURANCE_SUBMITTED'
  | 'INSURANCE_APPROVED'
  | 'INSURANCE_CLAIM';

export interface LoanEvent {
  event: LoanEventType;
  loanId?: number;
  applicationRef?: string;
  amount?: number;
  currency?: string;
  dueDate?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export type LoanNotificationStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface LoanNotificationsState {
  events: LoanEvent[];
  status: LoanNotificationStatus;
  unreadCount: number;
  clearEvents: () => void;
  markAllRead: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const base = __DEV__ ? CONFIG.DEV_URL : CONFIG.BASE_URL;
  return base.replace(/^http/, 'ws') + '/ws/orderbook';
}

const EVENT_LABELS: Record<LoanEventType, string> = {
  LOAN_APPLIED: 'Loan Application Received',
  LOAN_APPROVED: 'Loan Approved ✓',
  LOAN_REJECTED: 'Loan Application Rejected',
  LOAN_DISBURSED: 'Loan Funds Disbursed',
  LOAN_REPAYMENT_DUE: 'Repayment Due Soon',
  LOAN_REPAID: 'Loan Fully Repaid ✓',
  LOAN_OVERDUE: 'Loan Repayment Overdue',
  INSURANCE_SUBMITTED: 'Insurance Application Submitted',
  INSURANCE_APPROVED: 'Crop Insurance Policy Issued ✓',
  INSURANCE_CLAIM: 'Insurance Claim Filed',
};

export function getLoanEventLabel(event: LoanEventType): string {
  return EVENT_LABELS[event] ?? event;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLoanNotifications(userId: number | null | undefined): LoanNotificationsState {
  const [events, setEvents] = useState<LoanEvent[]>([]);
  const [status, setStatus] = useState<LoanNotificationStatus>('disconnected');
  const [unreadCount, setUnreadCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current || !userId) return;

    setStatus('connecting');

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setStatus('connected');
        // Subscribe to loan events for this user
        ws.send(JSON.stringify({ type: 'subscribe_loans', userId }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'loan_event' && msg.event) {
            const loanEvent: LoanEvent = {
              ...msg.event,
              timestamp: Date.now(),
            };
            setEvents((prev) => [loanEvent, ...prev.slice(0, 49)]); // keep last 50
            setUnreadCount((c) => c + 1);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus('error');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus('disconnected');
        // Auto-reconnect after 5 seconds
        reconnectTimer.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, 5000);
      };
    } catch {
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    if (userId) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, userId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setUnreadCount(0);
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return { events, status, unreadCount, clearEvents, markAllRead };
}
