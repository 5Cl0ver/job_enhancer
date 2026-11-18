"""Local labeling server: token + host checks, validated saves, resume, merge.
Synthetic sheet in a temp folder; the server runs on 127.0.0.1 for the test."""

import csv
import http.client
import importlib.util
import json
import threading
from pathlib import Path

import pytest

from evals.email_label_export import LABEL_COLUMNS

_SPEC = importlib.util.spec_from_file_location(
    "email_label_server",
    Path(__file__).resolve().parents[2] / "scripts" / "email_label_server.py",
)
ls = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ls)

TOKEN = "test-token"


def _sheet(tmp_path: Path) -> Path:
    sheet = tmp_path / "phase6-labels-seed1.csv"
    with sheet.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(LABEL_COLUMNS)
        for i, subj in enumerate(["Interview at Brambleworks", "=HYPERLINK(x)"]):
            row = dict.fromkeys(LABEL_COLUMNS, "")
            row.update(
                id=f"r{i}",
                group="likely_job",
                folder="INBOX",
                uid=str(i),
                sender="Maren <maren@brambleworks.example>",
                subject="'" + subj if subj.startswith("=") else subj,
                text="<script>alert(1)</script> We'd like to talk.",
                role="inbox",
            )
            w.writerow([row[c] for c in LABEL_COLUMNS])
    with ls.jobs_path_for(sheet).open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["job_key", "company", "title", "saved_job_id"])
        w.writerow(["J01", "Brambleworks", "Full Stack Developer", "s-1"])
    return sheet


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(ls, "ensure_git_ignored", lambda *p: None)
    store = ls.Store(_sheet(tmp_path))
    srv = ls.ThreadingHTTPServer(("127.0.0.1", 0), lambda *a: None)
    port = srv.server_address[1]
    srv.RequestHandlerClass = ls.make_handler(store, TOKEN, port)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield port, store
    srv.shutdown()
    srv.server_close()


def _req(port, method, path, body=None, token=TOKEN, host=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Host": host or f"127.0.0.1:{port}"}
    if token:
        headers["X-Label-Token"] = token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    c.request(method, path, body=data, headers=headers)
    r = c.getresponse()
    out = r.status, dict(r.getheaders()), r.read()
    c.close()
    return out


def test_page_and_strict_headers(server):
    port, _ = server
    status, headers, body = _req(port, "GET", "/", token=None)
    assert status == 200 and b'<script src="/app.js">' in body
    assert "script-src 'self'" in headers["Content-Security-Policy"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert _req(port, "GET", "/app.js", token=None)[0] == 200


def test_api_needs_the_token_and_the_right_host(server):
    port, _ = server
    assert _req(port, "GET", "/api/data", token=None)[0] == 403
    assert _req(port, "GET", "/api/data", token="wrong")[0] == 403
    assert _req(port, "GET", "/", token=None, host="evil.example")[0] == 403
    status, _, body = _req(port, "GET", "/api/data")
    data = json.loads(body)
    assert status == 200 and len(data["rows"]) == 2
    assert data["rows"][1]["subject"] == "=HYPERLINK(x)"  # shown as typed, as text
    assert data["jobs"] == [
        {"key": "J01", "company": "Brambleworks", "title": "Full Stack Developer"}
    ]


def test_saves_validate_and_persist(server, tmp_path):
    port, store = server
    ok = _req(
        port, "POST", "/api/label", {"id": "r0", "label": "interview", "job": "J01"}
    )
    assert ok[0] == 200 and json.loads(ok[2]) == {"done": 1, "total": 2}
    assert _req(port, "POST", "/api/label", {"id": "r9", "label": "offer"})[0] == 400
    assert _req(port, "POST", "/api/label", {"id": "r1", "label": "bogus"})[0] == 400
    assert _req(port, "POST", "/api/label", {"id": "r1", "job": "J99"})[0] == 400
    _req(port, "POST", "/api/label", {"id": "r1", "label": "unknown", "job": "none"})
    # A restarted server picks up exactly where it was.
    again = ls.Store(store.sheet)
    assert again.progress() == {"done": 2, "total": 2}
    assert again.labels["r0"]["label"] == "interview"


def test_merge_writes_a_labeled_copy(server):
    port, store = server
    _req(
        port,
        "POST",
        "/api/label",
        {"id": "r0", "label": "interview", "job": "J01", "reminder": True},
    )
    status, _, body = _req(port, "POST", "/api/merge", {})
    assert status == 200
    out = store.sheet.with_name(json.loads(body)["file"])
    with out.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert (rows[0]["correct_label"], rows[0]["correct_job"], rows[0]["reminder"]) == (
        "interview",
        "J01",
        "yes",
    )
    assert rows[1]["correct_label"] == ""


def test_page_never_injects_email_html():
    js = (Path(ls.__file__).parent / "label_ui" / "app.js").read_text(encoding="utf-8")
    assert "innerHTML" not in js and "insertAdjacentHTML" not in js
