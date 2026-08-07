import pytest

from figma_context_bridge.models import PackageStatus
from figma_context_bridge.url import parse_figma_url


@pytest.mark.parametrize("kind", ["design", "file", "proto"])
def test_parse_supported_figma_urls(kind: str) -> None:
    target = parse_figma_url(
        f"https://www.figma.com/{kind}/abc123/title?node-id=1010-6349"
    )
    assert target.file_key == "abc123"
    assert target.node_id == "1010:6349"
    assert target.cache_key == "abc123_1010-6349"


def test_parse_requires_node_id() -> None:
    with pytest.raises(ValueError, match="node-id"):
        parse_figma_url("https://www.figma.com/design/abc123/title")


def test_package_status_values_are_stable() -> None:
    assert [item.value for item in PackageStatus] == ["complete", "partial", "invalid"]
