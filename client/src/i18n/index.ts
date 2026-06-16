/**
 * NEXCOM Exchange — i18n Bootstrap (P4-3)
 *
 * Supports English (en), Hausa (ha), Yoruba (yo), and Igbo (ig).
 * Language is auto-detected from the browser, with 'en' as fallback.
 *
 * Usage:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation('common');
 *   t('nav.dashboard') // → "Dashboard" | "Allon Kula" | etc.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Static imports for bundling (no lazy loading needed at this scale)
import enCommon from "./locales/en/common.json";
import haCommon from "./locales/ha/common.json";

// Yoruba and Igbo translations — placeholder (same as English until translated)
const yoCommon = { ...enCommon };
const igCommon = { ...enCommon };

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon },
      ha: { common: haCommon },
      yo: { common: yoCommon },
      ig: { common: igCommon },
    },
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common"],
    // Language detection order: localStorage → navigator → htmlTag
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "nexcom_language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    // Only log missing keys in development
    saveMissing: process.env.NODE_ENV === "development",
    missingKeyHandler: (lngs, ns, key) => {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[i18n] Missing key: ${ns}:${key} for languages: ${lngs.join(", ")}`);
      }
    },
  });

export default i18n;

/**
 * Supported locales with display names for the language switcher.
 */
export const SUPPORTED_LOCALES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "ig", name: "Igbo", nativeName: "Igbo" },
] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]["code"];
