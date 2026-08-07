from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
import requests

import figma_context_bridge.cli as cli
from figma_context_bridge.downloader import PrepareResult
from figma_context_bridge.models import (
    Diagnostic,
    PackageStatus,
    PackageValidation,
)
from figma_context_bridge.renderer import RenderResult


def _validation(status: PackageStatus) -> PackageValidation:
    diagnostics = (
        Diagnostic(
            code="asset_missing",
            message="one optional asset is unavailable",
            retryable=True,
            node_id="2:3",
        ),
    ) if status is PackageStatus.PARTIAL else ()
    return PackageValidation(status=status, diagnostics=diagnostics)


def _load_pipeline_module():
    script = Path(__file__).parents[1] / "scripts" / "figma_pipeline.py"
    spec = importlib.util.spec_from_file_location("figma_pipeline_cli_test", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_json_mode_emits_exactly_one_parseable_envelope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(cli, "validate_package", lambda path: _validation(PackageStatus.COMPLETE))

    exit_code = cli.main(["inspect", str(tmp_path), "--json"])

    captured = capsys.readouterr()
    lines = captured.out.splitlines()
    assert exit_code == 0
    assert len(lines) == 1
    assert json.loads(lines[0]) == {
        "ok": True,
        "command": "inspect",
        "status": "complete",
        "data": {"packageDir": str(tmp_path.resolve())},
        "diagnostics": [],
    }


def test_partial_prepare_exits_zero_and_generates_context(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    package_dir = tmp_path / "package"
    result = PrepareResult(package_dir, _validation(PackageStatus.PARTIAL), False)
    generated = tuple(package_dir / name for name in ("AI_CONTEXT.md", "styles.json", "components.json"))
    monkeypatch.setenv("FIGMA_TOKEN", "test-token")
    monkeypatch.setattr(cli, "FigmaClient", lambda token: object())
    monkeypatch.setattr(cli, "prepare_package", lambda url, client, options: result)
    monkeypatch.setattr(cli, "generate_context_files", lambda path: generated)

    exit_code = cli.main(
        [
            "prepare",
            "https://www.figma.com/design/file/Page?node-id=1-2",
            "--output",
            str(tmp_path),
            "--json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["ok"] is True
    assert payload["status"] == "partial"
    assert payload["data"]["packageDir"] == str(package_dir)
    assert payload["data"]["contextFiles"] == [str(path) for path in generated]
    assert payload["diagnostics"][0]["code"] == "asset_missing"


def test_invalid_package_validation_exits_twenty(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    invalid = PackageValidation(
        PackageStatus.INVALID,
        (Diagnostic("missing_manifest", "manifest.json is missing"),),
    )
    monkeypatch.setattr(cli, "validate_package", lambda path: invalid)

    exit_code = cli.main(["validate-package", str(tmp_path), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 20
    assert payload["ok"] is False
    assert payload["status"] == "invalid"
    assert payload["diagnostics"][0]["code"] == "missing_manifest"


def test_status_does_not_require_figma_token(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("FIGMA_TOKEN", raising=False)
    monkeypatch.setattr(cli, "validate_package", lambda path: _validation(PackageStatus.COMPLETE))

    exit_code = cli.main(["status", str(tmp_path), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["status"] == "complete"


def test_migration_validation_rejects_secret_field_with_exit_thirty(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    state_dir = tmp_path / ".figma-context"
    state_dir.mkdir()
    (state_dir / "migration.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "targets": [],
                "approvedReferences": [],
                "legacyBehaviorSources": [],
                "protected": [{"secret": "must-not-leak"}],
                "validations": [],
            }
        ),
        encoding="utf-8",
    )

    exit_code = cli.main(["migration", "validate", str(tmp_path), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 30
    assert payload["ok"] is False
    assert payload["status"] == "invalid"
    assert "must-not-leak" not in json.dumps(payload)


def test_legacy_pipeline_renders_partial_prepare_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = _load_pipeline_module()
    package_dir = tmp_path / "file_1-2"
    prepare_result = PrepareResult(
        package_dir,
        _validation(PackageStatus.PARTIAL),
        False,
    )
    rendered = RenderResult(package_dir / "reconstruct.html", None, 100, 200)
    calls: list[tuple[str, object]] = []
    monkeypatch.setenv("FIGMA_TOKEN", "test-token")
    monkeypatch.setattr(pipeline, "FigmaClient", lambda token: object())
    monkeypatch.setattr(
        pipeline,
        "prepare_package",
        lambda url, client, options: prepare_result,
    )
    monkeypatch.setattr(
        pipeline,
        "generate_context_files",
        lambda path: calls.append(("context", path)),
    )
    monkeypatch.setattr(
        pipeline,
        "render_package",
        lambda path, compare=False: calls.append(("render", (path, compare))) or rendered,
    )

    exit_code = pipeline.main(
        [
            "https://www.figma.com/design/file/Page?node-id=1-2",
            "--out",
            str(tmp_path),
            "--no-open",
        ]
    )

    assert exit_code == 0
    assert ("context", package_dir) in calls
    assert ("render", (package_dir, True)) in calls


def test_prepare_cache_lookup_can_succeed_without_token(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    package_dir = tmp_path / "package"
    result = PrepareResult(package_dir, _validation(PackageStatus.COMPLETE), True)
    monkeypatch.delenv("FIGMA_TOKEN", raising=False)
    monkeypatch.setattr(cli, "prepare_package", lambda url, client, options: result)
    monkeypatch.setattr(cli, "generate_context_files", lambda path: ())

    exit_code = cli.main(
        [
            "prepare",
            "https://www.figma.com/design/file/Page?node-id=1-2",
            "--output",
            str(tmp_path),
            "--json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["data"]["cacheHit"] is True


@pytest.mark.parametrize(
    ("failure", "expected_exit", "expected_code"),
    [
        (cli.MissingTokenError(), 40, "missing_token"),
        (requests.ConnectionError("signed URL must not leak"), 50, "figma_api_failed"),
        (OSError("disk path must not leak"), 60, "filesystem_error"),
    ],
)
def test_prepare_typed_failures_use_stable_exit_codes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    failure: Exception,
    expected_exit: int,
    expected_code: str,
) -> None:
    monkeypatch.setenv("FIGMA_TOKEN", "test-token")
    monkeypatch.setattr(cli, "FigmaClient", lambda token: object())

    def fail_prepare(url, client, options):
        raise failure

    monkeypatch.setattr(cli, "prepare_package", fail_prepare)

    exit_code = cli.main(
        [
            "prepare",
            "https://www.figma.com/design/file/Page?node-id=1-2",
            "--output",
            str(tmp_path),
            "--json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == expected_exit
    assert payload["diagnostics"][0]["code"] == expected_code
    assert "must not leak" not in json.dumps(payload)


def test_auth_failure_uses_exit_forty(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    response = requests.Response()
    response.status_code = 403
    error = requests.HTTPError("token value", response=response)
    monkeypatch.setenv("FIGMA_TOKEN", "test-token")
    monkeypatch.setattr(cli, "FigmaClient", lambda token: object())

    def fail_prepare(url, client, options):
        raise error

    monkeypatch.setattr(cli, "prepare_package", fail_prepare)

    exit_code = cli.main(
        [
            "prepare",
            "https://www.figma.com/design/file/Page?node-id=1-2",
            "--output",
            str(tmp_path),
            "--json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 40
    assert payload["diagnostics"][0]["code"] == "figma_auth_failed"
    assert "token value" not in json.dumps(payload)


def test_json_diagnostics_redact_signed_urls_and_query_secrets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    validation = PackageValidation(
        PackageStatus.PARTIAL,
        (
            Diagnostic(
                "asset_download_failed",
                "failed https://signed.invalid/a?token=private-value",
                True,
            ),
        ),
    )
    monkeypatch.setattr(cli, "validate_package", lambda path: validation)

    exit_code = cli.main(["status", str(tmp_path), "--json"])

    serialized = capsys.readouterr().out
    assert exit_code == 0
    assert "signed.invalid" not in serialized
    assert "private-value" not in serialized


def test_migration_init_then_validate_without_token(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("FIGMA_TOKEN", raising=False)

    init_exit = cli.main(["migration", "init", str(tmp_path), "--json"])
    init_payload = json.loads(capsys.readouterr().out)
    validate_exit = cli.main(
        ["migration", "validate", str(tmp_path), "--json"]
    )
    validate_payload = json.loads(capsys.readouterr().out)

    assert init_exit == 0
    assert init_payload["status"] == "initialized"
    assert validate_exit == 0
    assert validate_payload["status"] == "valid"
