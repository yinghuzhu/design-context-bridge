from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import requests

from figma_context_bridge.client import FigmaClient
from figma_context_bridge.models import FigmaTarget


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        json_data: Any = None,
        headers: dict[str, str] | None = None,
        chunks: list[bytes] | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._json_data = json_data
        self._chunks = chunks or []
        self.closed = False
        self.url = "https://fake.invalid/response"

    def json(self) -> Any:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            error = requests.HTTPError(f"HTTP {self.status_code}")
            error.response = self
            raise error

    def iter_content(self, chunk_size: int) -> Iterator[bytes]:
        assert chunk_size == 8192
        yield from self._chunks

    def close(self) -> None:
        self.closed = True


class FakeSession:
    def __init__(self) -> None:
        self.responses: list[FakeResponse] = []
        self.calls: list[dict[str, Any]] = []

    def queue_json(
        self,
        value: Any,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
    ) -> FakeResponse:
        response = FakeResponse(
            status_code=status_code,
            json_data=value,
            headers=headers,
        )
        self.responses.append(response)
        return response

    def queue_bytes(
        self,
        chunks: list[bytes],
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
    ) -> FakeResponse:
        response = FakeResponse(
            status_code=status_code,
            headers=headers,
            chunks=chunks,
        )
        self.responses.append(response)
        return response

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        if not self.responses:
            raise AssertionError(f"unexpected request: {method} {url}")
        return self.responses.pop(0)


@pytest.fixture
def fake_session() -> FakeSession:
    return FakeSession()


def test_requires_a_token() -> None:
    with pytest.raises(ValueError, match="token required"):
        FigmaClient("")


def test_fetch_node_uses_figma_api_without_putting_token_in_url_or_params(
    fake_session: FakeSession,
) -> None:
    fake_session.queue_json({"nodes": {"1:2": {}}})

    result = FigmaClient("super-secret-token", fake_session).fetch_node(
        FigmaTarget(file_key="file", node_id="1:2")
    )

    assert result == {"nodes": {"1:2": {}}}
    assert fake_session.calls == [
        {
            "method": "GET",
            "url": "https://api.figma.com/v1/files/file/nodes",
            "headers": {"X-Figma-Token": "super-secret-token"},
            "params": {"ids": "1:2"},
            "timeout": 90,
        }
    ]
    call = fake_session.calls[0]
    assert "super-secret-token" not in call["url"]
    assert "super-secret-token" not in repr(call["params"])


def test_export_batches_at_40_ids(fake_session: FakeSession) -> None:
    fake_session.queue_json({"images": {}})
    fake_session.queue_json({"images": {}})
    client = FigmaClient("test-token", fake_session)

    client.export_image_urls(
        "file", [f"{index}:1" for index in range(41)], "png", 2
    )

    assert [
        len(call["params"]["ids"].split(","))
        for call in fake_session.calls
    ] == [40, 1]


def test_export_normalizes_dash_ids_to_colon_ids(
    fake_session: FakeSession,
) -> None:
    fake_session.queue_json({"images": {"1-2": "https://assets/1"}})

    urls, diagnostics = FigmaClient(
        "test-token", fake_session
    ).export_image_urls("file", ["1:2"], "png", 2)

    assert urls == {"1:2": "https://assets/1"}
    assert diagnostics == ()


def test_export_normalizes_dash_input_before_returning_urls(
    fake_session: FakeSession,
) -> None:
    fake_session.queue_json({"images": {"1:2": "https://assets/1"}})

    urls, diagnostics = FigmaClient(
        "test-token", fake_session
    ).export_image_urls("file", ["1-2"], "svg", 1)

    assert urls == {"1:2": "https://assets/1"}
    assert diagnostics == ()
    assert fake_session.calls[0]["params"] == {
        "ids": "1-2",
        "format": "svg",
        "scale": 1,
    }


