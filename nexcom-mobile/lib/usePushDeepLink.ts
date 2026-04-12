/**
 * usePushDeepLink.ts
 *
 * Handles Expo push notification deep-links for NEXCOM Exchange.
 * When a push notification is tapped, navigates to the relevant screen
 * based on the `screen` field in the notification data payload.
 *
 * Supported deep-link targets:
 *   screen: "markets"          → /tabs/markets
 *   screen: "trade"            → /tabs/trade?symbol=MAIZE
 *   screen: "banking"          → /banking
 *   screen: "portfolio"        → /portfolio
 *   screen: "alerts"           → /alerts
 *   screen: "kyc"              → /kyc
 *   screen: "notifications"    → /notifications
 *   screen: "order"            → /tabs/trade?orderId=xxx
 *   screen: "loan"             → /banking?tab=loans
 *   screen: "warehouse"        → /tabs/warehouse
 */
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import type { Subscription } from "expo-notifications";

export type PushDeepLinkData = {
  screen?: string;
  symbol?: string;
  orderId?: string;
  loanId?: string;
  alertId?: string;
  tab?: string;
};

export function usePushDeepLink() {
  const router = useRouter();
  const notificationListener = useRef<Subscription>();
  const responseListener = useRef<Subscription>();

  function navigateToScreen(data: PushDeepLinkData) {
    if (!data?.screen) return;
    switch (data.screen) {
      case "markets":
        router.push("/tabs/markets");
        break;
      case "trade":
        if (data.symbol) {
          router.push({ pathname: "/tabs/trade", params: { symbol: data.symbol } });
        } else {
          router.push("/tabs/trade");
        }
        break;
      case "order":
        if (data.orderId) {
          router.push({ pathname: "/tabs/trade", params: { orderId: data.orderId } });
        } else {
          router.push("/tabs/trade");
        }
        break;
      case "banking":
        if (data.tab) {
          router.push({ pathname: "/banking", params: { tab: data.tab } });
        } else {
          router.push("/banking");
        }
        break;
      case "loan":
        router.push({ pathname: "/banking", params: { tab: "loans" } });
        break;
      case "portfolio":
        router.push("/portfolio");
        break;
      case "alerts":
        if (data.alertId) {
          router.push({ pathname: "/alerts", params: { alertId: data.alertId } });
        } else {
          router.push("/alerts");
        }
        break;
      case "kyc":
        router.push("/kyc");
        break;
      case "notifications":
        router.push("/notifications");
        break;
      case "warehouse":
        router.push("/tabs/warehouse");
        break;
      case "security":
        router.push("/security");
        break;
      default:
        // Unknown screen — go to dashboard
        router.push("/tabs");
        break;
    }
  }

  useEffect(() => {
    // Handle notification received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      // Optionally update badge count or show in-app toast
      const data = notification.request.content.data as PushDeepLinkData;
      console.log("[PushDeepLink] Notification received:", data?.screen);
    });

    // Handle notification tapped (app in background or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as PushDeepLinkData;
      console.log("[PushDeepLink] Notification tapped, navigating to:", data?.screen);
      navigateToScreen(data);
    });

    // Handle notification that launched the app from killed state
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        const data = response.notification.request.content.data as PushDeepLinkData;
        if (data?.screen) {
          // Small delay to ensure navigation is ready
          setTimeout(() => navigateToScreen(data), 500);
        }
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);
}
