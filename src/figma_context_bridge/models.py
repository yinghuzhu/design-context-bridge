from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class PackageStatus(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    INVALID = "invalid"


@dataclass(frozen=True)
class FigmaTarget:
    file_key: str
    node_id: str

    @property
    def cache_key(self) -> str:
        return f"{self.file_key}_{self.node_id.replace(':', '-')}"


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    retryable: bool = False
    node_id: str | None = None


@dataclass(frozen=True)
class PackageValidation:
    status: PackageStatus
    diagnostics: tuple[Diagnostic, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "diagnostics": [asdict(item) for item in self.diagnostics],
        }
