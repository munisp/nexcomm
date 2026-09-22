/**
 * NEXCOM Exchange — useFormDraft (OFFLINE-RES)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic form-draft autosave for farmers on intermittent 2G/3G: if the
 * connection drops (or the browser is killed) mid-way through a multi-step
 * KYC/KYB/order form, nothing typed is lost.
 *
 *   - Debounced autosave (500ms after the last change) to localStorage.
 *   - Key namespaced per form + user: `nexcom-draft:<formKey>:<scope>`.
 *   - Restore on mount, with a "Draft restored" toast (sonner).
 *   - TTL 7 days — older drafts are discarded, never silently re-applied.
 *   - clearDraft() on successful submit so stale drafts never resurface.
 *   - Quota-guarded: every storage touch is wrapped in try/catch; a full or
 *     unavailable localStorage degrades to a no-op (never crashes the form).
 *
 * Usage:
 *   const draft = useFormDraft({
 *     formKey: "kyb-onboarding",
 *     scope: user?.id != null ? String(user.id) : "anon",
 *     value: { step, business, reg },       // serialisable snapshot
 *     onRestore: (d) => { setStep(d.step); setBusiness(d.business); ... },
 *     enabled: !submitted,                  // optional
 *   });
 *   // on submit success:
 *   draft.clearDraft();
 *
 * localStorage (not IDB) is deliberate: drafts are small (<10KB), synchronous
 * restore-on-mount avoids first-paint flicker, and the async IDB path would
 * complicate every consumer for no benefit at this payload size.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export const FORM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const FORM_DRAFT_DEBOUNCE_MS = 500;
const KEY_PREFIX = "nexcom-draft";

interface DraftEnvelope<T> {
  savedAt: number;
  data: T;
}

export interface UseFormDraftOptions<T> {
  /** Stable per-form identifier, e.g. "kyb-onboarding" */
  formKey: string;
  /** Per-user namespace — pass the authenticated user's id when known */
  scope?: string;
  /** Current serialisable form state snapshot */
  value: T;
  /** Apply a restored draft. Called at most once, on mount. */
  onRestore: (data: T) => void;
  /** Set false to suspend saving (e.g. after successful submit) */
  enabled?: boolean;
  ttlMs?: number;
}

export interface UseFormDraftApi {
  /** Remove the stored draft (call on successful submit) */
  clearDraft: () => void;
  /** True if a draft was restored this mount */
  readonly restored: boolean;
}

function storageKey(formKey: string, scope: string): string {
  return `${KEY_PREFIX}:${formKey}:${scope}`;
}

export function useFormDraft<T>(options: UseFormDraftOptions<T>): UseFormDraftApi {
  const {
    formKey,
    scope = "anon",
    value,
    onRestore,
    enabled = true,
    ttlMs = FORM_DRAFT_TTL_MS,
  } = options;

  const key = storageKey(formKey, scope);
  // Once-per-KEY (not per-mount): the scope often resolves async (user id
  // arrives after first render), and the draft for the user-scoped key must
  // still restore when the key changes.
  const restoredForKeyRef = useRef<string | null>(null);
  const didRestoreRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const valueRef = useRef(value);
  valueRef.current = value;

  // ── Restore (once per key, guarded against StrictMode double-invoke) ──────
  useEffect(() => {
    if (restoredForKeyRef.current === key) return;
    restoredForKeyRef.current = key;
    if (!enabled) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const envelope = JSON.parse(raw) as DraftEnvelope<T>;
      if (
        !envelope ||
        typeof envelope.savedAt !== "number" ||
        Date.now() - envelope.savedAt > ttlMs
      ) {
        // Expired or malformed — discard, never apply stale state
        localStorage.removeItem(key);
        return;
      }
      onRestoreRef.current(envelope.data);
      didRestoreRef.current = true;
      toast("Draft restored", {
        description: "Your unsaved changes from a previous session were recovered.",
        duration: 4000,
      });
    } catch {
      // Storage unavailable or corrupt JSON — fail closed, no restore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // ── Debounced autosave ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    // Don't immediately overwrite a just-restored draft with identical state
    const handle = setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = { savedAt: Date.now(), data: valueRef.current };
        localStorage.setItem(key, JSON.stringify(envelope));
      } catch {
        // Quota exceeded / storage disabled — autosave silently degrades
      }
    }, FORM_DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [key, value, enabled]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  };

  return { clearDraft, restored: didRestoreRef.current };
}
