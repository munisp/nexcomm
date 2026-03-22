"""
NEXCOM KYC Document Analysis Microservice
==========================================
Open-source document verification stack:
  - PaddleOCR  : text extraction from ID documents (NIN, BVN, passport, corporate reg)
  - VLM        : document authenticity analysis via Manus built-in LLM (image_url)
  - Docling     : structured parsing of PDF documents
  - Passive     : heuristic liveness checks (blur, colour, resolution, FFT moire)

Runs on port 8765 as a sidecar to the main Express server.
"""

import os
import io
import re
import json
import base64
import logging
import tempfile
from typing import Optional

import aiohttp
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kyc-service")

# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="NEXCOM KYC Analysis Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ─── Lazy-loaded models ───────────────────────────────────────────────────────

_ocr = None
_docling_converter = None


def get_ocr():
    global _ocr
    if _ocr is None:
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        log.info("PaddleOCR initialised")
    return _ocr


def get_docling():
    global _docling_converter
    if _docling_converter is None:
        from docling.document_converter import DocumentConverter
        _docling_converter = DocumentConverter()
        log.info("Docling DocumentConverter initialised")
    return _docling_converter


# ─── Manus built-in VLM helper ───────────────────────────────────────────────

FORGE_API_URL = os.environ.get("BUILT_IN_FORGE_API_URL", "")
FORGE_API_KEY = os.environ.get("BUILT_IN_FORGE_API_KEY", "")


async def call_vlm(image_b64: str, prompt: str) -> str:
    """Call the Manus built-in VLM with a base64-encoded image."""
    if not FORGE_API_URL or not FORGE_API_KEY:
        return json.dumps({"error": "VLM not configured - missing FORGE env vars"})

    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ]
    }

    headers = {
        "Authorization": f"Bearer {FORGE_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{FORGE_API_URL}/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                return data["choices"][0]["message"]["content"]
    except Exception as e:
        log.warning(f"VLM call failed: {e}")
        return json.dumps({"error": str(e)})


# ─── Image download helper ────────────────────────────────────────────────────

async def download_image(url: str) -> bytes:
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to download image: HTTP {resp.status}"
                )
            return await resp.read()


