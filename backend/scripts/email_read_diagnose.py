"""Measure where email text is lost while reading — counts only.

Re-fetches (read-only, BODY.PEEK) the exact rows selected by a Phase 6 label
export, measures each reading stage with ``evals.email_read_diagnostics``, and
prints aggregate counts: blank and likely-cut-off emails by MIME structure,
the stage that emptied each blank email, and the rule behind hidden-text
losses. Never prints or stores email text; ``--save`` writes per-row NUMBERS
(no text) to a git-ignored JSON file for before/after comparison.

Usage (from backend/):
    .venv/Scripts/python scripts/email_read_diagnose.py --key-env ../../job_enhancer/backend/.env
"""

import argparse
import asyncio
import importlib.util
import json
import statistics
from collections import Counter
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "_lx_cli", HERE / "email_label_export.py"
)
cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cli)  # sets up env + sys.path like the export does

from app.services import email_sync  # noqa: E402
from app.utils import crypto  # noqa: E402
from evals.email_export import ensure_git_ignored  # noqa: E402
from evals.email_label_export import ExportState, state_path_for  # noqa: E402
from evals.email_read_diagnostics import diagnose, verdict  # noqa: E402


def _stage_emptied(r) -> str:
    """Which stage left a blank email with nothing."""
    if r.source == "none":
        return "no_text_part"
    html = [p for p in r.parts if p.kind == "html"]
    if not html:
        return "plain_part_empty"
    if all(p.payload_bytes == 0 for p in html):
        return "transfer_decode_empty"
    if all(p.decoded_chars == 0 for p in html):
        return "charset_decode_empty"
    if all(p.parse_chars == 0 for p in html):
        return "parse_found_no_text"
    if all(p.after_skip_chars == 0 for p in html):
        return "skip_tags_removed_all"
    if all(p.kept_chars == 0 for p in html):
        return "hidden_removal_removed_all"
    return "normalize_removed_all"


def _main_reason(r) -> str:
    dropped = Counter()
    for p in r.parts:
        dropped.update(
            {k: v for k, v in p.dropped.items() if not k.startswith("skip_")}
        )
    return dropped.most_common(1)[0][0] if dropped else "-"


def _wrapper(r) -> str:
    for p in r.parts:
        if p.wrapper_reason:
            return f"{p.wrapper_reason}/{'closed' if p.wrapper_closed else 'UNCLOSED'}"
    return "-"


