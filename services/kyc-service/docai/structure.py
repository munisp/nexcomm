"""docai.structure — Docling wrapper for PDF/CAC document parsing.

Converts PDFs (and office docs) into structured JSON: sections (heading
hierarchy with text) and tables (row/col grids) — essential for CAC
certificates, shareholder registers and audited financials where layout
carries meaning OCR alone loses.

Honest degradation: when docling is not installed, `parse` raises
StructureUnavailable and `capability()` reports available=False. Callers
surface the marker; nothing is fabricated.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

logger = logging.getLogger("docai.structure")


class StructureUnavailable(RuntimeError):
    """Docling is not installed/usable in this environment."""


class DoclingStructureParser:
    """Lazy-loading Docling DocumentConverter wrapper."""

    def __init__(self) -> None:
        self._converter: Any = None
        self._init_attempted = False
        self._init_error: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        self._ensure_init()
        return self._converter is not None

    def capability(self) -> dict:
        self._ensure_init()
        return {
            "engine": "docling",
            "available": self._converter is not None,
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
                from docling.document_converter import DocumentConverter

                self._converter = DocumentConverter()
                logger.info("Docling DocumentConverter initialised")
            except Exception as exc:  # noqa: BLE001
                self._converter = None
                self._init_error = f"{type(exc).__name__}: {exc}"
                logger.warning("Docling unavailable: %s", self._init_error)

    def parse(self, path: str) -> dict:
        """Parse a document into structured JSON.

        Returns {available: True, parser, sections, tables, text,
        page_count, processing_time_ms}. Raises StructureUnavailable when
        docling is absent — callers catch and emit an honest marker.
        """
        self._ensure_init()
        if self._converter is None:
            raise StructureUnavailable(
                f"docling is not available ({self._init_error or 'not installed'})"
            )
        start = time.time()
        result = self._converter.convert(path)
        doc = result.document

        sections: list[dict] = []
        tables: list[dict] = []
        text_parts: list[str] = []
        page_count = 0

        # Iterate the document tree in reading order; classify items.
        try:
            for item, _level in doc.iterate_items():
                label = str(getattr(item, "label", "") or "").lower()
                text = getattr(item, "text", None)
                if text:
                    text_parts.append(text)
                    if any(k in label for k in ("title", "section_header", "heading")):
                        sections.append({"heading": text.strip(), "level": _level})
                # Tables expose an export_to_dataframe() API
                if "table" in label and hasattr(item, "export_to_dataframe"):
                    try:
                        df = item.export_to_dataframe()
                        tables.append({
                            "num_rows": int(df.shape[0]),
                            "num_cols": int(df.shape[1]),
                            "header": [str(c) for c in df.columns],
                            "rows": [
                                ["" if v is None else str(v) for v in row]
                                for row in df.head(200).values.tolist()
                            ],
                        })
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("table export failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("docling tree iteration failed, falling back to export: %s", exc)

        if not text_parts:
            try:
                md = doc.export_to_markdown()
                text_parts = [md] if md else []
            except Exception:  # noqa: BLE001
                pass
        try:
            page_count = len(getattr(doc, "pages", {}) or {})
        except Exception:  # noqa: BLE001
            page_count = 0

        return {
            "available": True,
            "parser": "docling",
            "sections": sections,
            "tables": tables,
            "text": "\n".join(text_parts),
            "page_count": page_count,
            "processing_time_ms": int((time.time() - start) * 1000),
        }


_MODULE_PARSER: Optional[DoclingStructureParser] = None
_MODULE_LOCK = threading.Lock()


def get_structure_parser() -> DoclingStructureParser:
    """Process-wide lazy parser singleton."""
    global _MODULE_PARSER
    with _MODULE_LOCK:
        if _MODULE_PARSER is None:
            _MODULE_PARSER = DoclingStructureParser()
        return _MODULE_PARSER
