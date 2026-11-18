"""Local labeling page for the Phase 6 export — one email at a time.

Serves a small page on 127.0.0.1 that shows each row of a label sheet (from
``email_label_export.py``) and lets you click its correct type and job (or
"none"). Every click is saved at once to ``<sheet>.labels.json`` next to the
sheet, so you can stop any time and pick up where you left off. Nothing leaves
this computer: it binds to 127.0.0.1 only, needs the per-run link it prints,
and renders email text as plain text (never HTML, never links).

The sheet, the job keys and the labels all live in the git-ignored
backend/email_exports/ folder; anything else is refused.

Usage (from backend/):
    .venv/Scripts/python scripts/email_label_server.py            # newest sheet
    .venv/Scripts/python scripts/email_label_server.py --merge    # write <sheet>-labeled.csv
"""

import argparse
import csv
import json
import os
import secrets
import sys
import threading
import webbrowser
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evals.email_export import (  # noqa: E402
    ExportRefused,
    ensure_git_ignored,
    jobs_path_for,
)

EXPORT_DIR = Path(__file__).resolve().parent.parent / "email_exports"
UI_DIR = Path(__file__).resolve().parent / "label_ui"
# The truth labels (the classifier's own "unsure" is not a truth label).
TYPES = [
    ("applied", "Application received"),
    ("interview", "Interview"),
    ("assessment", "Assessment / test"),
    ("offer", "Offer"),
    ("rejected", "Rejection"),
    ("recruiter", "Recruiter / contact"),
    ("unknown", "Not a job update"),
]
_TYPE_KEYS = {k for k, _ in TYPES}
_SHOWN = ("id", "group", "role", "date", "sender", "subject", "text", "read_issues")
_HINTS = ("predicted_event", "predicted_job", "match", "filter_reason")
_MAX_BODY = 16 * 1024
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    "img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


def labels_path_for(sheet: Path) -> Path:
    return sheet.with_name(f"{sheet.stem}.labels.json")


def _uncell(v: str) -> str:
    return v[1:] if v[:1] == "'" and v[1:2] in ("=", "+", "-", "@", "\t") else v


