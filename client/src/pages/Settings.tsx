/**
 * NEXCOM Exchange — Settings Page
 * Multi-currency, multi-language, theme, and timezone preferences.
 * Persists to backend via tRPC preferences.update (idempotent upsert).
 */
import { useState } from "react";
import { usePreferences } from "@/contexts/PreferencesContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, DollarSign, Palette, Clock, CheckCircle } from "lucide-react";
import type { Currency, Language } from "@/lib/i18n";

const CURRENCIES: { code: Currency; name: string; symbol: string; flag: string }[] = [
  { code: "NGN", name: "Nigerian Naira",        symbol: "₦",   flag: "🇳🇬" },
  { code: "USD", name: "US Dollar",             symbol: "$",   flag: "🇺🇸" },
  { code: "EUR", name: "Euro",                  symbol: "€",   flag: "🇪🇺" },
  { code: "GBP", name: "British Pound",         symbol: "£",   flag: "🇬🇧" },
  { code: "GHS", name: "Ghanaian Cedi",         symbol: "₵",   flag: "🇬🇭" },
  { code: "KES", name: "Kenyan Shilling",       symbol: "KSh", flag: "🇰🇪" },
  { code: "ZAR", name: "South African Rand",    symbol: "R",   flag: "🇿🇦" },
  { code: "XOF", name: "West African CFA Franc",symbol: "CFA", flag: "🌍" },
];

const LANGUAGES: { code: Language; name: string; nativeName: string; flag: string }[] = [
  { code: "en",  name: "English",         nativeName: "English",       flag: "🇬🇧" },
  { code: "yo",  name: "Yoruba",          nativeName: "Yorùbá",        flag: "🇳🇬" },
  { code: "ig",  name: "Igbo",            nativeName: "Igbo",          flag: "🇳🇬" },
  { code: "ha",  name: "Hausa",           nativeName: "Hausa",         flag: "🇳🇬" },
  { code: "pcm", name: "Nigerian Pidgin", nativeName: "Naija Pidgin",  flag: "🇳🇬" },
];

const TIMEZONES = [
  { value: "Africa/Lagos",       label: "Lagos (WAT, UTC+1)" },
  { value: "Africa/Accra",       label: "Accra (GMT, UTC+0)" },
  { value: "Africa/Nairobi",     label: "Nairobi (EAT, UTC+3)" },
  { value: "Africa/Johannesburg",label: "Johannesburg (SAST, UTC+2)" },
  { value: "Europe/London",      label: "London (GMT/BST)" },
  { value: "America/New_York",   label: "New York (EST/EDT)" },
  { value: "America/Chicago",    label: "Chicago (CST/CDT)" },
  { value: "Asia/Dubai",         label: "Dubai (GST, UTC+4)" },
];

export default function Settings() {
  const { currency, language, setCurrency, setLanguage, t, formatCurrency, isUpdating } = usePreferences();
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [saved, setSaved] = useState(false);

  const updatePrefs = trpc.preferences.update.useMutation({
    onSuccess: () => {
      toast.success("Settings saved successfully");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    updatePrefs.mutate({ currency, language, timezone });
  };

  const sampleAmount = 1_500_000; // ₦1.5M in NGN

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("label.settings")}</h1>
        <p className="text-muted-foreground text-sm mt-1">Personalise your NEXCOM Exchange experience</p>
      </div>

      {/* Currency */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {t("label.currency")}
          </CardTitle>
          <CardDescription>
            All prices are stored in NGN. Your selected currency is used for display only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CURRENCIES.map(c => (
              <button
                key={c.code}
                onClick={() => setCurrency(c.code)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-all ${
                  currency === c.code
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card/50 hover:border-primary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-xl">{c.flag}</span>
                <span className="font-bold">{c.code}</span>
                <span className="text-xs">{c.symbol}</span>
              </button>
            ))}
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-sm">
            <span className="text-muted-foreground">Sample: ₦1,500,000 NGN = </span>
            <span className="font-semibold text-foreground">{formatCurrency(sampleAmount)}</span>
            <Badge variant="outline" className="ml-2 text-xs">{currency}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="w-4 h-4 text-blue-400" />
            {t("label.language")}
          </CardTitle>
          <CardDescription>
            Choose your preferred language for the interface. Nigerian languages and Pidgin are fully supported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`flex items-center gap-3 p-3 rounded-lg border text-sm transition-all text-left ${
                  language === l.code
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/50 hover:border-primary/50"
                }`}
              >
                <span className="text-2xl">{l.flag}</span>
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.nativeName}</div>
                </div>
                {language === l.code && <CheckCircle className="w-4 h-4 text-primary ml-auto" />}
              </button>
            ))}
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-sm mt-3">
            <span className="text-muted-foreground">Sample: </span>
            <span className="font-semibold">{t("nav.dashboard")}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="font-semibold">{t("action.buy")}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="font-semibold">{t("msg.orderPlaced")}</span>
          </div>
        </CardContent>
      </Card>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4 text-amber-400" />
            Timezone
          </CardTitle>
          <CardDescription>
            All timestamps are stored in UTC and displayed in your local timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map(tz => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="w-4 h-4 text-purple-400" />
            {t("label.theme")}
          </CardTitle>
          <CardDescription>
            NEXCOM Exchange uses a dark theme optimised for trading. The dark theme reduces eye strain during extended trading sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {["dark", "light", "system"].map(th => (
              <button
                key={th}
                disabled={th !== "dark"}
                className={`px-4 py-2 rounded-lg border text-sm capitalize transition-all ${
                  th === "dark"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground cursor-not-allowed opacity-40"
                }`}
              >
                {th}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={isUpdating || updatePrefs.isPending}
          className="min-w-32"
        >
          {saved ? (
            <><CheckCircle className="w-4 h-4 mr-2" /> Saved</>
          ) : isUpdating || updatePrefs.isPending ? (
            "Saving..."
          ) : (
            t("action.save")
          )}
        </Button>
      </div>
    </div>
  );
}