def test_failed_batch_retries_each_id_and_keeps_successes(
    fake_session: FakeSession,
) -> None:
    fake_session.queue_json({}, status_code=400)
    fake_session.queue_json({"images": {"1-2": "https://assets/1"}})
    fake_session.queue_json({}, status_code=400)

    urls, diagnostics = FigmaClient(
        "test-token", fake_session
    ).export_image_urls("file", ["1:2", "2:3"], "png", 2)

    assert urls == {"1:2": "https://assets/1"}
    assert len(diagnostics) == 1
    assert diagnostics[0].code == "asset_export_failed"
    assert diagnostics[0].retryable is True
    assert diagnostics[0].node_id == "2:3"
    assert [call["params"]["ids"] for call in fake_session.calls] == [
        "1-2,2-3",
        "1-2",
        "2-3",
    ]


def test_missing_image_url_produces_a_node_diagnostic(
    fake_session: FakeSession,
) -> None:
    fake_session.queue_json({"images": {"1-2": None}})

    urls, diagnostics = FigmaClient(
        "test-token", fake_session
    ).export_image_urls("file", ["1:2"], "png", 2)

    assert urls == {}
    assert len(diagnostics) == 1
    assert diagnostics[0].code == "asset_export_failed"
    assert diagnostics[0].node_id == "1:2"


def test_429_is_retried_once_when_next_response_succeeds(
    fake_session: FakeSession,
) -> None:
    first = fake_session.queue_json(
        {}, status_code=429, headers={"Retry-After": "0"}
    )
    fake_session.queue_json({"nodes": {}})

    result = FigmaClient("test-token", fake_session).fetch_node(
        FigmaTarget(file_key="file", node_id="1:2")
    )

    assert result == {"nodes": {}}
    assert len(fake_session.calls) == 2
    assert first.closed is True


def test_5xx_retries_are_bounded(
    fake_session: FakeSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    responses: list[FakeResponse] = []
    for _ in range(4):
        responses.append(fake_session.queue_json({}, status_code=503))
    delays: list[float] = []
    monkeypatch.setattr("figma_context_bridge.client.time.sleep", delays.append)

    with pytest.raises(requests.HTTPError, match="HTTP 503"):
        FigmaClient("test-token", fake_session).fetch_node(
            FigmaTarget(file_key="file", node_id="1:2")
        )

    assert len(fake_session.calls) == 4
    assert delays == [0.5, 1.0, 2.0]
    assert all(response.closed for response in responses)


def test_non_retryable_http_error_is_not_retried(
    fake_session: FakeSession,
) -> None:
    response = fake_session.queue_json({}, status_code=403)

    with pytest.raises(requests.HTTPError, match="HTTP 403"):
        FigmaClient("test-token", fake_session).fetch_node(
            FigmaTarget(file_key="file", node_id="1:2")
        )

    assert len(fake_session.calls) == 1
    assert response.closed is True


def test_batch_403_propagates_without_per_id_fallback(
    fake_session: FakeSession,
) -> None:
    response = fake_session.queue_json({}, status_code=403)

    with pytest.raises(requests.HTTPError, match="HTTP 403"):
        FigmaClient("test-token", fake_session).export_image_urls(
            "file", ["1:2", "2:3"], "png", 2
        )

    assert len(fake_session.calls) == 1
    assert response.closed is True


def test_exhausted_batch_503_propagates_without_per_id_fallback(
    fake_session: FakeSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    responses = [
        fake_session.queue_json({}, status_code=503) for _ in range(4)
    ]
    delays: list[float] = []
    monkeypatch.setattr("figma_context_bridge.client.time.sleep", delays.append)

    with pytest.raises(requests.HTTPError, match="HTTP 503"):
        FigmaClient("test-token", fake_session).export_image_urls(
            "file", ["1:2", "2:3"], "png", 2
        )

    assert len(fake_session.calls) == 4
    assert delays == [0.5, 1.0, 2.0]
    assert all(response.closed for response in responses)


def test_download_streams_to_destination(
    fake_session: FakeSession, tmp_path: Path
) -> None:
    response = fake_session.queue_bytes([b"first", b"", b"second"])
    destination = tmp_path / "nested" / "asset.png"

    FigmaClient("test-token", fake_session).download(
        "https://assets/1", destination
    )

    assert destination.read_bytes() == b"firstsecond"
    assert fake_session.calls[0]["stream"] is True
    assert fake_session.calls[0]["timeout"] == 180
    assert "headers" not in fake_session.calls[0]
    assert response.closed is True
