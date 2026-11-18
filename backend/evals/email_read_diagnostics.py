"""Where does an email's text go? Per-stage size measurements — numbers only.

For one raw message, measures how much text survives each reading stage and
which rule removed the rest, without returning any of the text itself:

- **decode**: payload bytes → decoded characters (and any charset fallback)
- **parse**: all character data outside comments, ``<script>`` and ``<style>``
  (an upper bound on what a reader could see)
- **skip tags**: after dropping ``<head>``/``<title>``/``<template>``/… content
- **hidden**: after hidden-element removal, with the dropped characters
  attributed to the rule that hid their outermost hidden ancestor
  (``display_none``, ``font_size_0``, ``hidden_attr``, …), whether that element
  was ever closed, and whether one element hid most of the email (a wrapper)
- **normalize** and **newest** (quote removal)
- **plain vs html**: when a text/plain part exists it is used instead of the
  HTML; a plain part much shorter than the HTML's visible text is a likely
  cut-off

Used by ``scripts/email_read_diagnose.py`` on real mail, which prints only
aggregate counts. Pure: no I/O.
"""

from __future__ import annotations

import email
import email.policy
import re
from collections import Counter
from dataclasses import dataclass, field
from html.parser import HTMLParser

from app.services import email_text as et

# The hidden-style rules, split so each removal can be attributed.
STYLE_RULES: dict[str, re.Pattern] = {
    "display_none": re.compile(r"display\s*:\s*none", re.I),
    "visibility_hidden": re.compile(r"visibility\s*:\s*hidden", re.I),
    "mso_hide": re.compile(r"mso-hide\s*:\s*all", re.I),
    "font_size_0": re.compile(
        r"(?<![\w-])font-size\s*:\s*0(?:\.0+)?\s*(?:px|pt|em|rem|%)?\s*(?:;|$|!)", re.I
    ),
    "opacity_0": re.compile(r"(?<![\w-])opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)", re.I),
    "max_height_0": re.compile(r"max-height\s*:\s*0(?:px)?\s*(?:;|$|!)", re.I),
}
_CDATA = {"script", "style"}  # the stdlib parser reads these as raw text


_FONT_SIZE = re.compile(r"(?<![\w-])font-size\s*:", re.I)
# HTML's implied end tags (the subset that matters for email layouts).
_ENDED_BY = {
    "p": {
        "address",
        "article",
        "aside",
        "blockquote",
        "div",
        "dl",
        "fieldset",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "ul",
    },
    "li": {"li"},
    "dt": {"dt", "dd"},
    "dd": {"dt", "dd"},
    "tr": {"tr", "tbody", "thead", "tfoot"},
    "td": {"td", "th", "tr", "tbody", "thead", "tfoot"},
    "th": {"td", "th", "tr", "tbody", "thead", "tfoot"},
    "option": {"option", "optgroup"},
}


def _implies_end(open_tag: str, new_tag: str) -> bool:
    return new_tag in _ENDED_BY.get(open_tag, ())


def _why_hidden(tag: str, attrs: dict) -> str:
    if tag in et._SKIP_TAGS:
        return f"skip_{tag}"
    if "hidden" in attrs:
        return "hidden_attr"
    style = attrs.get("style", "")
    for name, rx in STYLE_RULES.items():
        if rx.search(style):
            return name
    return ""


