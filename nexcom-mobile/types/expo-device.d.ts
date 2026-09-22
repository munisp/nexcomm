/**
 * Ambient types for the OPTIONAL expo-device module.
 *
 * expo-device is not a declared dependency of nexcom-mobile (it arrives
 * transitively in some build environments). lib/notifications.ts loads it
 * lazily and degrades gracefully when it is absent. This declaration keeps
 * `tsc --noEmit` clean in environments where the package is not installed;
 * when the real package IS present its own typings take precedence over
 * this ambient declaration.
 */
declare module 'expo-device' {
  export const isDevice: boolean;
  export const deviceName: string | null;
  export const modelName: string | null;
  export const osName: string | null;
  export const osVersion: string | null;
}
