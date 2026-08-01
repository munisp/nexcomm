"""
Temporal workflow client for the NEXCOM Analytics service.
Uses the temporalio Python SDK when available.
Falls back to the Journey Orchestrator HTTP API for workflow management.
"""
import logging
import os
import uuid
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

TEMPORAL_HOST = os.getenv("TEMPORAL_ADDRESS", "temporal:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "nexcom")
JOURNEY_API_URL = os.getenv("JOURNEY_ORCHESTRATOR_URL", "http://journey-orchestrator-api:8015")


class TemporalClient:
    def __init__(self, host: str = TEMPORAL_HOST):
        self.host = host
        self.namespace = TEMPORAL_NAMESPACE
        self._client = None
        self._connected = False
        self._use_http_api = False

    async def _ensure_connected(self) -> None:
        if self._connected:
            return
        # Try temporalio Python SDK first
        try:
            from temporalio.client import Client  # type: ignore
            self._client = await Client.connect(self.host, namespace=self.namespace)
            self._connected = True
            logger.info("[Temporal] Connected via SDK to %s (namespace=%s)", self.host, self.namespace)
            return
        except ImportError:
            logger.warning("[Temporal] temporalio SDK not installed — using HTTP API fallback")
        except Exception as exc:
            logger.warning("[Temporal] SDK connection failed (%s) — using HTTP API fallback", exc)
        # Fallback: use the Journey Orchestrator HTTP API
        try:
            resp = requests.get(f"{JOURNEY_API_URL}/health", timeout=3)
            if resp.status_code == 200:
                self._use_http_api = True
                self._connected = True
                logger.info("[Temporal] Connected via Journey Orchestrator HTTP API at %s", JOURNEY_API_URL)
                return
        except Exception as exc:
            logger.warning("[Temporal] Journey API also unavailable: %s", exc)
        logger.warning("[Temporal] Running in disconnected mode — workflows will be logged only")

    async def start_workflow(
        self,
        workflow_type: str,
        input_data: Any,
        task_queue: str = "nexcom-analytics",
        workflow_id: Optional[str] = None,
    ) -> dict:
        """Start a Temporal workflow."""
        await self._ensure_connected()
        wf_id = workflow_id or f"{workflow_type}-{uuid.uuid4().hex[:8]}"

        if self._client is not None:
            try:
                handle = await self._client.start_workflow(
                    workflow_type,
                    input_data,
                    id=wf_id,
                    task_queue=task_queue,
                )
                logger.info("[Temporal] Started workflow %s (run=%s)", wf_id, handle.result_run_id)
                return {"workflowId": wf_id, "runId": handle.result_run_id, "status": "RUNNING"}
            except Exception as exc:
                logger.error("[Temporal] SDK start_workflow failed: %s", exc)

        if self._use_http_api:
            try:
                resp = requests.post(
                    f"{JOURNEY_API_URL}/journeys/{workflow_type}/start",
                    json={"workflow_id": wf_id, **(input_data if isinstance(input_data, dict) else {"data": input_data})},
                    timeout=10,
                )
                if resp.status_code in (200, 202):
                    data = resp.json()
                    return {"workflowId": data.get("workflow_id", wf_id), "runId": data.get("run_id", ""), "status": "RUNNING"}
            except Exception as exc:
                logger.error("[Temporal] HTTP API start_workflow failed: %s", exc)

        run_id = uuid.uuid4().hex
        logger.info("[Temporal] Workflow logged (disconnected): type=%s id=%s", workflow_type, wf_id)
        return {"workflowId": wf_id, "runId": run_id, "status": "QUEUED_OFFLINE"}

    async def query_workflow(self, workflow_id: str, query_type: str) -> Any:
        """Query a running workflow."""
        await self._ensure_connected()
        if self._client is not None:
            try:
                handle = self._client.get_workflow_handle(workflow_id)
                return await handle.query(query_type)
            except Exception as exc:
                logger.error("[Temporal] query_workflow failed: %s", exc)
        if self._use_http_api:
            try:
                resp = requests.get(f"{JOURNEY_API_URL}/journeys/{workflow_id}/status", timeout=5)
                if resp.status_code == 200:
                    return resp.json()
            except Exception as exc:
                logger.error("[Temporal] HTTP query failed: %s", exc)
        return {"status": "UNKNOWN"}

    async def signal_workflow(self, workflow_id: str, signal_name: str, data: Any) -> None:
        """Send a signal to a running workflow."""
        await self._ensure_connected()
        if self._client is not None:
            try:
                handle = self._client.get_workflow_handle(workflow_id)
                await handle.signal(signal_name, data)
                return
            except Exception as exc:
                logger.error("[Temporal] signal_workflow failed: %s", exc)
        if self._use_http_api:
            try:
                requests.post(
                    f"{JOURNEY_API_URL}/journeys/{workflow_id}/signal",
                    json={"signal_name": signal_name, "payload": data},
                    timeout=5,
                )
            except Exception as exc:
                logger.error("[Temporal] HTTP signal failed: %s", exc)

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        if self._client is not None:
            try:
                import asyncio
                asyncio.get_event_loop().run_until_complete(self._client.close())
            except Exception:
                pass
        self._connected = False
        logger.info("[Temporal] Connection closed")