def bytes_to_pil(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def pil_to_b64(img: Image.Image, max_size: int = 1024) -> str:
    img = img.copy()
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# ─── Passive liveness heuristics ─────────────────────────────────────────────

def passive_liveness_check(img: Image.Image) -> dict:
    """
    Passive liveness heuristics without requiring a downloaded ML model.
    Checks:
      1. Resolution — very low res suggests a printed photo scan
      2. Colour variance — near-greyscale suggests a B&W printout
      3. Blur (Laplacian variance) — blurry suggests a screen capture
      4. Aspect ratio — extreme ratio suggests a cropped document photo
      5. FFT moire pattern — periodic grid pattern suggests screen capture
    Returns a score 0.0–1.0 (1.0 = likely live) and a list of flags.
    """
    import cv2

    flags = []
    score = 1.0

    w, h = img.size
    arr = np.array(img)

    # 1. Resolution
    if w < 200 or h < 200:
        flags.append("LOW_RESOLUTION")
        score -= 0.3

    # 2. Colour variance
    r = arr[:, :, 0].astype(float)
    g = arr[:, :, 1].astype(float)
    b = arr[:, :, 2].astype(float)
    colour_variance = float(np.std(r - g) + np.std(g - b))
    if colour_variance < 5.0:
        flags.append("GREYSCALE_IMAGE")
        score -= 0.2

    # 3. Blur detection
    grey = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    laplacian_var = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    if laplacian_var < 50:
        flags.append("BLURRY_IMAGE")
        score -= 0.25

    # 4. Aspect ratio
    ratio = w / h if h > 0 else 1.0
    if ratio < 0.4 or ratio > 2.5:
        flags.append("UNUSUAL_ASPECT_RATIO")
        score -= 0.1

    # 5. FFT moire pattern
    fft = np.fft.fft2(grey)
    fft_shift = np.fft.fftshift(fft)
    magnitude = np.log(np.abs(fft_shift) + 1)
    cy, cx = magnitude.shape[0] // 2, magnitude.shape[1] // 2
    ring = magnitude[cy - 20:cy + 20, cx - 20:cx + 20]
    if ring.max() > 12:
        flags.append("POSSIBLE_SCREEN_CAPTURE")
        score -= 0.15

    return {
        "liveness_score": round(max(0.0, min(1.0, score)), 3),
        "flags": flags,
        "resolution": f"{w}x{h}",
        "colour_variance": round(colour_variance, 2),
        "blur_score": round(laplacian_var, 2),
    }


# ─── PaddleOCR text extraction ────────────────────────────────────────────────

def extract_text_paddleocr(img_bytes: bytes) -> dict:
    """Run PaddleOCR on an image and return extracted text lines and key fields."""
    import cv2

    ocr = get_ocr()
    arr = np.frombuffer(img_bytes, np.uint8)
    img_cv = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_cv is None:
        return {"error": "Could not decode image", "lines": [], "full_text": "", "extracted_fields": {}}

    result = ocr.ocr(img_cv, cls=True)

    lines = []
    full_text = ""
    if result and result[0]:
        for line in result[0]:
            if line and len(line) >= 2:
                text = line[1][0]
                confidence = float(line[1][1])
                lines.append({"text": text, "confidence": round(confidence, 3)})
                full_text += text + " "

    # Extract key fields via regex
    fields = {}

    nin_match = re.search(r'\b(\d{11})\b', full_text)
    if nin_match:
        fields["nin"] = nin_match.group(1)

    bvn_match = re.search(r'BVN[:\s]*(\d{11})', full_text, re.IGNORECASE)
    if bvn_match:
        fields["bvn"] = bvn_match.group(1)

    dob_match = re.search(r'\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b', full_text)
    if dob_match:
        fields["date_of_birth"] = dob_match.group(1)

    for line in lines:
        t = line["text"].strip()
        if len(t) > 5 and t.replace(" ", "").isupper() and not any(c.isdigit() for c in t):
            if "name" not in fields:
                fields["name"] = t

    doc_num_match = re.search(r'\b[A-Z]{1,3}[\s-]?\d{6,10}\b', full_text)
    if doc_num_match:
        fields["document_number"] = doc_num_match.group()

    expiry_match = re.search(
        r'(?:expir|valid until|expires)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
        full_text, re.IGNORECASE
    )
    if expiry_match:
        fields["expiry_date"] = expiry_match.group(1)

    avg_conf = round(sum(l["confidence"] for l in lines) / len(lines), 3) if lines else 0.0

    return {
        "lines": lines,
        "full_text": full_text.strip(),
        "extracted_fields": fields,
        "line_count": len(lines),
        "avg_confidence": avg_conf,
    }


# ─── VLM prompts ─────────────────────────────────────────────────────────────

DOCUMENT_AUTHENTICITY_PROMPT = """Analyse this identity document image for authenticity.
Respond ONLY with a JSON object (no markdown, no explanation) with these exact fields:
{
  "authenticity_score": <float 0.0-1.0, where 1.0 = highly authentic>,
  "document_type": "<NIN_SLIP|BVN_CARD|PASSPORT|DRIVERS_LICENSE|CORPORATE_REG|UNKNOWN>",
  "has_security_features": <true|false>,
  "has_official_seal": <true|false>,
  "photo_tampering_detected": <false|true>,
  "font_consistency": "<CONSISTENT|INCONSISTENT|UNKNOWN>",
  "layout_quality": "<GOOD|POOR|UNKNOWN>",
  "risk_flags": [<list of string flags, empty if none>],
  "summary": "<one sentence assessment>"
}
Risk flags to check: DIGITAL_MANIPULATION, INCONSISTENT_FONTS, MISSING_SECURITY_FEATURES, POOR_PRINT_QUALITY, SUSPICIOUS_LAYOUT, PHOTO_REPLACED, EXPIRED_DOCUMENT, UNRECOGNISED_FORMAT"""

SELFIE_LIVENESS_PROMPT = """Analyse this selfie image for liveness and authenticity in a KYC context.
Respond ONLY with a JSON object (no markdown, no explanation) with these exact fields:
{
  "face_detected": <true|false>,
  "face_count": <integer>,
  "liveness_assessment": "<LIKELY_LIVE|POSSIBLY_PRINTED|POSSIBLY_SCREEN|UNKNOWN>",
  "lighting_quality": "<GOOD|POOR|UNKNOWN>",
  "face_clearly_visible": <true|false>,
  "obstructions_detected": <false|true>,
  "obstructions": [<list: SUNGLASSES|MASK|HAT|HEAVY_SHADOW>],
  "deepfake_indicators": <false|true>,
  "deepfake_flags": [<list of string flags if any>],
  "overall_score": <float 0.0-1.0, where 1.0 = clearly live and unobstructed>,
  "summary": "<one sentence assessment>"
}"""


# ─── Docling PDF analysis ─────────────────────────────────────────────────────

def analyse_pdf_docling(pdf_bytes: bytes) -> dict:
    """Use Docling to parse a PDF document and extract structured content."""
    converter = get_docling()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name

    try:
        result = converter.convert(tmp_path)
        doc = result.document
        full_text = doc.export_to_markdown()

        tables = []
        for table in doc.tables:
            try:
                df = table.export_to_dataframe()
                tables.append(df.to_dict(orient="records"))
            except Exception:
                pass

        page_count = len(doc.pages) if hasattr(doc, "pages") else 1

        return {
            "page_count": page_count,
            "full_text": full_text[:3000],
            "table_count": len(tables),
            "tables": tables[:3],
            "word_count": len(full_text.split()),
        }
    except Exception as e:
        log.warning(f"Docling PDF analysis failed: {e}")
        return {"error": str(e), "page_count": 0, "full_text": "", "table_count": 0}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ─── Request / Response models ────────────────────────────────────────────────

class AnalyseDocumentRequest(BaseModel):
    document_url: str
    selfie_url: Optional[str] = None
    document_type_hint: Optional[str] = None
    is_pdf: bool = False


class AnalyseDocumentResponse(BaseModel):
    success: bool
    ocr: dict = {}
    document_analysis: dict = {}
    selfie_analysis: dict = {}
    passive_liveness: dict = {}
    docling_analysis: dict = {}
    overall_risk_level: str = "UNKNOWN"
    overall_score: float = 0.0
    risk_flags: list = []
    recommendation: str = ""


# ─── Main analysis endpoint ───────────────────────────────────────────────────

@app.post("/analyse", response_model=AnalyseDocumentResponse)
async def analyse_document(req: AnalyseDocumentRequest):
    """
    Full KYC document analysis pipeline:
    1. Download document image/PDF
    2. PaddleOCR text extraction
    3. VLM document authenticity analysis
    4. VLM selfie liveness analysis (if selfie_url provided)
    5. Passive liveness heuristics on selfie
    6. Docling PDF parsing (if is_pdf=True)
    7. Aggregate risk score and recommendation
    """
    log.info(f"Analysing document: {req.document_url[:60]}...")
    result = AnalyseDocumentResponse(success=False)
    risk_flags = []

    # 1. Download document
    try:
        doc_bytes = await download_image(req.document_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download document: {e}")

    # 2. OCR (skip for PDFs)
    if not req.is_pdf:
        try:
            result.ocr = extract_text_paddleocr(doc_bytes)
            if result.ocr.get("avg_confidence", 1.0) < 0.5:
                risk_flags.append("LOW_OCR_CONFIDENCE")
        except Exception as e:
            log.warning(f"OCR failed: {e}")
            result.ocr = {"error": str(e)}

    # 3. VLM document authenticity
    try:
        doc_img = bytes_to_pil(doc_bytes)
        doc_b64 = pil_to_b64(doc_img)
        vlm_response = await call_vlm(doc_b64, DOCUMENT_AUTHENTICITY_PROMPT)
        try:
            result.document_analysis = json.loads(vlm_response)
        except json.JSONDecodeError:
            result.document_analysis = {"raw_response": vlm_response, "parse_error": True}

        if isinstance(result.document_analysis, dict):
            risk_flags.extend(result.document_analysis.get("risk_flags", []))
            if result.document_analysis.get("photo_tampering_detected"):
                risk_flags.append("PHOTO_TAMPERING_DETECTED")
    except Exception as e:
        log.warning(f"VLM document analysis failed: {e}")
        result.document_analysis = {"error": str(e)}

    # 4 & 5. Selfie liveness
    if req.selfie_url:
        try:
            selfie_bytes = await download_image(req.selfie_url)
            selfie_img = bytes_to_pil(selfie_bytes)
            selfie_b64 = pil_to_b64(selfie_img)

            vlm_selfie = await call_vlm(selfie_b64, SELFIE_LIVENESS_PROMPT)
            try:
                result.selfie_analysis = json.loads(vlm_selfie)
            except json.JSONDecodeError:
                result.selfie_analysis = {"raw_response": vlm_selfie, "parse_error": True}

            if isinstance(result.selfie_analysis, dict):
                if result.selfie_analysis.get("deepfake_indicators"):
                    risk_flags.append("DEEPFAKE_INDICATORS_DETECTED")
                la = result.selfie_analysis.get("liveness_assessment", "")
                if la in ["POSSIBLY_PRINTED", "POSSIBLY_SCREEN"]:
                    risk_flags.append(f"LIVENESS_{la}")
                if not result.selfie_analysis.get("face_detected", True):
                    risk_flags.append("NO_FACE_DETECTED")

            result.passive_liveness = passive_liveness_check(selfie_img)
            risk_flags.extend(result.passive_liveness.get("flags", []))

        except Exception as e:
            log.warning(f"Selfie analysis failed: {e}")
            result.selfie_analysis = {"error": str(e)}

    # 6. Docling PDF
    if req.is_pdf:
        try:
            result.docling_analysis = analyse_pdf_docling(doc_bytes)
            if result.docling_analysis.get("word_count", 0) < 10:
                risk_flags.append("PDF_MINIMAL_CONTENT")
        except Exception as e:
            log.warning(f"Docling failed: {e}")
            result.docling_analysis = {"error": str(e)}

    # 7. Aggregate risk score
    scores = []
    doc_score = result.document_analysis.get("authenticity_score") if isinstance(result.document_analysis, dict) else None
    if isinstance(doc_score, (int, float)):
        scores.append(float(doc_score))

    selfie_score = result.selfie_analysis.get("overall_score") if isinstance(result.selfie_analysis, dict) else None
    if isinstance(selfie_score, (int, float)):
        scores.append(float(selfie_score))

    passive_score = result.passive_liveness.get("liveness_score")
    if isinstance(passive_score, (int, float)):
        scores.append(float(passive_score))

    ocr_conf = result.ocr.get("avg_confidence")
    if isinstance(ocr_conf, (int, float)):
        scores.append(float(ocr_conf))

    overall_score = sum(scores) / len(scores) if scores else 0.5
    result.overall_score = round(overall_score, 3)

    unique_flags = list(set(risk_flags))
    result.risk_flags = unique_flags

    CRITICAL_FLAGS = {"DEEPFAKE_INDICATORS_DETECTED", "PHOTO_TAMPERING_DETECTED", "DIGITAL_MANIPULATION", "PHOTO_REPLACED"}
    HIGH_FLAGS = {"LIVENESS_POSSIBLY_PRINTED", "LIVENESS_POSSIBLY_SCREEN", "INCONSISTENT_FONTS", "MISSING_SECURITY_FEATURES"}

    if any(f in CRITICAL_FLAGS for f in unique_flags) or overall_score < 0.3:
        result.overall_risk_level = "CRITICAL"
        result.recommendation = "REJECT — Document shows strong indicators of forgery or deepfake manipulation. Manual review required."
    elif any(f in HIGH_FLAGS for f in unique_flags) or overall_score < 0.5:
        result.overall_risk_level = "HIGH"
        result.recommendation = "HOLD — Document has suspicious characteristics. Escalate to senior KYC reviewer."
    elif len(unique_flags) > 2 or overall_score < 0.7:
        result.overall_risk_level = "MEDIUM"
        result.recommendation = "REVIEW — Some anomalies detected. Standard manual review recommended."
    else:
        result.overall_risk_level = "LOW"
        result.recommendation = "PASS — Document appears authentic. Standard KYC approval process can proceed."

    result.success = True
    log.info(f"Done: risk={result.overall_risk_level}, score={result.overall_score}, flags={unique_flags}")
    return result


# ─── Health & capabilities ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexcom-kyc-analysis", "version": "1.0.0"}


@app.get("/capabilities")
async def capabilities():
    vlm_available = bool(FORGE_API_URL and FORGE_API_KEY)
    return {
        "paddleocr": True,
        "vlm_document_analysis": vlm_available,
        "vlm_selfie_liveness": vlm_available,
        "passive_liveness_heuristics": True,
        "docling_pdf_parsing": True,
    }


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("KYC_SERVICE_PORT", "8765"))
    log.info(f"Starting KYC analysis service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
