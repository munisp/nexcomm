/**
 * NEXCOM Exchange — Language Switcher (i18n P4-3)
 *
 * Renders a compact dropdown in the header for switching between
 * English, Hausa, Yoruba, and Igbo.
 */

import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const currentLocale = (i18n.language?.slice(0, 2) ?? "en") as SupportedLocale;

  const handleChange = (code: SupportedLocale) => {
    i18n.changeLanguage(code);
  };

  const current = SUPPORTED_LOCALES.find(l => l.code === currentLocale) ?? SUPPORTED_LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs font-medium"
          aria-label="Switch language"
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{current.nativeName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {SUPPORTED_LOCALES.map(locale => (
          <DropdownMenuItem
            key={locale.code}
            onClick={() => handleChange(locale.code)}
            className={currentLocale === locale.code ? "font-semibold bg-accent" : ""}
            aria-current={currentLocale === locale.code ? "true" : undefined}
          >
            <span className="mr-2 text-sm">{locale.nativeName}</span>
            {currentLocale === locale.code && (
              <span className="ml-auto text-xs text-muted-foreground">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
