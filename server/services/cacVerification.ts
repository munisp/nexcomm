/**
 * NEXCOM Exchange — CAC / TIN Verification Adapters (FIX-KYB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification adapters for Nigerian corporate identifiers used by the KYB
 * workflow:
 *
 *  • CAC RC / BN number — Corporate Affairs Commission registration number.
 *      Format: RC followed by 6–7 digits (companies, post-1990 CAMA registry)
 *              BN followed by 7 digits   (business names / enterprises)
 *  • TIN — Federal Inland Revenue Service (FIRS) Tax Identification Number.
 *      Format: 8–13 digits. FIRS issues TINs with a modulus-11 style check
 *      digit on some series; because FIRS has not published a stable public
 *      checksum specification, we validate length/digit structure only and
 *      surface the checksum caveat to reviewers (never claim a verified
 *      checksum).
 *
 * Provider model
 * ──────────────
 * `CacVerificationProvider` is the plug point for a live registry integration.
 * The default `ManualReviewProvider` NEVER fabricates a verification result:
 * it performs format validation, then queues the application for human review
 * with a structured consistency checklist.
 *
 * To wire a live provider (e.g. CAC public search API or a licensed data
 * aggregator), implement `CacVerificationProvider` and set it via
 * `setCacVerificationProvider()` at server bootstrap. A live provider MUST
 * return status "VERIFIED" only on a confirmed registry match.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CacNumberKind = "RC" | "BN";

export interface CacFormatResult {
  valid: boolean;
  kind?: CacNumberKind;
  /** Normalised form (uppercase, no separators) when valid */
  normalized?: string;
  reason?: string;
}

export interface TinFormatResult {
  valid: boolean;
  normalized?: string;
  reason?: string;
  /** Always true today — see module docblock. Surfaced to reviewers. */
  checksumNotVerified?: boolean;
}

export type CacVerificationStatus =
  | "VERIFIED"           // Confirmed against a live registry (live providers only)
  | "FORMAT_INVALID"     // Fails format validation — reject early
  | "PENDING_MANUAL_REVIEW"; // Format OK, queued for human verification

export interface CacVerificationRequest {
  rcNumber: string;
  businessName: string;
  businessType?: string;
  incorporationDate?: string | Date | null;
}

export interface CacVerificationResult {
  status: CacVerificationStatus;
  provider: string;
  /** Structured checklist surfaced to the admin reviewer */
  checklist: CacReviewChecklistItem[];
  /** Registry fields when a live provider returns them (null for manual) */
  registryMatch: {
    registeredName?: string;
    registrationDate?: string;
    status?: string;
  } | null;
  verifiedAt: Date;
  notes?: string;
}

export interface CacReviewChecklistItem {
  key: string;
  label: string;
  passed: boolean | null; // null = requires human judgement
  detail?: string;
}

export interface CacVerificationProvider {
  readonly name: string;
  verify(request: CacVerificationRequest): Promise<CacVerificationResult>;
}

// ─── Format validation ────────────────────────────────────────────────────────

const RC_PATTERN = /^RC[-\s]?(\d{6,7})$/i;
const BN_PATTERN = /^BN[-\s]?(\d{7})$/i;

export function validateCacRcNumber(rcNumber: string): CacFormatResult {
  const cleaned = (rcNumber ?? "").trim().toUpperCase();
  if (!cleaned) return { valid: false, reason: "RC/BN number is required" };

  const rcMatch = cleaned.match(RC_PATTERN);
  if (rcMatch) {
    return { valid: true, kind: "RC", normalized: `RC${rcMatch[1]}` };
  }
  const bnMatch = cleaned.match(BN_PATTERN);
  if (bnMatch) {
    return { valid: true, kind: "BN", normalized: `BN${bnMatch[1]}` };
  }
  return {
    valid: false,
    reason:
      "Invalid CAC number format. Expected RC followed by 6–7 digits (e.g. RC123456) " +
      "for companies, or BN followed by 7 digits for registered business names.",
  };
}

const TIN_PATTERN = /^\d{8,13}$/;

export function validateTin(tin: string): TinFormatResult {
  const cleaned = (tin ?? "").trim().replace(/[-\s]/g, "");
  if (!cleaned) return { valid: false, checksumNotVerified: true, reason: "TIN is required" };
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, checksumNotVerified: true, reason: "TIN must contain digits only" };
  }
  if (!TIN_PATTERN.test(cleaned)) {
    return {
      valid: false,
      checksumNotVerified: true,
      reason: "Invalid TIN length. FIRS TINs are 8–13 digits.",
    };
  }
  return {
    valid: true,
    normalized: cleaned,
    checksumNotVerified: true, // FIRS checksum spec is not publicly stable — see docblock
  };
}

