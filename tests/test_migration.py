import json
from pathlib import Path

import pytest

import figma_context_bridge.migration as migration
from figma_context_bridge.migration import (
    init_migration_state,
    load_migration_state,
    validate_migration_state,
)


EMPTY_STATE = {
    "schemaVersion": 1,
    "targets": [],
    "approvedReferences": [],
    "legacyBehaviorSources": [],
    "protected": [],
    "validations": [],
}


def test_init_creates_exact_schema_in_target_directory(tmp_path: Path) -> None:
    target_dir = tmp_path / "target"

    state = init_migration_state(target_dir)

    state_path = target_dir / ".figma-context" / "migration.json"
    assert state == EMPTY_STATE
    assert json.loads(state_path.read_text(encoding="utf-8")) == EMPTY_STATE
    assert load_migration_state(target_dir) == EMPTY_STATE


def test_approved_reference_requires_explicit_true_approval() -> None:
    state = {
        **EMPTY_STATE,
        "approvedReferences": [
            {
                "route": "/checkout",
                "implementation": "src/pages/Checkout.tsx",
                "figmaUrl": "https://www.figma.com/design/file/Page?node-id=1-2",
                "approvedByUser": False,
            }
        ],
    }

    with pytest.raises(ValueError, match="approvedByUser"):
        validate_migration_state(state)


@pytest.mark.parametrize("missing_field", ["route", "implementation", "figmaUrl"])
def test_approved_reference_requires_non_empty_fields(
    missing_field: str,
) -> None:
    reference = {
        "route": "/checkout",
        "implementation": "src/pages/Checkout.tsx",
        "figmaUrl": "https://www.figma.com/design/file/Page?node-id=1-2",
        "approvedByUser": True,
    }
    reference[missing_field] = ""
    state = {**EMPTY_STATE, "approvedReferences": [reference]}

    with pytest.raises(ValueError, match=missing_field):
        validate_migration_state(state)


@pytest.mark.parametrize("missing_field", ["visualEvidence", "businessEvidence"])
def test_validated_target_requires_non_empty_evidence(
    missing_field: str,
) -> None:
    target = {
        "route": "/payment/result",
        "figmaUrl": "https://www.figma.com/design/file/Page?node-id=3-4",
        "status": "validated",
        "visualEvidence": ["artifacts/payment-result.png"],
        "businessEvidence": ["tests/payment-result.spec.ts"],
    }
    target[missing_field] = []
    state = {**EMPTY_STATE, "targets": [target]}

    with pytest.raises(ValueError, match=missing_field):
        validate_migration_state(state)


def test_validated_target_accepts_both_evidence_arrays() -> None:
    state = {
        **EMPTY_STATE,
        "targets": [
            {
                "route": "/payment/result",
                "figmaUrl": "https://www.figma.com/design/file/Page?node-id=3-4",
                "status": "validated",
                "visualEvidence": ["artifacts/payment-result.png"],
                "businessEvidence": ["tests/payment-result.spec.ts"],
            }
        ],
    }

    assert validate_migration_state(state) == state


@pytest.mark.parametrize(
    "sensitive_key",
    ["password", "TOKEN", "Cookie", "SeCrEt", "AUTHORIZATION"],
)
def test_sensitive_keys_are_rejected_at_any_depth(
    sensitive_key: str,
) -> None:
    state = {
        **EMPTY_STATE,
        "protected": [
            {
                "metadata": {
                    "nested": [{sensitive_key: "must-not-be-persisted"}]
                }
            }
        ],
    }

    with pytest.raises(ValueError, match="sensitive credential key"):
        validate_migration_state(state)


def test_replace_failure_preserves_existing_state_and_cleans_temp_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target_dir = tmp_path / "target"
    state_dir = target_dir / ".figma-context"
    state_dir.mkdir(parents=True)
    prior_state = {**EMPTY_STATE, "protected": ["payment polling"]}
    state_path = state_dir / "migration.json"
    original_bytes = (json.dumps(prior_state) + "\n").encode()
    state_path.write_bytes(original_bytes)

    def fail_replace(source: Path, destination: Path) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(migration.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        init_migration_state(target_dir)

    assert state_path.read_bytes() == original_bytes
    assert list(state_dir.iterdir()) == [state_path]


@pytest.mark.parametrize(
    "state",
    [
        {**EMPTY_STATE, "unexpected": []},
        {key: value for key, value in EMPTY_STATE.items() if key != "protected"},
        {**EMPTY_STATE, "schemaVersion": 2},
        {**EMPTY_STATE, "targets": {}},
    ],
)
def test_top_level_schema_is_exact(state: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        validate_migration_state(state)
