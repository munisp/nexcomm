/**
 * NEXCOM Exchange — Push Notification Service
 *
 * Handles Expo push token registration, permission requests,
 * local notification scheduling, and price alert management.
 * Connects to the NEXCOM Exchange backend to sync alert subscriptions.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CONFIG } from '../constants/config';

// ─────────────────────────────────────────────────────────────
// Notification handler configuration
// ─────────────────────────────────────────────────────────────

/**
 * Configure how notifications behave when the app is in the foreground.
 * Must be called before any notification interaction.
 */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// Permission & token registration
// ─────────────────────────────────────────────────────────────

/**
 * Requests notification permissions and returns the Expo push token.
 * Returns null if permissions are denied or the device is a simulator.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[Notifications] Push notifications require a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted');
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('price-alerts', {
      name: 'Price Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00d4aa',
      sound: 'trade-alert.wav',
    });

    await Notifications.setNotificationChannelAsync('trade-confirmations', {
      name: 'Trade Confirmations',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 100],
      lightColor: '#3b82f6',
    });

    await Notifications.setNotificationChannelAsync('system', {
      name: 'System Notifications',
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  // Get the Expo push token
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: CONFIG.EAS_PROJECT_ID,
  });

  return tokenData.data;
}

// ─────────────────────────────────────────────────────────────
// Price alert types
// ─────────────────────────────────────────────────────────────

export type AlertCondition = 'ABOVE' | 'BELOW' | 'PERCENT_CHANGE' | 'VOLUME_SPIKE';

export interface PriceAlert {
  id: string;
  symbol: string;
  commodityName: string;
  condition: AlertCondition;
  targetPrice?: number;
  percentChange?: number;
  currentPrice: number;
  isActive: boolean;
  createdAt: number;
  triggeredAt?: number;
  notificationId?: string;
}

// ─────────────────────────────────────────────────────────────
// Local notification scheduling
// ─────────────────────────────────────────────────────────────

/**
 * Schedules a local notification immediately (used for demo/offline mode).
 * In production, push notifications come from the server.
 */
export async function sendLocalPriceAlert(
  symbol: string,
  commodityName: string,
  currentPrice: number,
  targetPrice: number,
  condition: AlertCondition
): Promise<string> {
  const direction = condition === 'ABOVE' ? '▲ Above' : '▼ Below';
  const formattedPrice = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(currentPrice);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${symbol} Price Alert 🔔`,
      body: `${commodityName} is now ${formattedPrice} — ${direction} your target of ₦${targetPrice.toLocaleString()}`,
      data: { symbol, currentPrice, targetPrice, condition, type: 'PRICE_ALERT' },
      sound: 'trade-alert.wav',
      badge: 1,
      categoryIdentifier: 'price-alerts',
    },
    trigger: null, // immediate
  });

  return notificationId;
}

/**
 * Sends a trade confirmation notification.
 */
export async function sendTradeConfirmation(params: {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED';
}): Promise<string> {
  const { orderId, symbol, side, quantity, price, status } = params;
  const emoji = side === 'BUY' ? '🟢' : '🔴';
  const statusText = status === 'FILLED' ? 'Filled' : status === 'PARTIALLY_FILLED' ? 'Partially Filled' : 'Cancelled';

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${emoji} Order ${statusText}`,
      body: `${side} ${quantity} MT ${symbol} @ ₦${price.toLocaleString()}/MT — Order #${orderId.slice(-6)}`,
      data: { orderId, symbol, side, quantity, price, status, type: 'TRADE_CONFIRMATION' },
      categoryIdentifier: 'trade-confirmations',
    },
    trigger: null,
  });
}

/**
 * Sends a warehouse receipt expiry reminder.
 */
export async function sendWRExpiryReminder(params: {
  receiptId: string;
  commodity: string;
  daysUntilExpiry: number;
}): Promise<string> {
  const { receiptId, commodity, daysUntilExpiry } = params;
  const urgency = daysUntilExpiry <= 7 ? '⚠️ URGENT' : '📋';

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${urgency} Warehouse Receipt Expiring`,
      body: `${receiptId} (${commodity}) expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. Take action now.`,
      data: { receiptId, commodity, daysUntilExpiry, type: 'WR_EXPIRY' },
      categoryIdentifier: 'system',
    },
    trigger: null,
  });
}

/**
 * Cancels a scheduled notification by ID.
 */
export async function cancelNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * Cancels all scheduled notifications.
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Clears the notification badge count.
 */
export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
}

// ─────────────────────────────────────────────────────────────
// Notification response handling
// ─────────────────────────────────────────────────────────────

export type NotificationHandler = (notification: Notifications.Notification) => void;
export type ResponseHandler = (response: Notifications.NotificationResponse) => void;

/**
 * Sets up notification listeners. Returns a cleanup function.
 */
export function setupNotificationListeners(
  onNotification: NotificationHandler,
  onResponse: ResponseHandler
): () => void {
  const notificationSub = Notifications.addNotificationReceivedListener(onNotification);
  const responseSub = Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    notificationSub.remove();
    responseSub.remove();
  };
}

// ─────────────────────────────────────────────────────────────
// Backend sync helpers
// ─────────────────────────────────────────────────────────────

/**
 * Registers the Expo push token with the NEXCOM Exchange backend.
 * The backend uses this token to send server-side push notifications.
 */
export async function registerTokenWithBackend(
  token: string,
  userId: string,
  authToken: string
): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/trpc/notifications.registerPushToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        json: {
          token,
          platform: Platform.OS,
          deviceName: Device.deviceName || 'Unknown Device',
        },
      }),
    });
    return response.ok;
  } catch (err) {
    console.error('[Notifications] Failed to register token with backend:', err);
    return false;
  }
}
