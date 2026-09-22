"""docai.vlm — document authenticity verification as a provider pattern.

`DocumentVerifier` interface with two implementations:

1. HeuristicDocumentVerifier (DEFAULT, always available, no network):
   OCR-text template/keyword checks, expiry logic, ICAO 9303 MRZ mod-7
   checksum validation when MRZ lines are present, and internal-consistency
   checks (e.g. NIN/BVN digit rules). Confidence is honestly capped at
   HEURISTIC_CONFIDENCE_CAP (0.75) — a heuristic cannot prove authenticity.

2. HttpVLMVerifier (OPTIONAL): OpenAI-compatible vision endpoint via env
   VLM_BASE_URL / VLM_API_KEY / VLM_MODEL (e.g. qwen-vl, minicpm). Sends the
   document image + OCR text for authenticity reasoning; on ANY provider
   error it degrades honestly to the heuristic verdict with
   verifier="heuristic" and an explicit "vlm_unavailable" issue — it never
   fabricates a VLM verdict.

Every verdict carries "verifier": "heuristic" | "vlm" so downstream
consumers (and auditors) know exactly what produced it.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from models.schemas import DocumentType

logger = logging.getLogger("docai.vlm")

HEURISTIC_CONFIDENCE_CAP = 0.75

# Expected template keywords per document type (Nigerian issuers).
EXPECTED_KEYWORDS: dict[DocumentType, list[str]] = {
    DocumentType.NATIONAL_ID: ["FEDERAL REPUBLIC OF NIGERIA", "NATIONAL"],
    DocumentType.NIN_SLIP: ["NATIONAL IDENTIFICATION", "NIN"],
    DocumentType.INTERNATIONAL_PASSPORT: ["NIGERIA", "PASSPORT"],
    DocumentType.DRIVERS_LICENSE: ["DRIVER", "LICEN", "FRSC"],
    DocumentType.VOTERS_CARD: ["INDEPENDENT", "ELECTORAL", "INEC"],
    DocumentType.BVN_PRINTOUT: ["BANK VERIFICATION", "BVN"],
    DocumentType.CAC_CERTIFICATE: ["CORPORATE AFFAIRS COMMISSION", "CERTIFICATE"],
    DocumentType.TAX_CLEARANCE: ["FEDERAL INLAND REVENUE", "TAX"],
}


def _icao_check_digit(data: str) -> int:
    """ICAO 9303 mod-7-3 check digit."""
    weights = [7, 3, 1]
    values = {**{str(i): i for i in range(10)},
              **{chr(ord("A") + i): 10 + i for i in range(26)}, "<": 0}
    return sum(values.get(ch, 0) * weights[i % 3] for i, ch in enumerate(data)) % 10


def validate_mrz(mrz_line2: str) -> tuple[bool, list[str]]:
    """Validate TD3 MRZ line 2 checksums (passport number, DOB, expiry,
    composite). Returns (all_valid, issues)."""
    issues: list[str] = []
    line = mrz_line2.strip().upper()
    if len(line) != 44:
        return False, ["mrz_line2_length_invalid"]
    doc_no, doc_chk = line[0:9], line[9]
    dob, dob_chk = line[13:19], line[19]
    expiry, exp_chk = line[21:27], line[27]
    composite_data = line[0:10] + line[13:20] + line[21:43]
    composite_chk = line[43]
    checks = [
        ("mrz_doc_number_checksum", doc_no, doc_chk),
        ("mrz_dob_checksum", dob, dob_chk),
        ("mrz_expiry_checksum", expiry, exp_chk),
        ("mrz_composite_checksum", composite_data, composite_chk),
    ]
    valid = True
    for name, data, chk in checks:
        if not chk.isdigit() or _icao_check_digit(data) != int(chk):
            issues.append(name)
            valid = False
    return valid, issues


def parse_date(value: str) -> Optional[datetime]:
    """Parse common Nigerian document date formats; None when unparsable."""
    value = value.strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d",
                "%d/%m/%y", "%d-%m-%y", "%d %b %Y", "%d %B %Y"):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.year < 100:  # 2-digit year pivot
                dt = dt.replace(year=dt.year + (2000 if dt.year < 50 else 1900))
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


class DocumentVerifier(ABC):
    """Authenticity verifier interface."""

    name: str = "abstract"

    @abstractmethod
    def verify(self, image_path: str, document_type: DocumentType,
               ocr_text: str, ocr_fields: Optional[list[dict]] = None) -> dict:
        """Return the verdict contract (see _verdict())."""

    def capability(self) -> dict:
        return {"verifier": self.name, "available": True}


def _verdict(*, is_authentic: bool, confidence: float, verifier: str,
             issues: list[str], checks: dict, vlm_analysis: str = "",
             expiry_valid: bool = True, tampering_detected: bool = False,
             processing_ms: int = 0) -> dict:
    return {
        "is_authentic": bool(is_authentic),
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "verifier": verifier,
        "issues": issues,
        "checks": checks,
        "vlm_analysis": vlm_analysis,
        "expiry_valid": expiry_valid,
        "tampering_detected": tampering_detected,
        "processing_time_ms": processing_ms,
    }


class HeuristicDocumentVerifier(DocumentVerifier):
    """Default verifier: template keywords + expiry + MRZ checksums."""

    name = "heuristic"

    def verify(self, image_path: str, document_type: DocumentType,
               ocr_text: str, ocr_fields: Optional[list[dict]] = None) -> dict:
        start = time.time()
        issues: list[str] = []
        checks: dict[str, object] = {}
        scores: list[float] = []

        text_upper = (ocr_text or "").upper()

        # 1. Template keyword check
        expected = EXPECTED_KEYWORDS.get(document_type, [])
        if expected:
            hits = sum(1 for kw in expected if kw in text_upper)
            kw_score = hits / len(expected)
            scores.append(kw_score)
            checks["template_keywords"] = {"expected": expected, "matched": hits}
            if kw_score < 0.5:
                issues.append("missing_expected_document_keywords")
        else:
            checks["template_keywords"] = {"expected": [], "matched": 0}

        # 2. Field-level consistency from OCR output
        fields = ocr_fields or []
        fmap = {f.get("field_name"): str(f.get("value", "")) for f in fields}
        has_fields = any(v for v in fmap.values())
        scores.append(0.7 if has_fields else 0.2)
        checks["fields_extracted"] = sorted(k for k, v in fmap.items() if v)
        if not has_fields:
            issues.append("no_structured_fields_extracted")

        # 3. Identifier format rules
        if fmap.get("nin") and not re.fullmatch(r"\d{11}", fmap["nin"]):
            issues.append("nin_format_invalid")
        if fmap.get("bvn") and not re.fullmatch(r"\d{11}", fmap["bvn"]):
            issues.append("bvn_format_invalid")
        if fmap.get("vin") and not re.fullmatch(r"\d{19}", fmap["vin"]):
            issues.append("vin_format_invalid")
        checks["identifier_formats_ok"] = not any(
            i.endswith("format_invalid") for i in issues)

        # 4. Expiry logic
        expiry_valid = True
        expiry_raw = fmap.get("expiry_date")
        if expiry_raw:
            expiry_dt = parse_date(expiry_raw)
            if expiry_dt is None:
                issues.append("expiry_date_unparsable")
                scores.append(0.4)
            elif expiry_dt < datetime.now(timezone.utc):
                expiry_valid = False
                issues.append("document_expired")
                scores.append(0.0)
            else:
                scores.append(1.0)
            checks["expiry"] = {"raw": expiry_raw, "valid": expiry_valid}

        # 5. MRZ checksum (passports / ID cards with MRZ)
        mrz2 = fmap.get("mrz_line2")
        if mrz2:
            mrz_ok, mrz_issues = validate_mrz(mrz2)
            checks["mrz_checksum"] = {"valid": mrz_ok, "failures": mrz_issues}
            scores.append(1.0 if mrz_ok else 0.0)
            issues.extend(mrz_issues)

        # 6. Minimum text presence
        if len(text_upper.strip()) < 20:
            issues.append("ocr_text_too_sparse")
            scores.append(0.2)

        confidence = (sum(scores) / len(scores)) if scores else 0.3
        confidence = min(confidence, HEURISTIC_CONFIDENCE_CAP)
        is_authentic = confidence >= 0.5 and expiry_valid and not any(
            i.endswith("checksum") or i == "document_expired" for i in issues)
        return _verdict(
            is_authentic=is_authentic,
            confidence=confidence,
            verifier=self.name,
            issues=issues,
            checks=checks,
            expiry_valid=expiry_valid,
            processing_ms=int((time.time() - start) * 1000),
        )


class HttpVLMVerifier(DocumentVerifier):
    """Optional OpenAI-compatible vision-model verifier.

    Env: VLM_BASE_URL (e.g. http://vllm:8000/v1), VLM_API_KEY, VLM_MODEL.
    On any transport/parse error the verdict honestly degrades to the
    heuristic verifier (issue "vlm_unavailable") — fail-visible, never fake.
    """

    name = "vlm"

    PROMPT = (
        "You are a Nigerian KYC document forensics analyst. Given this document "
        "image and its OCR text, assess authenticity. Reply with STRICT JSON: "
        '{"is_authentic": bool, "confidence": 0-1, "issues": [str], '
        '"tampering_detected": bool, "analysis": str}. '
        "Check template layout, font consistency, photo placement, security "
        "features, tampering signs, and OCR/layout coherence. Document type: "
    )

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None,
                 model: Optional[str] = None, timeout: float = 30.0):
        self.base_url = (base_url or os.environ.get("VLM_BASE_URL", "")).rstrip("/")
        self.api_key = api_key if api_key is not None else os.environ.get("VLM_API_KEY", "")
        self.model = model or os.environ.get("VLM_MODEL", "")
        self.timeout = timeout
        self._fallback = HeuristicDocumentVerifier()

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    def capability(self) -> dict:
        return {
            "verifier": self.name,
            "configured": self.configured,
            "base_url": self.base_url or None,
            "model": self.model or None,
        }

    def verify(self, image_path: str, document_type: DocumentType,
               ocr_text: str, ocr_fields: Optional[list[dict]] = None) -> dict:
        if not self.configured:
            verdict = self._fallback.verify(image_path, document_type, ocr_text, ocr_fields)
            verdict["issues"] = verdict["issues"] + ["vlm_not_configured"]
            verdict["checks"]["vlm"] = {"configured": False}
            return verdict
        start = time.time()
        try:
            import httpx

            with open(image_path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode()
            ext = os.path.splitext(image_path)[1].lstrip(".").lower() or "jpeg"
            mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(ext, "jpeg")
            payload = {
                "model": self.model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text",
                         "text": self.PROMPT + document_type.value
                                 + "\nOCR TEXT:\n" + (ocr_text or "")[:4000]},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/{mime};base64,{b64}"}},
                    ],
                }],
                "temperature": 0.0,
                "max_tokens": 800,
            }
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(f"{self.base_url}/chat/completions",
                                   json=payload, headers=headers)
                resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            data = self._parse_json(content)
            issues = [str(i) for i in data.get("issues", [])]
            confidence = float(data.get("confidence", 0.5))
            # The VLM's expiry/tamper signals are advisory; heuristic expiry
            # logic still runs so expired docs never pass silently.
            heuristic = self._fallback.verify(image_path, document_type,
                                              ocr_text, ocr_fields)
            expiry_valid = heuristic["expiry_valid"]
            if not expiry_valid:
                issues.append("document_expired")
            is_authentic = (bool(data.get("is_authentic")) and expiry_valid
                            and not data.get("tampering_detected", False))
            return _verdict(
                is_authentic=is_authentic,
                confidence=confidence,
                verifier=self.name,
                issues=issues,
                checks={"vlm_raw": data, "heuristic_expiry_valid": expiry_valid},
                vlm_analysis=str(data.get("analysis", "")),
                expiry_valid=expiry_valid,
                tampering_detected=bool(data.get("tampering_detected", False)),
                processing_ms=int((time.time() - start) * 1000),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("VLM provider failed, degrading to heuristic: %s", exc)
            verdict = self._fallback.verify(image_path, document_type,
                                            ocr_text, ocr_fields)
            verdict["issues"] = verdict["issues"] + ["vlm_unavailable"]
            verdict["checks"]["vlm"] = {"error": f"{type(exc).__name__}: {exc}"}
            return verdict

    @staticmethod
    def _parse_json(content: str) -> dict:
        """Extract the first JSON object from a model completion."""
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            raise ValueError("vlm_response_not_json")
        return json.loads(match.group(0))


def get_verifier() -> DocumentVerifier:
    """VLM when VLM_BASE_URL+VLM_MODEL are configured, else heuristic.
    Result is honest in both cases (verdict.verifier tells you which)."""
    vlm = HttpVLMVerifier()
    if vlm.configured:
        return vlm
    return HeuristicDocumentVerifier()
