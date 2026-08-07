from __future__ import annotations

import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import requests

from .models import Diagnostic, FigmaTarget


FIGMA_API = "https://api.figma.com"
_RETRY_DELAYS = (0.5, 1.0, 2.0)


class FigmaClient:
    def __init__(
        self,
        token: str,
        session: requests.Session | None = None,
    ) -> None:
        if not token:
            raise ValueError("Figma token required")
        self._token = token
        self._session = session if session is not None else requests.Session()

    def fetch_node(self, target: FigmaTarget) -> dict[str, Any]:
        response = self._request(
            "GET",
            f"/v1/files/{target.file_key}/nodes",
            params={"ids": target.node_id},
            timeout=90,
        )
        try:
            value = response.json()
        finally:
            response.close()
        return value

    def export_image_urls(
        self,
        file_key: str,
        node_ids: Sequence[str],
        fmt: str,
        scale: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]:
        return self._export_in_batches(
            file_key,
            node_ids,
            fmt,
            scale,
            batch_size=40,
        )

    def download(self, url: str, destination: Path) -> None:
        response = self._request(
            "GET",
            url,
            timeout=180,
            stream=True,
            absolute_url=True,
        )
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("wb") as handle:
                for chunk in response.iter_content(8192):
                    if chunk:
                        handle.write(chunk)
        finally:
            response.close()

    def _export_in_batches(
        self,
        file_key: str,
        node_ids: Sequence[str],
        fmt: str,
        scale: int,
        *,
        batch_size: int,
    ) -> tuple[dict[str, str], tuple[Diagnostic, ...]]:
        normalized_ids = [_colon_id(node_id) for node_id in node_ids]
        urls: dict[str, str] = {}
        diagnostics: list[Diagnostic] = []

        for start in range(0, len(normalized_ids), batch_size):
            batch = normalized_ids[start : start + batch_size]
            try:
                images = self._export_batch(file_key, batch, fmt, scale)
            except requests.HTTPError as error:
                if not _is_batch_rejection(error):
                    raise
                for node_id in batch:
                    try:
                        images = self._export_batch(
                            file_key,
                            [node_id],
                            fmt,
                            scale,
                        )
                    except requests.HTTPError as node_error:
                        if _is_batch_rejection(node_error):
                            diagnostics.append(_export_diagnostic(node_id))
                            continue
                        raise
                    url = images.get(node_id)
                    if url:
                        urls[node_id] = url
                    else:
                        diagnostics.append(_export_diagnostic(node_id))
                continue

            for node_id in batch:
                url = images.get(node_id)
                if url:
                    urls[node_id] = url
                else:
                    diagnostics.append(_export_diagnostic(node_id))

        return urls, tuple(diagnostics)

    def _export_batch(
        self,
        file_key: str,
        node_ids: Sequence[str],
        fmt: str,
        scale: int,
    ) -> dict[str, str]:
        response = self._request(
            "GET",
            f"/v1/images/{file_key}",
            params={
                "ids": ",".join(_dash_id(node_id) for node_id in node_ids),
                "format": fmt,
                "scale": scale,
            },
            timeout=120,
        )
        try:
            payload = response.json()
        finally:
            response.close()

        raw_images = payload.get("images") if isinstance(payload, dict) else None
        if not isinstance(raw_images, dict):
            return {}

        images: dict[str, str] = {}
        for node_id, url in raw_images.items():
            if isinstance(node_id, str) and isinstance(url, str) and url:
                images[_colon_id(node_id)] = url
        return images

    def _request(
        self,
        method: str,
        path_or_url: str,
        *,
        timeout: int,
        params: dict[str, Any] | None = None,
        stream: bool = False,
        absolute_url: bool = False,
    ) -> requests.Response:
        url = path_or_url if absolute_url else f"{FIGMA_API}{path_or_url}"
        request_kwargs: dict[str, Any] = {"timeout": timeout}
        if not absolute_url:
            request_kwargs["headers"] = {"X-Figma-Token": self._token}
        if params is not None:
            request_kwargs["params"] = params
        if stream:
            request_kwargs["stream"] = True

        for retry_index in range(len(_RETRY_DELAYS) + 1):
            response = self._session.request(method, url, **request_kwargs)
            if not _is_retryable_status(response.status_code):
                _raise_for_status_and_close_on_error(response)
                return response
            if retry_index == len(_RETRY_DELAYS):
                _raise_for_status_and_close_on_error(response)
            delay = _retry_delay(response, retry_index)
            response.close()
            time.sleep(delay)

        raise AssertionError("retry loop exhausted without returning or raising")


def _colon_id(node_id: str) -> str:
    return node_id.replace("-", ":")


def _dash_id(node_id: str) -> str:
    return node_id.replace(":", "-")


def _is_retryable_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code < 600


def _retry_delay(response: requests.Response, retry_index: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after is not None:
        try:
            delay = float(retry_after)
        except ValueError:
            pass
        else:
            if delay >= 0:
                return delay
    return _RETRY_DELAYS[retry_index]


def _raise_for_status_and_close_on_error(response: requests.Response) -> None:
    try:
        response.raise_for_status()
    except requests.HTTPError:
        response.close()
        raise


def _is_batch_rejection(error: requests.HTTPError) -> bool:
    response = error.response
    return response is not None and response.status_code in {400, 404, 422}


def _export_diagnostic(node_id: str) -> Diagnostic:
    return Diagnostic(
        code="asset_export_failed",
        message=f"Figma did not export an image for node {node_id}",
        retryable=True,
        node_id=node_id,
    )
