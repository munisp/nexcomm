/**
 * NEXCOM Exchange — Preferences Context
 * Provides currency, language, and translation helpers to the entire app.
 * Persists to localStorage for instant load; syncs with backend on login.
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  type Language, type Currency,
  t as translate, formatCurrency as fmt,
  type TranslationKey,
} from "@/lib/i18n";

interface PreferencesContextValue {
  currency: Currency;
  language: Language;
  setCurrency: (c: Currency) => void;
  setLanguage: (l: Language) => void;
  t: (key: TranslationKey) => string;
  formatCurrency: (amountNGN: number, compact?: boolean) => string;
  isUpdating: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  currency: "NGN",
  language: "en",
  setCurrency: () => {},
  setLanguage: () => {},
  t: (key) => key,
  formatCurrency: (n) => `₦${n.toLocaleString()}`,
  isUpdating: false,
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  // Load from localStorage first for instant render
  const [currency, setCurrencyState] = useState<Currency>(() => {
    return (localStorage.getItem("nexcom_currency") as Currency) ?? "NGN";
  });
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem("nexcom_language") as Language) ?? "en";
  });

  // Fetch from backend when authenticated
  const { data: prefs } = trpc.preferences.get.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // Sync backend prefs into local state
  useEffect(() => {
    if (prefs) {
      setCurrencyState(prefs.currency as Currency);
      setLanguageState(prefs.language as Language);
      localStorage.setItem("nexcom_currency", prefs.currency);
      localStorage.setItem("nexcom_language", prefs.language);
    }
  }, [prefs]);

  const updatePrefs = trpc.preferences.update.useMutation();
  const utils = trpc.useUtils();

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("nexcom_currency", c);
    if (isAuthenticated) {
      updatePrefs.mutate({ currency: c }, {
        onSuccess: () => utils.preferences.get.invalidate(),
      });
    }
  }, [isAuthenticated, updatePrefs, utils]);

  const setLanguage = useCallback((l: Language) => {
    setLanguageState(l);
    localStorage.setItem("nexcom_language", l);
    if (isAuthenticated) {
      updatePrefs.mutate({ language: l }, {
        onSuccess: () => utils.preferences.get.invalidate(),
      });
    }
  }, [isAuthenticated, updatePrefs, utils]);

  const tFn = useCallback((key: TranslationKey) => translate(key, language), [language]);
  const formatCurrencyFn = useCallback(
    (amountNGN: number, compact = false) => fmt(amountNGN, currency, compact),
    [currency]
  );

  return (
    <PreferencesContext.Provider value={{
      currency,
      language,
      setCurrency,
      setLanguage,
      t: tFn,
      formatCurrency: formatCurrencyFn,
      isUpdating: updatePrefs.isPending,
    }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
