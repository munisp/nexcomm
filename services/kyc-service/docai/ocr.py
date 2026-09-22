"""docai.ocr — PaddleOCR wrapper for Nigerian KYC/KYB documents.

CPU mode, English, lazy model load (models land under PADDLEOCR_HOME or
~/.paddleocr). Supports BOTH PaddleOCR 3.x (`predict()` API) and 2.x
(`ocr()` API) so the pinned requirements and legacy environments both work.

Honest degradation: when PaddleOCR (or paddlepaddle) is not installed this
module raises OcrUnavailable — it NEVER fabricates OCR output. Callers map
that to a clear 503 with capability details instead of a fake pass.

Supported document types: NIN slips, national ID, voter's cards, driver's
licenses, international passports (incl. MRZ lines), BVN printouts, CAC
certificates, tax clearances, utility bills, bank statements, financials.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Optional

from models.schemas import DocumentType

logger = logging.getLogger("docai.ocr")


class OcrUnavailable(RuntimeError):
    """PaddleOCR is not installed/usable in this environment."""


class OcrField(dict):
    """Lightweight structured field: name/value/confidence (+bbox when known)."""

    def __init__(self, field_name: str, value: str, confidence: float,
                 bounding_box: Optional[list] = None):
        super().__init__(
            field_name=field_name,
            value=value,
            confidence=round(max(0.0, min(1.0, float(confidence))), 4),
            bounding_box=bounding_box,
        )


class PaddleOcrEngine:
    """Lazy-loading PaddleOCR engine (CPU, English)."""

    def __init__(self) -> None:
        self._ocr: Any = None
        self._api_version: Optional[str] = None  # "v3" | "v2"
        self._init_attempted = False
        self._init_error: Optional[str] = None
        self._lock = threading.Lock()

    # ── lifecycle ─────────────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        self._ensure_init()
        return self._ocr is not None

    def capability(self) -> dict:
        self._ensure_init()
        return {
            "engine": "paddleocr",
            "available": self._ocr is not None,
            "api_version": self._api_version,
            "error": self._init_error,
        }

    def _ensure_init(self) -> None:
        if self._init_attempted:
            return
        with self._lock:
            if self._init_attempted:
                return
            self._init_attempted = True
            try:
                import paddleocr  # noqa: F401
                from paddleocr import PaddleOCR

                # PaddleOCR 3.x constructor (pinned requirements). Falls back
                # to the 2.x signature when an older paddleocr is installed.
                try:
                    self._ocr = PaddleOCR(
                        use_doc_orientation_classify=False,
                        use_doc_unwarping=False,
                        use_textline_orientation=True,
                        lang="en",
                        device="cpu",
                    )
                    self._api_version = "v3"
                except (TypeError, ValueError):
                    self._ocr = PaddleOCR(
                        use_angle_cls=True, lang="en", show_log=False,
                        use_gpu=False, det_db_thresh=0.3,
                        det_db_box_thresh=0.5, rec_batch_num=6,
                    )
                    self._api_version = "v2"
                logger.info("PaddleOCR initialised (%s API)", self._api_version)
            except Exception as exc:  # noqa: BLE001
                self._ocr = None
                self._init_error = f"{type(exc).__name__}: {exc}"
                logger.warning("PaddleOCR unavailable: %s", self._init_error)

    # ── extraction ────────────────────────────────────────────────────────

    def extract_text(self, image_path: str) -> dict:
        """Raw OCR: lines with text/confidence/bbox + joined raw_text."""
        self._ensure_init()
        if self._ocr is None:
            raise OcrUnavailable(
                f"PaddleOCR is not available ({self._init_error or 'not installed'}); "
                "install paddleocr + paddlepaddle and set PADDLEOCR_HOME for model cache"
            )
        start = time.time()
        lines: list[dict] = []
        if self._api_version == "v3":
            for res in self._ocr.predict(input=image_path):
                # v3 result behaves like a dict of numpy arrays
                texts = list(res.get("rec_texts", []))
                scores = list(res.get("rec_scores", []))
                boxes = list(res.get("rec_boxes", res.get("dt_polys", [])))
                for i, text in enumerate(texts):
                    conf = float(scores[i]) if i < len(scores) else 0.0
                    bbox = None
                    if i < len(boxes):
                        try:
                            bbox = [[int(v) for v in b] for b in (boxes[i].tolist()
                                    if hasattr(boxes[i], "tolist") else boxes[i])]
                        except Exception:  # noqa: BLE001
                            bbox = None
                    lines.append({"text": str(text), "confidence": conf, "bbox": bbox})
        else:
            result = self._ocr.ocr(image_path, cls=True)
            if result and result[0]:
                for line in result[0]:
                    bbox, (text, conf) = line[0], line[1]
                    lines.append({
                        "text": str(text),
                        "confidence": float(conf),
                        "bbox": [[int(p[0]), int(p[1])] for p in bbox],
                    })
        return {
            "lines": lines,
            "raw_text": "\n".join(l["text"] for l in lines),
            "processing_time_ms": int((time.time() - start) * 1000),
            "engine": f"paddleocr-{self._api_version}",
        }

    def extract_fields(self, image_path: str,
                       document_type: DocumentType | str) -> dict:
        """Structured field extraction with per-field confidence."""
        raw = self.extract_text(image_path)
        doc_type = DocumentType(str(document_type)) if not isinstance(
            document_type, DocumentType) else document_type
        fields = _parse_fields(raw["raw_text"], doc_type)
        overall = (sum(f["confidence"] for f in fields) / len(fields)
                   if fields else 0.0)
        return {
            "document_type": doc_type.value,
            "fields": fields,
            "raw_text": raw["raw_text"],
            "overall_confidence": round(min(overall, 1.0), 4),
            "processing_time_ms": raw["processing_time_ms"],
            "language_detected": "en",
            "engine": raw["engine"],
        }


# ── Document-type-specific field parsers ──────────────────────────────────────

def _find(text: str, field_name: str, patterns: list[str],
          confidence: float = 0.85) -> Optional[OcrField]:
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if m:
            return OcrField(field_name, m.group(1).strip(), confidence)
    return None


def _parse_fields(raw_text: str, doc_type: DocumentType) -> list[OcrField]:
    parser = {
        DocumentType.NATIONAL_ID: _parse_national_id,
        DocumentType.NIN_SLIP: _parse_nin_slip,
        DocumentType.INTERNATIONAL_PASSPORT: _parse_passport,
        DocumentType.DRIVERS_LICENSE: _parse_drivers_license,
        DocumentType.VOTERS_CARD: _parse_voters_card,
        DocumentType.BVN_PRINTOUT: _parse_bvn,
        DocumentType.CAC_CERTIFICATE: _parse_cac_certificate,
        DocumentType.TAX_CLEARANCE: _parse_tax_clearance,
        DocumentType.UTILITY_BILL: _parse_utility_bill,
        DocumentType.BANK_STATEMENT: _parse_bank_statement,
        DocumentType.AUDITED_FINANCIALS: _parse_financials,
    }.get(doc_type, _parse_generic)
    return [f for f in parser(raw_text) if f is not None]


def _parse_nin_slip(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "nin", [r"(?:NIN)[:\s]*(\d{11})", r"\b(\d{11})\b"], 0.9),
        _find(t, "full_name", [r"(?:Name|Surname)[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "date_of_birth", [r"(?:Date\s*of\s*Birth|DOB)[:\s]*([\d/\-\.]+)"]),
        _find(t, "tracking_id", [r"(?:Tracking\s*ID)[:\s]*([A-Z0-9\-]+)"]),
        _find(t, "gender", [r"(?:Sex|Gender)[:\s]*(Male|Female|M|F)\b"]),
    ]


def _parse_national_id(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "full_name", [r"(?:name|surname|first\s*name)[:\s]*([A-Z][A-Za-z' \t\-]+)",
                               r"\b([A-Z]{2,} +[A-Z][a-z]+(?: +[A-Z][a-z]+)?)\b"]),
        _find(t, "nin", [r"(?:NIN|N\.?I\.?N\.?)[:\s]*(\d{11})", r"\b(\d{11})\b"], 0.9),
        _find(t, "date_of_birth", [r"(?:DOB|Date\s*of\s*Birth|Born)[:\s]*([\d/\-\.]+)",
                                   r"\b(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})\b"]),
        _find(t, "gender", [r"(?:Sex|Gender)[:\s]*(Male|Female|M|F)\b"]),
        _find(t, "expiry_date", [r"(?:Expiry|Expires|Valid\s*Until)[:\s]*([\d/\-\.]+)"]),
    ]


def _parse_passport(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "passport_number", [r"(?:Passport\s*No|Number)[:\s]*([A-Z]\d{8})",
                                     r"\b([A-Z]\d{8})\b"], 0.9),
        _find(t, "full_name", [r"(?:Surname|Name)[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "nationality", [r"(?:Nationality|Citizenship)[:\s]*([A-Za-z]+)"]),
        _find(t, "date_of_birth", [r"(?:Date\s*of\s*Birth|DOB)[:\s]*([\d/\-\.]+)"]),
        _find(t, "expiry_date", [r"(?:Date\s*of\s*Expiry|Expiry)[:\s]*([\d/\-\.]+)"]),
        _find(t, "mrz_line1", [r"(P<[A-Z]{3}[A-Z<]+)"], 0.9),
        _find(t, "mrz_line2", [r"\b([A-Z0-9<]{44})\b"], 0.9),
    ]


def _parse_drivers_license(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "license_number", [r"(?:License\s*No|Licence\s*No|DL\s*No)[:\s]*([A-Z0-9\-]+)"], 0.9),
        _find(t, "full_name", [r"(?:Name|Holder)[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "date_of_birth", [r"(?:DOB|Date\s*of\s*Birth)[:\s]*([\d/\-\.]+)"]),
        _find(t, "license_class", [r"(?:Class|Category)[:\s]*([A-E]+)\b"]),
        _find(t, "expiry_date", [r"(?:Expiry|Valid\s*Until)[:\s]*([\d/\-\.]+)"]),
    ]


def _parse_voters_card(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "vin", [r"(?:VIN|Voter\s*ID)[:\s]*(\d{19})", r"\b(\d{19})\b"], 0.9),
        _find(t, "full_name", [r"Name[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "state", [r"State[:\s]*([A-Za-z ]+)"]),
        _find(t, "lga", [r"(?:LGA|Local\s*Govt)[:\s]*([A-Za-z ]+)"]),
    ]


def _parse_bvn(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "bvn", [r"BVN[:\s]*(\d{11})", r"\b(\d{11})\b"], 0.9),
        _find(t, "full_name", [r"Name[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "bank", [r"Bank[:\s]*([A-Za-z ]+Bank)"]),
    ]


def _parse_cac_certificate(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "company_name", [r"(?:Company\s*Name|Name\s*of\s*Company)[:\s]*(.+?)(?:\n|$)"], 0.9),
        _find(t, "rc_number", [r"(?:RC|Registration\s*Number)\s*(?:No|Number)?[:\s]*(\d+)",
                               r"RC\s*(\d+)"], 0.9),
        _find(t, "date_of_incorporation",
              [r"(?:Date\s*of\s*Incorporation|Incorporated)[:\s]*([\d/\-\.]+)"]),
        _find(t, "registered_address", [r"(?:Registered\s*Office|Address)[:\s]*(.+?)(?:\n|$)"]),
    ]


def _parse_tax_clearance(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "tin", [r"(?:TIN|Tax\s*ID)[:\s]*(\d+[\-]?\d*)"], 0.9),
        _find(t, "company_name", [r"(?:Name\s*of\s*Tax\s*Payer|Company)[:\s]*(.+?)(?:\n|$)"]),
        _find(t, "assessment_year", [r"(?:Year|Assessment\s*Year)[:\s]*(\d{4})"]),
    ]


def _parse_utility_bill(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "account_holder", [r"(?:Name|Customer|Account\s*Holder)[:\s]*([A-Z][A-Za-z' \t\-]+)"]),
        _find(t, "address", [r"(?:Address|Location)[:\s]*(.+?)(?:\n|$)"]),
        _find(t, "bill_date", [r"(?:Date|Bill\s*Date|Period)[:\s]*([\d/\-\.]+)"]),
        _find(t, "account_number", [r"(?:Account\s*No|Meter\s*No)[:\s]*([A-Z0-9\-]+)"]),
    ]


def _parse_bank_statement(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "account_name", [r"(?:Account\s*Name|Name)[:\s]*(.+?)(?:\n|$)"]),
        _find(t, "account_number", [r"(?:Account\s*No|Account\s*Number)[:\s]*(\d{10})"], 0.9),
        _find(t, "bank_name", [r"([A-Za-z ]+Bank(?: +PLC)?)"]),
        _find(t, "statement_period", [r"(?:Period|Statement\s*Period)[:\s]*(.+?)(?:\n|$)"]),
    ]


def _parse_financials(t: str) -> list[Optional[OcrField]]:
    return [
        _find(t, "company_name", [r"(?:Audited\s*Financial|Company)[:\s]*(.+?)(?:\n|$)"]),
        _find(t, "financial_year", [r"(?:Year\s*Ended|Financial\s*Year)[:\s]*([\d/\-\.]+)"]),
        _find(t, "total_revenue", [r"(?:Total\s*Revenue|Turnover)[:\s]*([\d,\.]+)"]),
        _find(t, "net_profit", [r"(?:Net\s*Profit|Profit\s*After\s*Tax)[:\s]*([\d,\.]+)"]),
    ]


def _parse_generic(t: str) -> list[Optional[OcrField]]:
    lines = [l for l in t.splitlines() if l.strip()][:20]
    return [OcrField(f"line_{i}", line.strip(), 0.5) for i, line in enumerate(lines)]


_MODULE_ENGINE: Optional[PaddleOcrEngine] = None
_MODULE_LOCK = threading.Lock()


def get_ocr_engine() -> PaddleOcrEngine:
    """Process-wide lazy engine singleton."""
    global _MODULE_ENGINE
    with _MODULE_LOCK:
        if _MODULE_ENGINE is None:
            _MODULE_ENGINE = PaddleOcrEngine()
        return _MODULE_ENGINE
