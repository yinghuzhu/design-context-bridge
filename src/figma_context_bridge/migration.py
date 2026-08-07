from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
STATE_DIRECTORY = ".figma-context"
STATE_FILENAME = "migration.json"

_TOP_LEVEL_KEYS = {
    "schemaVersion",
    "targets",
    "approvedReferences",
    "legacyBehaviorSources",
    "protected",
    "validations",
}
_LIST_FIELDS = _TOP_LEVEL_KEYS - {"schemaVersion"}
_SENSITIVE_KEYS = {
    "password",
    "token",
    "cookie",
    "secret",
    "authorization",
}


def init_migration_state(target_dir: Path | str) -> dict[str, Any]:
    """Create or atomically normalize a target repository's migration state."""
    state_path = _state_path(target_dir)
    if state_path.exists():
        state = load_migration_state(target_dir)
    else:
        state = _empty_state()

    state_path.parent.mkdir(parents=True, exist_ok=True)
    _write_state(state_path, state)
    return state


def load_migration_state(target_dir: Path | str) -> dict[str, Any]:
    """Load and validate migration state from the target repository."""
    state_path = _state_path(target_dir)
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid migration state JSON: {error}") from error
    return validate_migration_state(data)


def validate_migration_state(data: object) -> dict[str, Any]:
    """Validate schema v1 and reject credential-bearing state recursively."""
    _reject_sensitive_keys(data)
    if not isinstance(data, dict):
        raise ValueError("migration state must be a JSON object")
    if set(data) != _TOP_LEVEL_KEYS:
        raise ValueError(
            "migration state must contain exactly the schema v1 top-level keys"
        )
    if type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
        raise ValueError("schemaVersion must be 1")

    for field in _LIST_FIELDS:
        if not isinstance(data[field], list):
            raise ValueError(f"{field} must be an array")

    for index, reference in enumerate(data["approvedReferences"]):
        location = f"approvedReferences[{index}]"
        if not isinstance(reference, dict):
            raise ValueError(f"{location} must be an object")
        for field in ("route", "implementation", "figmaUrl"):
            value = reference.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{location}.{field} must be a non-empty string")
        if reference.get("approvedByUser") is not True:
            raise ValueError(f"{location}.approvedByUser must be true")

    for index, target in enumerate(data["targets"]):
        location = f"targets[{index}]"
        if not isinstance(target, dict):
            raise ValueError(f"{location} must be an object")
        if target.get("status") != "validated":
            continue
        for field in ("visualEvidence", "businessEvidence"):
            evidence = target.get(field)
            if not isinstance(evidence, list) or not evidence:
                raise ValueError(f"{location}.{field} must be a non-empty array")

    return data


def _state_path(target_dir: Path | str) -> Path:
    return Path(target_dir) / STATE_DIRECTORY / STATE_FILENAME


def _empty_state() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "targets": [],
        "approvedReferences": [],
        "legacyBehaviorSources": [],
        "protected": [],
        "validations": [],
    }


def _reject_sensitive_keys(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ValueError("migration state object keys must be strings")
            if key.casefold() in _SENSITIVE_KEYS:
                raise ValueError(
                    f"sensitive credential key is forbidden: {key}"
                )
            _reject_sensitive_keys(child)
    elif isinstance(value, list):
        for child in value:
            _reject_sensitive_keys(child)


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    validate_migration_state(state)
    temporary_path: Path | None = None
    descriptor: int | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            dir=state_path.parent,
            prefix=f".{STATE_FILENAME}.",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = None
            json.dump(
                state,
                stream,
                ensure_ascii=False,
                indent=2,
                allow_nan=False,
            )
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, state_path)
        temporary_path = None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
