import re
from collections.abc import Callable

import httpx

# Vite emits chunks as <name>-<8 char hash>.js and refers to them by file name.
_CHUNK = re.compile(r"[A-Za-z0-9_.\-]+-[A-Za-z0-9_\-]{8}\.js")
# How the build inlines VITE_API_URL=/api: `/api`.replace(/\/$/,``).
_SAME_ORIGIN_API = re.compile(r"""[`'"]/api[`'"]\.replace""")


def crawl_bundle(client: httpx.Client) -> dict[str, str]:
    """Every JS chunk reachable from index.html, by file name."""
    pending = set(_CHUNK.findall(client.get("/").text))
    seen: dict[str, str] = {}
    while pending:
        name = pending.pop()
        response = client.get(f"/assets/{name}")
        assert response.status_code == 200, f"/assets/{name} -> {response.status_code}"
        seen[name] = response.text
        pending |= set(_CHUNK.findall(response.text)) - seen.keys()
    return seen


def test_root_serves_the_spa_shell(new_client: Callable[[], httpx.Client]) -> None:
    response = new_client().get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<script" in response.text


def test_deep_link_falls_back_to_the_shell(new_client: Callable[[], httpx.Client]) -> None:
    client = new_client()
    response = client.get("/room/some-session-id")
    assert response.status_code == 200
    assert response.text == client.get("/").text
    assert response.headers["cache-control"] == "no-cache"


def test_real_static_files_are_served_as_themselves(new_client: Callable[[], httpx.Client]) -> None:
    client = new_client()
    for path in ("/favicon.ico", "/robots.txt"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert not response.headers["content-type"].startswith("text/html"), path


def test_unknown_api_path_is_a_json_404_not_the_shell(new_client: Callable[[], httpx.Client]) -> None:
    response = new_client().get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_bundle_calls_the_same_origin_api(new_client: Callable[[], httpx.Client]) -> None:
    # Guards the MSYS bug in the README: Git Bash rewrites /api into
    # C:/Program Files/Git/api, which the UI then loads with fine but every API
    # call fails.
    bundle = crawl_bundle(new_client())
    assert bundle, "index.html references no JS chunks"
    assert not [name for name, source in bundle.items() if "Program Files" in source]
    assert [name for name, source in bundle.items() if _SAME_ORIGIN_API.search(source)]
