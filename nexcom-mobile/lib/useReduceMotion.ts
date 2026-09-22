/**
 * NEXCOM Mobile — reduce-motion accessibility helper.
 *
 * Single place to honour the OS "Remove animations" / "Reduce motion"
 * setting. Any screen that adds animated UI must gate it on this hook and
 * fall back to an instant (0ms) state change.
 *
 * Current audit status: the app contains NO Animated/Reanimated/JS-thread
 * animations (screen transitions are native via expo-router), so this hook
 * is consumed where motion would otherwise be introduced (dashboard,
 * root navigator transitions).
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True when the user asked the OS to minimize animation. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {
        /* leave default */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

/** Duration helper: instant when reduce-motion is on. */
export function motionDuration(ms: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : ms;
}