class _Measure(HTMLParser):
    """Mirrors ``email_text._HtmlToText``'s stack, counting characters."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[list] = []  # [tag, reason, id, font_zero]
        self.next_id = 0
        self.parse_chars = 0  # outside script/style/comments
        self.kept_chars = 0  # what the current reader keeps
        self.dropped: Counter = Counter()  # reason -> chars
        self.by_element: Counter = Counter()  # element id -> chars dropped
        self.reason_of: dict[int, str] = {}
        self.closed: set[int] = set()
        self.tags = 0
        self.stray_closers = 0
        # Structure of hidden elements (no content): tag name, how it ended,
        # and whether a browser would have ended it earlier.
        self.tag_of: dict[int, str] = {}
        self.ended_by: dict[int, str] = {}  # own | ancestor | eof
        self.implied_end_at: dict[int, int] = {}  # chars kept so far when implied
        self.after_implied: Counter = Counter()  # eid -> chars after implied end
        self.font_reset: Counter = Counter()  # font_size_0 eid -> chars under a reset
        self.css: list[str] = []  # <style> contents, for class overrides (not kept)
        self.depth_of: dict[int, int] = {}
        self.props_of: dict[int, str] = {}
        self.classes_of: dict[int, list[str]] = {}
        self.kept_before: dict[int, int] = {}
        self.tags_inside: Counter = Counter()
        self.first_inside: dict[int, list[str]] = {}  # first start tags inside
        self.left_open: dict[int, list[str]] = {}  # popped with it, never closed
        self.ids_of: dict[int, str] = {}
        self.visible_imgs = 0  # <img> outside any hidden element
        self.visible_links = 0

    def handle_starttag(self, tag, attrs):
        self.tags += 1
        a = {k.lower(): (v or "") for k, v in attrs}
        outside = not any(el[1] for el in self.stack)
        if tag == "img" and outside:
            self.visible_imgs += 1
        if tag == "a" and outside:
            self.visible_links += 1
        if tag in et._VOID_TAGS:
            return
        reason = _why_hidden(tag, a)
        # Would a browser implicitly end an open hidden element here?
        for el in self.stack:
            if el[1] and el[2] not in self.implied_end_at and _implies_end(el[0], tag):
                self.implied_end_at[el[2]] = 1
        self.next_id += 1
        fs = _FONT_SIZE.search(a.get("style", ""))
        font_zero = (
            None
            if fs is None
            else bool(STYLE_RULES["font_size_0"].search(a.get("style", "")))
        )
        self.stack.append([tag, reason, self.next_id, font_zero])
        for el in self.stack[:-1]:
            if el[1]:
                self.tags_inside[el[2]] += 1
                first = self.first_inside.setdefault(el[2], [])
                if len(first) < 4:
                    first.append(tag)
        if reason:
            eid = self.next_id
            self.reason_of[eid] = reason
            self.tag_of[eid] = tag
            self.depth_of[eid] = len(self.stack) - 1
            self.props_of[eid] = ",".join(
                sorted(
                    {
                        d.split(":")[0].strip().lower()
                        for d in a.get("style", "").split(";")
                        if ":" in d
                    }
                )
            )
            self.classes_of[eid] = a.get("class", "").split()
            self.ids_of[eid] = a.get("id", "")
            self.kept_before[eid] = self.kept_chars

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if self.stack[i][1]:
                    self.left_open[self.stack[i][2]] = [
                        e[0] for e in self.stack[i + 1 :]
                    ]
                for j, el in enumerate(self.stack[i:]):
                    self.closed.add(el[2])
                    self.ended_by.setdefault(el[2], "own" if j == 0 else "ancestor")
                del self.stack[i:]
                return
        self.stray_closers += 1

    def handle_data(self, data):
        n = sum(1 for ch in data if not ch.isspace())
        if not n:
            return
        top = self.stack[-1][0] if self.stack else ""
        if top in _CDATA:
            if top == "style":
                self.css.append(data)
            return  # code, not text
        self.parse_chars += n
        outer = next((el for el in self.stack if el[1]), None)
        if outer is None:
            self.kept_chars += n
        else:
            self.dropped[outer[1]] += n
            self.by_element[outer[2]] += n
            if outer[2] in self.implied_end_at:
                self.after_implied[outer[2]] += n
            if outer[1] == "font_size_0":
                inner = [el[3] for el in self.stack[self.stack.index(outer) + 1 :]]
                last = next((z for z in reversed(inner) if z is not None), None)
                if last is False:  # a descendant set a visible font size
                    self.font_reset[outer[2]] += n


@dataclass
class PartReport:
    kind: str  # html | plain
    payload_bytes: int = 0
    decoded_chars: int = 0
    decode_issues: tuple[str, ...] = ()
    parse_chars: int = 0  # html: text outside code/comments
    after_skip_chars: int = 0
    kept_chars: int = 0  # after hidden removal (pre-normalize, non-space)
    dropped: dict[str, int] = field(default_factory=dict)
    unclosed_hidden_chars: int = 0  # dropped under a hidden element never closed
    wrapper_reason: str = ""  # one hidden element dropped >= 50% of the text
    wrapper_closed: bool = True
    wrapper_tag: str = ""
    wrapper_ended_by: str = ""  # own | ancestor | eof
    wrapper_share: float = 0.0
    after_implied_end_chars: int = 0  # hidden only because no implied end
    font_reset_chars: int = 0  # hidden by font-size:0 though a child resets it
    wrapper_depth: int = -1
    wrapper_props: str = ""  # style property NAMES on the wrapper
    wrapper_has_class: bool = False
    wrapper_class_shown_by_css: bool = False  # a <style> rule sets display != none
    wrapper_kept_before: int = 0  # visible chars before the wrapper opened
    wrapper_tags_inside: int = 0
    wrapper_first_inside: str = ""  # tag names only
    wrapper_left_open: str = ""  # tag names only
    wrapper_id_shown_by_css: bool = False
    css_attr_selector_shows: bool = False  # e.g. [style*="display:none"]{display:block}
    css_any_display_important: bool = False
    visible_imgs: int = 0
    visible_links: int = 0
    visible_chars_outside_wrapper: int = 0


@dataclass
class MessageReport:
    shape: str
    parts: list[PartReport]
    source: str  # plain | html | none — which part the reader used
    body_chars: int  # what the reader produced (non-space)
    newest_chars: int
    html_visible_chars: int  # best HTML upper bound after skip tags, pre-hidden
    plain_chars: int


def _nonspace(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def _measure_html(markup: str) -> PartReport:
    m = _Measure()
    m.feed(markup)
    m.close()
    skip = sum(v for k, v in m.dropped.items() if k.startswith("skip_"))
    r = PartReport(kind="html")
    r.parse_chars = m.parse_chars
    r.after_skip_chars = m.parse_chars - skip
    r.kept_chars = m.kept_chars
    r.dropped = dict(m.dropped)
    r.unclosed_hidden_chars = sum(
        n for eid, n in m.by_element.items() if eid not in m.closed
    )
    if m.by_element and r.after_skip_chars:
        eid, n = m.by_element.most_common(1)[0]
        reason = m.reason_of.get(eid, "")
        if not reason.startswith("skip_") and n >= 0.5 * r.after_skip_chars:
            r.wrapper_reason = reason
            r.wrapper_closed = eid in m.closed
            r.wrapper_tag = m.tag_of.get(eid, "")
            r.wrapper_ended_by = m.ended_by.get(eid, "eof")
            r.wrapper_share = round(n / r.after_skip_chars, 2)
            r.wrapper_depth = m.depth_of.get(eid, -1)
            r.wrapper_props = m.props_of.get(eid, "")
            classes = m.classes_of.get(eid, [])
            r.wrapper_has_class = bool(classes)
            css = "".join(m.css)
            r.wrapper_class_shown_by_css = any(
                re.search(
                    rf"\.{re.escape(c)}\b[^{{]*\{{[^}}]*display\s*:\s*(?!none)\w",
                    css,
                    re.I,
                )
                for c in classes
            )
            r.wrapper_kept_before = m.kept_before.get(eid, 0)
            r.wrapper_tags_inside = m.tags_inside.get(eid, 0)
            r.wrapper_first_inside = ",".join(m.first_inside.get(eid, []))
            r.wrapper_left_open = ",".join(sorted(set(m.left_open.get(eid, []))))
            wid = m.ids_of.get(eid, "")
            r.wrapper_id_shown_by_css = bool(wid) and bool(
                re.search(
                    rf"#{re.escape(wid)}\b[^{{]*\{{[^}}]*display\s*:\s*(?!none)\w",
                    css,
                    re.I,
                )
            )
            r.css_attr_selector_shows = bool(
                re.search(
                    r"\[style\*?=[^\]]*display[^\]]*\][^{]*\{[^}]*display\s*:\s*(?!none)\w",
                    css,
                    re.I,
                )
            )
            r.css_any_display_important = bool(
                re.search(r"display\s*:\s*(?!none)\w+\s*!important", css, re.I)
            )
            r.visible_chars_outside_wrapper = r.after_skip_chars - n
    r.visible_imgs = m.visible_imgs
    r.visible_links = m.visible_links
    r.after_implied_end_chars = sum(m.after_implied.values())
    r.font_reset_chars = sum(m.font_reset.values())
    return r


def diagnose(raw: bytes) -> MessageReport:
    """Measure one raw RFC822 message. Returns numbers and rule names only."""
    from evals.email_label_export import mime_shape

    msg = email.message_from_bytes(raw)
    plain_parts, html_parts = et._text_parts(msg)
    parts: list[PartReport] = []
    plain_text = []
    for p in plain_parts:
        payload = p.get_payload(decode=True) or b""
        text, issues = et.decode_bytes(payload, p.get_content_charset())
        plain_text.append(text)
        parts.append(
            PartReport(
                kind="plain",
                payload_bytes=len(payload),
                decoded_chars=len(text),
                decode_issues=tuple(sorted(issues)),
                kept_chars=_nonspace(text),
            )
        )
    html_visible = 0
    for p in html_parts:
        payload = p.get_payload(decode=True) or b""
        text, issues = et.decode_bytes(payload, p.get_content_charset())
        r = _measure_html(text)
        r.payload_bytes, r.decoded_chars = len(payload), len(text)
        r.decode_issues = tuple(sorted(issues))
        html_visible += r.after_skip_chars
        parts.append(r)
    read = et.read_message(msg)
    plain_chars = _nonspace(et.normalize("\n\n".join(plain_text)))
    source = "plain" if plain_chars else ("html" if html_parts else "none")
    return MessageReport(
        shape=mime_shape(raw),
        parts=parts,
        source=source,
        body_chars=_nonspace(read.full),
        newest_chars=_nonspace(read.newest),
        html_visible_chars=html_visible,
        plain_chars=plain_chars,
    )


# Likely cut off: the reader kept less than this share of the visible upper
# bound, on an email with at least MIN_VISIBLE visible characters.
CUT_SHARE = 0.5
MIN_VISIBLE = 200


def verdict(r: MessageReport) -> str:
    """blank | cut_off | ok — from sizes only."""
    if r.body_chars == 0:
        return "blank"
    best = max(r.html_visible_chars, r.plain_chars)
    if best >= MIN_VISIBLE and r.body_chars < CUT_SHARE * best:
        return "cut_off"
    return "ok"
