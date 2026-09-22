"""docai — production document-AI pipeline for KYC/KYB.

Components (all honest-degradation, fail-closed):
  ocr       — PaddleOCR wrapper (CPU, English, lazy load; no fabricated data)
  structure — Docling wrapper (PDF/CAC structure → sections/tables JSON)
  vlm       — DocumentVerifier provider pattern (heuristic default, optional
              OpenAI-compatible HTTP VLM)
  liveness  — next-gen challenge-response protocol (server-issued random
              sequence, nonce, single-use, 60s TTL) + optional ONNX silent
              anti-spoofing + face-match hook
  api       — FastAPI router exposing the unified pipeline
"""

__all__ = ["ocr", "structure", "vlm", "liveness", "api"]