class Store:
    """The sheet (read once), the job keys, and the labels file (saved on
    every change, atomically)."""

    def __init__(self, sheet: Path) -> None:
        self.sheet = sheet
        self.path = labels_path_for(sheet)
        with sheet.open(newline="", encoding="utf-8-sig") as f:
            self.rows = [
                {k: _uncell(v or "") for k, v in r.items()} for r in csv.DictReader(f)
            ]
        self.by_id = {r["id"]: r for r in self.rows}
        jobs_file = jobs_path_for(sheet)
        self.jobs = []
        if jobs_file.exists():
            with jobs_file.open(newline="", encoding="utf-8-sig") as f:
                self.jobs = [
                    {
                        "key": r["job_key"],
                        "company": _uncell(r["company"]),
                        "title": _uncell(r["title"]),
                    }
                    for r in csv.DictReader(f)
                ]
        self.job_keys = {j["key"] for j in self.jobs}
        self.lock = threading.Lock()
        self.labels: dict[str, dict] = {}
        if self.path.exists():
            self.labels = json.loads(self.path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.labels, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def progress(self) -> dict:
        done = sum(1 for v in self.labels.values() if v.get("label") and v.get("job"))
        return {"done": done, "total": len(self.rows)}

    def set(self, data: dict) -> dict:
        rid = str(data.get("id", ""))
        if rid not in self.by_id:
            raise ValueError("unknown row")
        label = str(data.get("label") or "")
        job = str(data.get("job") or "")
        if label and label not in _TYPE_KEYS:
            raise ValueError("unknown type")
        if job and job != "none" and job not in self.job_keys:
            raise ValueError("unknown job")
        entry = {
            "label": label,
            "job": job,
            "reminder": bool(data.get("reminder")),
            "note": str(data.get("note") or "")[:500],
            "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        with self.lock:
            self.labels[rid] = entry
            self._save()
            return self.progress()

    def payload(self) -> dict:
        return {
            "rows": [
                {
                    **{k: r.get(k, "") for k in _SHOWN},
                    "hints": {k: r.get(k, "") for k in _HINTS},
                }
                for r in self.rows
            ],
            "jobs": self.jobs,
            "types": [{"key": k, "label": v} for k, v in TYPES],
            "labels": self.labels,
            "progress": self.progress(),
        }

    def merge(self) -> Path:
        """Write ``<sheet>-labeled.csv``: the sheet with your labels filled in."""
        out = self.sheet.with_name(f"{self.sheet.stem}-labeled.csv")
        ensure_git_ignored(out)
        with self.sheet.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fields = [*reader.fieldnames, "reminder"]
            rows = list(reader)
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                lab = self.labels.get(r["id"], {})
                r["correct_label"] = lab.get("label", "")
                r["correct_job"] = lab.get("job", "")
                r["notes"] = lab.get("note", "")
                r["reminder"] = "yes" if lab.get("reminder") else ""
                w.writerow(r)
        return out


def make_handler(store: Store, token: str, port: int):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    static = {
        "/": ("index.html", "text/html; charset=utf-8"),
        "/app.js": ("app.js", "text/javascript; charset=utf-8"),
        "/app.css": ("app.css", "text/css; charset=utf-8"),
    }

    class Handler(BaseHTTPRequestHandler):
        server_version = "label"

        def log_message(self, *args):  # no request logs (paths only, but quiet)
            pass

        def _send(self, status, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, obj) -> None:
            self._send(status, json.dumps(obj).encode(), "application/json")

        def _guard(self, api: bool) -> bool:
            # DNS-rebinding and other-site protection: right Host, and the API
            # needs this run's token (sent by the page, never in a cookie).
            if self.headers.get("Host") not in allowed_hosts:
                self._send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain")
                return False
            if api and not secrets.compare_digest(
                self.headers.get("X-Label-Token", ""), token
            ):
                self._json(HTTPStatus.FORBIDDEN, {"error": "bad token"})
                return False
            return True

        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/api/data":
                if self._guard(api=True):
                    self._json(HTTPStatus.OK, store.payload())
                return
            if not self._guard(api=False):
                return
            if path in static:
                name, ctype = static[path]
                self._send(HTTPStatus.OK, (UI_DIR / name).read_bytes(), ctype)
            else:
                self._send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")

        def do_POST(self):  # noqa: N802
            if not self._guard(api=True):
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > _MAX_BODY or (
                self.headers.get("Content-Type", "").split(";")[0] != "application/json"
            ):
                self._json(HTTPStatus.BAD_REQUEST, {"error": "bad request"})
                return
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/api/label":
                    self._json(HTTPStatus.OK, store.set(data))
                elif self.path == "/api/merge":
                    self._json(HTTPStatus.OK, {"file": store.merge().name})
                else:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except (ValueError, ExportRefused) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    return Handler


def newest_sheet() -> Path:
    sheets = sorted(
        (
            p
            for p in EXPORT_DIR.glob("phase6-labels-*.csv")
            if not p.stem.endswith(("-jobs", "-labeled"))
        ),
        key=lambda p: p.stat().st_mtime,
    )
    if not sheets:
        raise SystemExit(
            "no phase6 label sheet in email_exports/ — run the export first"
        )
    return sheets[-1]


def main() -> None:
    ap = argparse.ArgumentParser(description="Local labeling page (127.0.0.1 only).")
    ap.add_argument("--sheet", type=Path, default=None)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument(
        "--merge", action="store_true", help="write <sheet>-labeled.csv and exit"
    )
    args = ap.parse_args()

    sheet = (args.sheet or newest_sheet()).resolve()
    try:
        ensure_git_ignored(sheet, labels_path_for(sheet))
    except ExportRefused as exc:
        raise SystemExit(f"REFUSED: {exc}") from None
    store = Store(sheet)
    if args.merge:
        print(f"wrote {store.merge().name}")
        return

    token = secrets.token_urlsafe(18)
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), make_handler(store, token, args.port)
    )
    url = f"http://127.0.0.1:{args.port}/#t={token}"
    p = store.progress()
    print(f"labeling {sheet.name}: {p['done']} of {p['total']} done")
    print(f"open: {url}")
    print("progress saves on every click. Stop with Ctrl+C; run again to continue.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped — your labels are saved.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