// ─── Business-type / RC-kind consistency ──────────────────────────────────────

/** BN numbers are issued to business names (sole prop / partnership), RC to incorporated entities. */
function rcKindMatchesBusinessType(kind: CacNumberKind, businessType?: string): boolean | null {
  if (!businessType) return null;
  const bt = businessType.toUpperCase();
  if (kind === "BN") return bt === "SOLE_PROP" || bt === "PARTNERSHIP";
  // RC
  return bt === "LLC" || bt === "PLC" || bt === "COOPERATIVE" || bt === "NGO";
}

// ─── Manual review provider (default) ─────────────────────────────────────────

export class ManualReviewProvider implements CacVerificationProvider {
  readonly name = "manual-review";

  async verify(request: CacVerificationRequest): Promise<CacVerificationResult> {
    const format = validateCacRcNumber(request.rcNumber);
    const checklist = this.buildChecklist(request, format);

    if (!format.valid) {
      return {
        status: "FORMAT_INVALID",
        provider: this.name,
        checklist,
        registryMatch: null,
        verifiedAt: new Date(),
        notes: format.reason,
      };
    }

    // Honest result: format is valid but no live registry lookup exists here.
    return {
      status: "PENDING_MANUAL_REVIEW",
      provider: this.name,
      checklist,
      registryMatch: null,
      verifiedAt: new Date(),
      notes:
        "RC number passed format validation. No live CAC registry provider is configured; " +
        "a compliance officer must verify this number against the CAC public search portal " +
        "(https://publicsearch.cac.gov.ng) and the uploaded CAC certificate before approval.",
    };
  }

  private buildChecklist(
    request: CacVerificationRequest,
    format: CacFormatResult,
  ): CacReviewChecklistItem[] {
    const items: CacReviewChecklistItem[] = [
      {
        key: "rc_format",
        label: "RC/BN number matches CAC format (RC + 6–7 digits, or BN + 7 digits)",
        passed: format.valid,
        detail: format.valid ? `Normalised: ${format.normalized}` : format.reason,
      },
      {
        key: "rc_kind_matches_type",
        label: "Registration kind (RC=incorporated entity, BN=business name) matches declared business type",
        passed: format.valid ? rcKindMatchesBusinessType(format.kind!, request.businessType) : null,
        detail: format.valid
          ? `${format.kind} number vs business type ${request.businessType ?? "unknown"}`
          : undefined,
      },
      {
        key: "name_matches_certificate",
        label: "Business name on CAC certificate matches the declared business name exactly",
        passed: null,
        detail: "Compare the uploaded CAC certificate with the declared name (manual check)",
      },
      {
        key: "rc_matches_certificate",
        label: "RC/BN number appears on the uploaded CAC certificate / status report",
        passed: null,
        detail: "Cross-check via CAC public search portal (manual check)",
      },
      {
        key: "company_active_on_registry",
        label: "Entity shows as ACTIVE (not struck off / dissolved) on the CAC registry",
        passed: null,
        detail: "Check https://publicsearch.cac.gov.ng (manual check)",
      },
      {
        key: "incorporation_date_matches",
        label: "Incorporation date on the certificate matches the declared date",
        passed: null,
        detail: request.incorporationDate
          ? `Declared: ${new Date(request.incorporationDate).toISOString().slice(0, 10)}`
          : "No incorporation date declared",
      },
      {
        key: "directors_match_status_report",
        label: "Directors on the CAC status report match the declared directors",
        passed: null,
        detail: "Compare CAC status report with the declared director list (manual check)",
      },
    ];
    return items;
  }
}

// ─── Provider registry ────────────────────────────────────────────────────────

let _provider: CacVerificationProvider = new ManualReviewProvider();

/**
 * Install a live CAC verification provider (called once at server bootstrap).
 * Example:
 *   import { setCacVerificationProvider, CacVerificationProvider } from "./services/cacVerification";
 *   if (process.env.CAC_API_KEY) setCacVerificationProvider(new LiveCacApiProvider(...));
 */
export function setCacVerificationProvider(provider: CacVerificationProvider): void {
  _provider = provider;
}

export function getCacVerificationProvider(): CacVerificationProvider {
  return _provider;
}

/** Convenience wrapper used by kybRouter. */
export async function verifyCacRegistration(
  request: CacVerificationRequest,
): Promise<CacVerificationResult> {
  return _provider.verify(request);
}
