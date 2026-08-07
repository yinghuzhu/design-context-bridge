from urllib.parse import parse_qs, urlparse

from .models import FigmaTarget


def parse_figma_url(url: str) -> FigmaTarget:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    file_key = None
    for kind in ("design", "file", "proto"):
        if kind in parts:
            index = parts.index(kind)
            if index + 1 < len(parts):
                file_key = parts[index + 1]
            break
    if not file_key:
        raise ValueError(f"Cannot find fileKey in URL: {url}")
    node_id = parse_qs(parsed.query).get("node-id", [None])[0]
    if not node_id:
        raise ValueError(f"URL missing ?node-id= query parameter: {url}")
    return FigmaTarget(file_key=file_key, node_id=node_id.replace("-", ":"))
