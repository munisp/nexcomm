/**
 * NEXCOM Mobile — lazy MMKV key/value store.
 *
 * react-native-mmkv instances are created on FIRST use, never at module
 * scope: constructing an MMKV instance does native work, and doing it in the
 * entry path adds to cold-start TTI. Every consumer (offline read cache,
 * offline mutation queue) shares the single instance created here.
 *
 * The structural `KvStore` type is used instead of the package's exported
 * types so this module stays type-stable across react-native-mmkv 3.x
 * minor releases.
 */
import { MMKV } from 'react-native-mmkv';

/** Minimal structural subset of the MMKV API used by this app. */
export interface KvStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
}

let instance: KvStore | null = null;

/** Get (creating on first call) the shared app MMKV instance. */
export function getKv(): KvStore {
  if (!instance) {
    instance = new MMKV({ id: 'nexcom-app' }) as unknown as KvStore;
  }
  return instance;
}
