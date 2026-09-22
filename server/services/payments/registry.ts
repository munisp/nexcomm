/**
 * Payment provider registry (PAY-RAILS).
 *
 * Config-driven:
 *   PAYMENT_PROVIDERS          comma list of enabled rails (default "mock")
 *                              e.g. "paystack,flutterwave,stripe,mock"
 *   PAYMENT_PROVIDER_PRIORITY  optional comma list giving selection order
 *                              (providers not listed keep PAYMENT_PROVIDERS order)
 *
 * Selection: resolveProvider({currency, channel, amountMinor}) returns the
 * first enabled AND configured provider that supports the requested currency
 * and channel. In non-production the mock provider is always resolvable as a
 * fallback so developers can test the full flow without live credentials.
 * In production mock is disabled unless explicitly present in PAYMENT_PROVIDERS.
 */
import type {
  PaymentChannel,
  PaymentProvider,
  PaymentProviderCapabilities,
  ProviderSelector,
} from "./types";
import { paystackProvider } from "./providers/paystack";
import { flutterwaveProvider } from "./providers/flutterwave";
import { monnifyProvider } from "./providers/monnify";
import { interswitchProvider } from "./providers/interswitch";
import { stripePaymentProvider } from "./providers/stripe";
import { mockProvider } from "./providers/mock";

const isProduction = process.env.NODE_ENV === "production";

/** All known providers, keyed by machine name. */
const ALL_PROVIDERS: Record<string, PaymentProvider> = {
  paystack: paystackProvider,
  flutterwave: flutterwaveProvider,
  monnify: monnifyProvider,
  interswitch: interswitchProvider,
  stripe: stripePaymentProvider,
  mock: mockProvider,
};

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Names of providers enabled by config, in declaration order. */
export function enabledProviderNames(): string[] {
  const configured = parseList(process.env.PAYMENT_PROVIDERS);
  const names = configured.length > 0 ? configured : ["mock"];
  return names.filter((n) => {
    if (!ALL_PROVIDERS[n]) {
      console.warn(`[Payments] Unknown provider in PAYMENT_PROVIDERS ignored: ${n}`);
      return false;
    }
    // Sandbox rail is never silently enabled in production.
    if (n === "mock" && isProduction && !configured.includes("mock")) return false;
    return true;
  });
}

/** Enabled providers ordered by PAYMENT_PROVIDER_PRIORITY (then declaration order). */
function orderedProviders(): PaymentProvider[] {
  const enabled = enabledProviderNames();
  const priority = parseList(process.env.PAYMENT_PROVIDER_PRIORITY);
  const rank = (name: string) => {
    const i = priority.indexOf(name);
    return i === -1 ? priority.length + enabled.indexOf(name) : i;
  };
  return [...enabled].sort((a, b) => rank(a) - rank(b)).map((n) => ALL_PROVIDERS[n]);
}

/** Get a provider by name — enabled or not (used by webhooks, which must accept traffic for any configured rail). */
export function getProvider(name: string): PaymentProvider | null {
  const provider = ALL_PROVIDERS[name.toLowerCase()];
  if (!provider) return null;
  // Webhooks may arrive for any configured provider even in production, but the
  // mock rail stays locked out of production unless explicitly enabled.
  if (provider.name === "mock" && isProduction && !enabledProviderNames().includes("mock")) {
    return null;
  }
  return provider;
}

/**
 * Pick the best provider for a collection. Returns null when nothing suitable
 * is enabled+configured (caller should surface a friendly error).
 */
export function resolveProvider(selector: ProviderSelector): PaymentProvider | null {
  const currency = selector.currency.toUpperCase();
  const candidates = orderedProviders().filter((p) => {
    if (!p.currencies.includes(currency)) return false;
    if (selector.channel && !p.channels.includes(selector.channel)) return false;
    // Mock is always "configured"; live rails need credentials.
    return p.isConfigured();
  });
  return candidates[0] ?? null;
}

/** Capability summary for the client UI (DepositPaymentSheet provider picker). */
export interface ProviderCapabilitySummary {
  name: string;
  displayName: string;
  currencies: string[];
  channels: PaymentChannel[];
  capabilities: PaymentProviderCapabilities;
  /** False when enabled by config but missing credentials — UI greys it out. */
  configured: boolean;
  /** True for the sandbox rail — UI can show a "TEST" badge. */
  sandbox: boolean;
}

export function listCapabilities(): ProviderCapabilitySummary[] {
  return orderedProviders().map((p) => ({
    name: p.name,
    displayName: p.displayName,
    currencies: p.currencies,
    channels: p.channels,
    capabilities: p.capabilities,
    configured: p.isConfigured(),
    sandbox: p.name === "mock",
  }));
}