def _cut_cause(r) -> str:
    if r.source == "plain" and r.plain_chars < 0.5 * r.html_visible_chars:
        return "plain_part_much_shorter_than_html"
    return f"hidden:{_main_reason(r)}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--key-env", type=Path, required=True)
    ap.add_argument("--db", default=cli.LOCAL_DB)
    ap.add_argument("--user", default=None)
    ap.add_argument(
        "--sheet", type=Path, default=cli.EXPORT_DIR / "phase6-labels-seed1337.csv"
    )
    ap.add_argument("--save", type=Path, default=None, help="per-row numbers (no text)")
    args = ap.parse_args()

    state = ExportState.load(state_path_for(args.sheet.resolve()))
    if state is None or not state.selection:
        raise SystemExit("no saved selection for that sheet")
    if args.save:
        ensure_git_ignored(args.save.resolve())
    cli.settings.mail_enc_key = cli._read_key(args.key_env)
    account, _jobs = asyncio.run(cli._load(args.db, args.user))
    refs = [state.ref(k) for k, _ in state.selection]
    reports: dict[str, object] = {}

    def on_message(ref, raw, issue):
        if raw is not None and not issue:
            reports[ref.key] = diagnose(raw)

    todo = refs
    for attempt in range(6):
        try:
            email_sync.fetch_refs(
                account.imap_host,
                account.imap_port,
                account.email_address,
                crypto.decrypt(account.secret_encrypted),
                todo,
                on_message,
            )
            break
        except email_sync.SyncInterrupted as exc:
            print(f"  interrupted ({exc.reason}); retry {attempt + 1}")
            todo = [r for r in refs if r.key not in reports]

    rows = list(reports.values())
    print(f"measured {len(rows)} of {len(refs)} selected emails")
    v = Counter(verdict(r) for r in rows)
    print("verdicts:", dict(v))
    by_shape = Counter()
    for r in rows:
        by_shape[(r.shape, verdict(r))] += 1
    print("\nby structure (blank / cut_off / total):")
    for shape in sorted(
        {r.shape for r in rows},
        key=lambda s: -sum(by_shape[(s, x)] for x in ("ok", "blank", "cut_off")),
    ):
        t = sum(by_shape[(shape, x)] for x in ("ok", "blank", "cut_off"))
        print(
            f"  {by_shape[(shape, 'blank')]:>3} / {by_shape[(shape, 'cut_off')]:>3} / {t:>3}  {shape}"
        )
    blanks = [r for r in rows if verdict(r) == "blank"]
    print(
        "\nblank: stage that emptied the text:",
        dict(Counter(_stage_emptied(r) for r in blanks)),
    )
    print("blank: main hidden rule:", dict(Counter(_main_reason(r) for r in blanks)))
    print("blank: one wrapper hid >=50%:", dict(Counter(_wrapper(r) for r in blanks)))
    print(
        "blank: had decode issues:",
        sum(1 for r in blanks if any(p.decode_issues for p in r.parts)),
    )
    print(
        "blank: dropped under never-closed hidden element:",
        sum(1 for r in blanks if any(p.unclosed_hidden_chars for p in r.parts)),
    )

    def feats(r):
        for p in r.parts:
            if p.wrapper_reason:
                return (
                    f"{p.wrapper_reason}<{p.wrapper_tag}> ended_by={p.wrapper_ended_by}"
                )
        return "-"

    lossy = [r for r in rows if verdict(r) != "ok"]
    print("blank+cut: wrapper structure:", dict(Counter(feats(r) for r in lossy)))
    print(
        "blank+cut: chars hidden only for lack of an implied end tag > 0:",
        sum(1 for r in lossy if any(p.after_implied_end_chars for p in r.parts)),
    )
    print(
        "blank+cut: chars hidden by font-size:0 despite a child reset > 0:",
        sum(1 for r in lossy if any(p.font_reset_chars for p in r.parts)),
    )
    tot_imp = sum(p.after_implied_end_chars for r in rows for p in r.parts)
    tot_fr = sum(p.font_reset_chars for r in rows for p in r.parts)
    print(
        f"all rows: chars hidden after an implied end {tot_imp}, under a font reset {tot_fr}"
    )
    dn = [p for r in lossy for p in r.parts if p.wrapper_reason == "display_none"]
    print("display_none wrappers in blank+cut:", len(dn))
    print("  depth:", dict(Counter(min(p.wrapper_depth, 9) for p in dn)))
    print("  style props:", dict(Counter(p.wrapper_props for p in dn).most_common(8)))
    print(
        "  has class:",
        sum(p.wrapper_has_class for p in dn),
        " class re-shown by <style>:",
        sum(p.wrapper_class_shown_by_css for p in dn),
    )
    print(
        "  visible chars before it (0 / <100 / more):",
        dict(
            Counter(
                "0"
                if p.wrapper_kept_before == 0
                else "<100"
                if p.wrapper_kept_before < 100
                else "more"
                for p in dn
            )
        ),
    )
    print(
        "  tags inside (<5 / <50 / more):",
        dict(
            Counter(
                "<5"
                if p.wrapper_tags_inside < 5
                else "<50"
                if p.wrapper_tags_inside < 50
                else "more"
                for p in dn
            )
        ),
    )
    print("  share of text:", dict(Counter(round(p.wrapper_share, 1) for p in dn)))
    print(
        "  first tags inside:",
        dict(Counter(p.wrapper_first_inside for p in dn).most_common(8)),
    )
    print(
        "  still open when it closed:",
        dict(Counter(p.wrapper_left_open for p in dn).most_common(8)),
    )

    def bucket(n, edges, names):
        for e, name in zip(edges, names, strict=False):
            if n <= e:
                return name
        return names[-1]

    art = [p for p in dn if p.wrapper_first_inside.startswith("article")]
    other = [p for p in dn if p not in art]
    for label, group in (("article-layout", art), ("other", other)):
        print(
            f"  [{label}] n={len(group)}"
            f" id re-shown={sum(p.wrapper_id_shown_by_css for p in group)}"
            f" attr-selector re-shown={sum(p.css_attr_selector_shows for p in group)}"
            f" css display !important={sum(p.css_any_display_important for p in group)}"
        )
        imgs = Counter(
            bucket(p.visible_imgs, [0, 5], ["0", "1-5", ">5"]) for p in group
        )
        links = Counter("0" if p.visible_links == 0 else ">0" for p in group)
        outside = Counter(
            bucket(
                p.visible_chars_outside_wrapper,
                [0, 49, 299],
                ["0", "<50", "<300", "more"],
            )
            for p in group
        )
        print(
            f"    visible imgs {dict(imgs)} links {dict(links)} chars outside {dict(outside)}"
        )
    cuts = [r for r in rows if verdict(r) == "cut_off"]
    print("\ncut_off: cause:", dict(Counter(_cut_cause(r) for r in cuts)))
    print("cut_off: one wrapper hid >=50%:", dict(Counter(_wrapper(r) for r in cuts)))
    ok = [
        r
        for r in rows
        if verdict(r) == "ok" and max(r.html_visible_chars, r.plain_chars)
    ]
    shares = [r.body_chars / max(r.html_visible_chars, r.plain_chars) for r in ok]
    if shares:
        q = statistics.quantiles(shares, n=10)
        print(
            f"\nnon-blank kept share of visible text: p10 {q[0]:.2f}  median {statistics.median(shares):.2f}"
        )
        print(
            "non-blank losing 20-50% of visible text:",
            sum(1 for s in shares if 0.5 <= s < 0.8),
        )
    print("\nsize per stage (sum of non-space chars, html parts):")
    tot = Counter()
    for r in rows:
        for p in r.parts:
            if p.kind == "html":
                tot["payload_bytes"] += p.payload_bytes
                tot["decoded"] += p.decoded_chars
                tot["parse"] += p.parse_chars
                tot["after_skip"] += p.after_skip_chars
                tot["after_hidden"] += p.kept_chars
                for k, n in p.dropped.items():
                    tot[f"dropped:{k}"] += n
    for k, n in sorted(tot.items()):
        print(f"  {k:<28} {n:>10}")
    quote_cut = sum(
        1 for r in rows if r.body_chars and r.newest_chars < 0.3 * r.body_chars
    )
    print(f"\nnewest text < 30% of full (quote removal; classifier only): {quote_cut}")
    if args.save:
        args.save.write_text(
            json.dumps({k: asdict(r) for k, r in reports.items()}), encoding="utf-8"
        )
        print(f"saved numbers to {args.save.name}")


if __name__ == "__main__":
    main()
