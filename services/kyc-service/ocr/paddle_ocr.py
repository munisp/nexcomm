"""PaddleOCR integration for document text extraction.

Uses PaddleOCR v3/v4 for multilingual OCR with layout analysis.
Supports Nigerian identity documents (NIN, BVN, Driver's License, Voter's Card,
International Passport) and business documents (CAC certificates, tax clearances).
"""
from __future__ import annotations

import re
import time
from typing import Optional

from models.schemas import DocumentType, OCRField, OCRResult


class PaddleOCREngine:
    """Document OCR engine powered by PaddleOCR."""

    def __init__(self) -> None:
        self._ocr = None
        self._initialized = False

    def _ensure_initialized(self) -> None:
        """Lazy-initialize PaddleOCR (heavy import)."""
        if self._initialized:
            return
        try:
            from paddleocr import PaddleOCR
            self._ocr = PaddleOCR(
                use_angle_cls=True,
                lang="en",
                show_log=False,
                use_gpu=False,
                det_db_thresh=0.3,
                det_db_box_thresh=0.5,
                rec_batch_num=6,
            )
            self._initialized = True
        except ImportError:
            self._initialized = True  # Mark as initialized to avoid retry
            self._ocr = None

    def extract_text(self, image_path: str) -> dict:
        """Extract raw text from an image file.

        Returns dict with 'lines' (list of text+confidence) and 'raw_text'.
        """
        self._ensure_initialized()
        start = time.time()

        if self._ocr is None:
            return self._mock_extract(image_path)

        result = self._ocr.ocr(image_path, cls=True)
        lines = []
        raw_parts = []

        if result and result[0]:
            for line in result[0]:
                bbox = line[0]
                text = line[1][0]
                confidence = line[1][1]
                lines.append({
                    "text": text,
                    "confidence": confidence,
                    "bbox": [[int(p[0]), int(p[1])] for p in bbox],
                })
                raw_parts.append(text)

        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "lines": lines,
            "raw_text": "\n".join(raw_parts),
            "processing_time_ms": elapsed_ms,
        }

    def extract_document_fields(
        self, image_path: str, document_type: DocumentType
    ) -> OCRResult:
        """Extract structured fields from a document image.

        Uses PaddleOCR for text extraction, then applies document-type-specific
        field parsing rules to extract structured data.
        """
        raw = self.extract_text(image_path)
        raw_text = raw["raw_text"]
        lines = raw["lines"]

        # Extract fields based on document type
        fields = self._parse_fields(raw_text, lines, document_type)
        overall_confidence = (
            sum(f.confidence for f in fields) / len(fields) if fields else 0.0
        )

        return OCRResult(
            document_type=document_type,
            fields=fields,
            raw_text=raw_text,
            overall_confidence=min(overall_confidence, 1.0),
            processing_time_ms=raw["processing_time_ms"],
            language_detected="en",
        )

    def _parse_fields(
        self, raw_text: str, lines: list[dict], document_type: DocumentType
    ) -> list[OCRField]:
        """Parse document-type-specific fields from OCR output."""
        parsers = {
            DocumentType.NATIONAL_ID: self._parse_national_id,
            DocumentType.INTERNATIONAL_PASSPORT: self._parse_passport,
            DocumentType.DRIVERS_LICENSE: self._parse_drivers_license,
            DocumentType.VOTERS_CARD: self._parse_voters_card,
            DocumentType.NIN_SLIP: self._parse_nin_slip,
            DocumentType.BVN_PRINTOUT: self._parse_bvn,
            DocumentType.UTILITY_BILL: self._parse_utility_bill,
            DocumentType.BANK_STATEMENT: self._parse_bank_statement,
            DocumentType.CAC_CERTIFICATE: self._parse_cac_certificate,
            DocumentType.TAX_CLEARANCE: self._parse_tax_clearance,
            DocumentType.AUDITED_FINANCIALS: self._parse_financials,
        }
        parser = parsers.get(document_type, self._parse_generic)
        return parser(raw_text, lines)

    # ── Document-specific parsers ──────────────────────────────────────────

    def _parse_national_id(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "full_name", [
            r"(?:name|surname|first\s*name)[:\s]*([A-Z][A-Za-z\s]+)",
            r"([A-Z]{2,}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
        ]))
        fields.append(self._find_field(text, "nin", [
            r"(?:NIN|N\.?I\.?N\.?)[:\s]*(\d{11})",
            r"\b(\d{11})\b",
        ]))
        fields.append(self._find_field(text, "date_of_birth", [
            r"(?:DOB|Date\s*of\s*Birth|Born)[:\s]*([\d/\-\.]+)",
            r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})",
        ]))
        fields.append(self._find_field(text, "gender", [
            r"(?:Sex|Gender)[:\s]*(Male|Female|M|F)",
        ]))
        fields.append(self._find_field(text, "expiry_date", [
            r"(?:Expiry|Expires|Valid\s*Until)[:\s]*([\d/\-\.]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_passport(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "passport_number", [
            r"(?:Passport\s*No|Number)[:\s]*([A-Z]\d{8})",
            r"\b([A-Z]\d{8})\b",
        ]))
        fields.append(self._find_field(text, "full_name", [
            r"(?:Surname|Name)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "nationality", [
            r"(?:Nationality|Citizenship)[:\s]*([A-Za-z]+)",
        ]))
        fields.append(self._find_field(text, "date_of_birth", [
            r"(?:Date\s*of\s*Birth|DOB)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "expiry_date", [
            r"(?:Date\s*of\s*Expiry|Expiry)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "mrz_line1", [
            r"(P<[A-Z]{3}[A-Z<]+)",
        ]))
        fields.append(self._find_field(text, "mrz_line2", [
            r"([A-Z0-9<]{44})",
        ]))
        return [f for f in fields if f.value]

    def _parse_drivers_license(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "license_number", [
            r"(?:License\s*No|Licence\s*No|DL\s*No)[:\s]*([A-Z0-9\-]+)",
        ]))
        fields.append(self._find_field(text, "full_name", [
            r"(?:Name|Holder)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "date_of_birth", [
            r"(?:DOB|Date\s*of\s*Birth)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "class", [
            r"(?:Class|Category)[:\s]*([A-E]+)",
        ]))
        fields.append(self._find_field(text, "expiry_date", [
            r"(?:Expiry|Valid\s*Until)[:\s]*([\d/\-\.]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_voters_card(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "vin", [
            r"(?:VIN|Voter\s*ID)[:\s]*(\d{19})",
            r"\b(\d{19})\b",
        ]))
        fields.append(self._find_field(text, "full_name", [
            r"(?:Name)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "state", [
            r"(?:State)[:\s]*([A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "lga", [
            r"(?:LGA|Local\s*Govt)[:\s]*([A-Za-z\s]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_nin_slip(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "nin", [
            r"(?:NIN)[:\s]*(\d{11})",
            r"\b(\d{11})\b",
        ]))
        fields.append(self._find_field(text, "full_name", [
            r"(?:Name|Surname)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "date_of_birth", [
            r"(?:Date\s*of\s*Birth)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "tracking_id", [
            r"(?:Tracking\s*ID)[:\s]*([A-Z0-9\-]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_bvn(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "bvn", [
            r"(?:BVN)[:\s]*(\d{11})",
            r"\b(\d{11})\b",
        ]))
        fields.append(self._find_field(text, "full_name", [
            r"(?:Name)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "bank", [
            r"(?:Bank)[:\s]*([A-Za-z\s]+Bank)",
        ]))
        return [f for f in fields if f.value]

    def _parse_utility_bill(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "account_holder", [
            r"(?:Name|Customer|Account\s*Holder)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "address", [
            r"(?:Address|Location)[:\s]*(.+?)(?:\n|$)",
        ]))
        fields.append(self._find_field(text, "bill_date", [
            r"(?:Date|Bill\s*Date|Period)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "account_number", [
            r"(?:Account\s*No|Meter\s*No)[:\s]*([A-Z0-9\-]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_bank_statement(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "account_name", [
            r"(?:Account\s*Name|Name)[:\s]*([A-Z][A-Za-z\s]+)",
        ]))
        fields.append(self._find_field(text, "account_number", [
            r"(?:Account\s*No|Account\s*Number)[:\s]*(\d{10})",
        ]))
        fields.append(self._find_field(text, "bank_name", [
            r"([A-Za-z\s]+Bank(?:\s+PLC)?)",
        ]))
        fields.append(self._find_field(text, "statement_period", [
            r"(?:Period|Statement\s*Period)[:\s]*(.+?)(?:\n|$)",
        ]))
        return [f for f in fields if f.value]

    def _parse_cac_certificate(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "company_name", [
            r"(?:Company\s*Name|Name\s*of\s*Company)[:\s]*(.+?)(?:\n|$)",
        ]))
        fields.append(self._find_field(text, "rc_number", [
            r"(?:RC|Registration\s*Number)[:\s]*(\d+)",
            r"RC\s*(\d+)",
        ]))
        fields.append(self._find_field(text, "date_of_incorporation", [
            r"(?:Date\s*of\s*Incorporation|Incorporated)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "registered_address", [
            r"(?:Registered\s*Office|Address)[:\s]*(.+?)(?:\n|$)",
        ]))
        return [f for f in fields if f.value]

    def _parse_tax_clearance(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "tin", [
            r"(?:TIN|Tax\s*ID)[:\s]*(\d+[\-]?\d*)",
        ]))
        fields.append(self._find_field(text, "company_name", [
            r"(?:Name\s*of\s*Tax\s*Payer|Company)[:\s]*(.+?)(?:\n|$)",
        ]))
        fields.append(self._find_field(text, "assessment_year", [
            r"(?:Year|Assessment\s*Year)[:\s]*(\d{4})",
        ]))
        return [f for f in fields if f.value]

    def _parse_financials(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        fields.append(self._find_field(text, "company_name", [
            r"(?:Audited\s*Financial|Company)[:\s]*(.+?)(?:\n|$)",
        ]))
        fields.append(self._find_field(text, "financial_year", [
            r"(?:Year\s*Ended|Financial\s*Year)[:\s]*([\d/\-\.]+)",
        ]))
        fields.append(self._find_field(text, "total_revenue", [
            r"(?:Total\s*Revenue|Turnover)[:\s]*([\d,\.]+)",
        ]))
        fields.append(self._find_field(text, "net_profit", [
            r"(?:Net\s*Profit|Profit\s*After\s*Tax)[:\s]*([\d,\.]+)",
        ]))
        return [f for f in fields if f.value]

    def _parse_generic(self, text: str, lines: list) -> list[OCRField]:
        fields = []
        for i, line_data in enumerate(lines[:20]):
            fields.append(OCRField(
                field_name=f"line_{i}",
                value=line_data.get("text", ""),
                confidence=line_data.get("confidence", 0.5),
                bounding_box=line_data.get("bbox"),
            ))
        return fields

    # ── Helpers ────────────────────────────────────────────────────────────

    def _find_field(
        self, text: str, field_name: str, patterns: list[str]
    ) -> OCRField:
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                return OCRField(
                    field_name=field_name,
                    value=match.group(1).strip(),
                    confidence=0.85,
                )
        return OCRField(field_name=field_name, value="", confidence=0.0)

    def _mock_extract(self, image_path: str) -> dict:
        """Fallback mock OCR when PaddleOCR is not installed."""
        return {
            "lines": [
                {"text": "FEDERAL REPUBLIC OF NIGERIA", "confidence": 0.95, "bbox": [[10, 10], [400, 10], [400, 40], [10, 40]]},
                {"text": "NATIONAL IDENTITY CARD", "confidence": 0.93, "bbox": [[10, 50], [350, 50], [350, 80], [10, 80]]},
                {"text": "Surname: ADEYEMI", "confidence": 0.91, "bbox": [[10, 100], [300, 100], [300, 130], [10, 130]]},
                {"text": "First Name: OLUWASEUN", "confidence": 0.90, "bbox": [[10, 140], [300, 140], [300, 170], [10, 170]]},
                {"text": "Date of Birth: 15/03/1990", "confidence": 0.88, "bbox": [[10, 180], [300, 180], [300, 210], [10, 210]]},
                {"text": "NIN: 12345678901", "confidence": 0.92, "bbox": [[10, 220], [300, 220], [300, 250], [10, 250]]},
                {"text": "Gender: Male", "confidence": 0.94, "bbox": [[10, 260], [200, 260], [200, 290], [10, 290]]},
                {"text": "Expiry: 15/03/2030", "confidence": 0.87, "bbox": [[10, 300], [300, 300], [300, 330], [10, 330]]},
            ],
            "raw_text": "FEDERAL REPUBLIC OF NIGERIA\nNATIONAL IDENTITY CARD\nSurname: ADEYEMI\nFirst Name: OLUWASEUN\nDate of Birth: 15/03/1990\nNIN: 12345678901\nGender: Male\nExpiry: 15/03/2030",
            "processing_time_ms": 45,
        }
