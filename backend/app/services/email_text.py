"""Turn a raw email's MIME parts into clean, readable text.

Pure functions, no I/O: nothing here fetches images, follows links or touches
the network — email HTML is treated as untrusted data and only ever parsed.

The pipeline, per message:

1. **Decode bytes** with the declared charset, falling back to UTF-8, then
   cp1252, then a lossy replace — so a bad or unknown charset can't raise.
2. **HTML → text** with the stdlib parser: scripts, styles and comments are
   dropped, hidden elements (``display:none``, the ``hidden`` attribute, text
   too small to see, …) are skipped, block elements become line breaks, and
   quoted ``<blockquote>`` content is marked with ``>`` like plain-text
   quoting. Two browser rules decide what is really hidden: font size is
   *inherited* (a column that resets ``font-size:16px`` inside a
   ``font-size:0`` layout wrapper is visible; ``1em`` inside it is not), and
   HTML's *implied end tags* apply (a new ``<tr>``/``<td>``/``<li>``, or a
   block inside an open ``<p>``, ends it, and body content ends an unclosed
   ``<head>``) — so one hidden row or preview box can't swallow the rest.
   When an email's text/plain part is a stub much shorter than its HTML's
   visible text, the HTML is read instead.
3. **Normalize**: strip zero-width/invisible characters, map typographic
   quotes and non-breaking spaces to plain ones, tidy whitespace.
4. **Split newest vs full**: ``newest`` drops quoted history (``>`` lines,
   "On … wrote:", Outlook "Original Message" headers); if that leaves almost
   nothing, it falls back to the full text.

Every fallback is recorded as a *read issue* so a scan can report how many
emails were blank, failed, or needed a fallback.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from email.message import Message
from html.parser import HTMLParser

# --------------------------------------------------------------------------- #
# Read issues — what went wrong (or needed a fallback) while reading a message
# --------------------------------------------------------------------------- #
PARSE_FAILED = "parse_failed"  # the message couldn't be read at all
BLANK = "blank"  # readable, but no text was found
NO_TEXT_PART = "no_text_part"  # explains a blank: e.g. attachment-only mail
CHARSET_FALLBACK = "charset_fallback"  # declared charset unknown or wrong
LOSSY_DECODE = "lossy_decode"  # some bytes could only be replaced
QUOTE_FALLBACK = "quote_fallback"  # quote removal left ~nothing; used full text
HTML_CONVERTED = "html_converted"  # informational: text came from HTML
HIDDEN_REMOVED = "hidden_removed"  # informational: hidden HTML text dropped
PLAIN_STUB = "plain_stub"  # text/plain was a stub; the HTML's text was used

# If quote stripping leaves fewer letters/digits than this, use the full text.
_MIN_NEWEST_CHARS = 20
# A text/plain part with under this share of the HTML's visible letters/digits
# (when the HTML has at least _STUB_MIN_HTML of them) is a stub.
_STUB_SHARE = 0.5
_STUB_MIN_HTML = 200


@dataclass(frozen=True)
class ReadText:
    full: str  # whole cleaned body, quoted history included
    newest: str  # just the newest reply (or ``full`` when stripping fails)
    issues: tuple[str, ...] = ()


# --------------------------------------------------------------------------- #
# Charset decoding
# --------------------------------------------------------------------------- #
def decode_bytes(payload: bytes, declared: str | None) -> tuple[str, set[str]]:
    """Decode with the declared charset, else UTF-8, else cp1252, else lossy."""
    issues: set[str] = set()
    if declared:
        try:
            return payload.decode(declared), issues
        except LookupError:  # unknown charset name (e.g. "x-unknown")
            issues.add(CHARSET_FALLBACK)
        except UnicodeDecodeError:  # mislabeled (e.g. "us-ascii" with UTF-8)
            issues.add(CHARSET_FALLBACK)
    for codec in ("utf-8", "cp1252"):
        try:
            text = payload.decode(codec)
        except UnicodeDecodeError:
            continue
        if declared is None and codec != "utf-8":
            issues.add(CHARSET_FALLBACK)
        return text, issues
    issues |= {CHARSET_FALLBACK, LOSSY_DECODE}
    return payload.decode("utf-8", "replace"), issues


# --------------------------------------------------------------------------- #
# HTML → text
# --------------------------------------------------------------------------- #
_SKIP_TAGS = {"script", "style", "head", "title", "template", "noscript", "svg"}
_VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
}
_BLOCK_TAGS = {
    "address",
    "article",
    "aside",
    "blockquote",
    "dd",
    "div",
    "dl",
    "dt",
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
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "thead",
    "tfoot",
    "tr",
    "ul",
}
_CELL_TAGS = {"td", "th"}
# Inline styles that make an element and everything inside it invisible.
# (Font size is handled separately: it is inherited, and a child can undo it.)
_HIDDEN_STYLE = re.compile(
    r"display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|"
    r"(?<![\w-])opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|"
    r"max-height\s*:\s*0(?:px)?\s*(?:;|$|!)",
    re.I,
)
_FONT_SIZE = re.compile(r"(?<![\w-])font-size\s*:\s*([^;]+)", re.I)
_LENGTH = re.compile(r"^(-?\d*\.?\d+)\s*([a-z%]*)$", re.I)
_ROOT_PX = 16.0
# Text rendered smaller than this is unreadable — treated as hidden (this also
# catches "font-size:1px" tricks, not only zero).
_MIN_VISIBLE_PX = 4.0
_FONT_KEYWORDS = {
    "xx-small": 9.0,
    "x-small": 10.0,
    "small": 13.0,
    "medium": 16.0,
    "large": 18.0,
    "x-large": 24.0,
    "xx-large": 32.0,
    "xxx-large": 48.0,
}
_ABS_UNITS = {"px": 1.0, "": 1.0, "pt": 4 / 3, "pc": 16.0, "in": 96.0}
_ABS_UNITS |= {"cm": 96 / 2.54, "mm": 96 / 25.4, "q": 96 / 101.6}


def _font_px(style: str, parent: float) -> float:
    """The computed font size in px, given the parent's (CSS inheritance).
    Relative units scale the parent, so ``1em`` inside ``font-size:0`` stays 0;
    an unknown value keeps the parent's size. Unitless numbers count as px, as
    in the quirks mode most email HTML renders in."""
    found = _FONT_SIZE.findall(style or "")
    if not found:
        return parent
    value = found[-1].split("!")[0].strip().lower()
    if value in _FONT_KEYWORDS:
        return _FONT_KEYWORDS[value]
    if value in ("inherit", "unset"):
        return parent
    if value == "initial":
        return _ROOT_PX
    if value == "smaller":
        return parent / 1.2
    if value == "larger":
        return parent * 1.2
    m = _LENGTH.match(value)
    if not m:
        return parent  # calc(), vw, var(): unknown — assume unchanged
    n, unit = float(m.group(1)), m.group(2).lower()
    if unit in _ABS_UNITS:
        return n * _ABS_UNITS[unit]
    if unit == "em":
        return n * parent
    if unit == "%":
        return n / 100 * parent
    if unit == "rem":
        return n * _ROOT_PX
    if unit in ("ex", "ch"):
        return n * 0.5 * parent
    return parent


# HTML's implied end tags: an open element (key) is ended by these start tags.
_P_ENDERS = {
    "address", "article", "aside", "blockquote", "center", "details", "dialog",
    "dir", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu",
    "nav", "ol", "p", "pre", "section", "summary", "table", "ul",
}  # fmt: skip
_ENDED_BY = {
    "p": _P_ENDERS,
    "li": {"li"},
    "dt": {"dt", "dd"},
    "dd": {"dt", "dd"},
    "option": {"option", "optgroup"},
    "tr": {"tr", "tbody", "thead", "tfoot"},
    "td": {"td", "th", "tr", "tbody", "thead", "tfoot"},
    "th": {"td", "th", "tr", "tbody", "thead", "tfoot"},
    "thead": {"tbody", "tfoot"},
    "tbody": {"tbody", "tfoot"},
}
# An implied end never reaches past these (the element is in another scope).
_SCOPE = {"table", "td", "th", "caption", "html", "body", "button", "template"}
_LIST_SCOPE = {"ul", "ol"}
# What may appear in <head>; anything else ends an unclosed <head>.
_HEAD_CONTENT = {
    "meta",
    "link",
    "style",
    "script",
    "title",
    "base",
    "noscript",
    "template",
}
# Gmail/Outlook/Apple wrappers around quoted history.
_QUOTE_CLASS = re.compile(r"gmail_quote|yahoo_quoted|moz-cite-prefix|divRplyFwdMsg")


class _HtmlToText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        # (tag, hidden, quoted, font_px) for each open non-void element;
        # ``font_px`` is the element's computed (inherited) font size.
        self.stack: list[tuple[str, bool, bool, float]] = []
        self.hidden_removed = False

    @property
    def _font(self) -> float:
        return self.stack[-1][3] if self.stack else _ROOT_PX

    @property
    def _hidden(self) -> bool:
        return any(h for _, h, _, _ in self.stack) or self._font < _MIN_VISIBLE_PX

    @property
    def _quoted(self) -> bool:
        return any(q for _, _, q, _ in self.stack)

    def _newline(self) -> None:
        self.out.append("\n")

    def _end_implied(self, tag: str) -> None:
        """Close what a browser closes before ``tag`` starts: an open <p> for a
        block, a sibling <li>/<tr>/<td>, an unclosed <head> for body content."""
        while self.stack:
            for i in range(len(self.stack) - 1, -1, -1):
                open_tag = self.stack[i][0]
                if open_tag == "head" and tag not in _HEAD_CONTENT:
                    break
                if tag in _ENDED_BY.get(open_tag, ()):
                    break
                if open_tag in _SCOPE or (open_tag in _LIST_SCOPE and tag == "li"):
                    return
            else:
                return
            if open_tag in _BLOCK_TAGS:
                self._newline()
            del self.stack[i:]

    def handle_starttag(self, tag, attrs):
        self._end_implied(tag)
        a = {k.lower(): (v or "") for k, v in attrs}
        style = a.get("style", "")
        hidden = tag in _SKIP_TAGS or "hidden" in a or bool(_HIDDEN_STYLE.search(style))
        quoted = tag == "blockquote" or bool(_QUOTE_CLASS.search(a.get("class", "")))
        if tag == "br":
            if not self._hidden:
                self._newline()
            return
        if tag in _VOID_TAGS:  # images are never fetched; alt text is ignored
            if tag == "hr" and not self._hidden:
                self._newline()
            return
        if tag in _BLOCK_TAGS:
            self._newline()
        elif tag in _CELL_TAGS:
            self.out.append(" ")
        self.stack.append((tag, hidden, quoted, _font_px(style, self._font)))

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self._hidden:
            self._newline()

    def handle_endtag(self, tag):
        # Pop back to the matching open tag; ignore stray closers. Unclosed
        # inner tags (<p>, <li>, <td>) are closed implicitly.
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        else:
            return
        if tag in _BLOCK_TAGS:
            self._newline()

    def handle_data(self, data):
        if self._hidden:
            if data.strip():
                self.hidden_removed = True
            return
        if self._quoted:
            data = data.replace("\n", "\n> ")
            if not self.out or self.out[-1].endswith("\n"):
                data = "> " + data.lstrip()
        self.out.append(data)

    def handle_comment(self, data):  # comments are never shown
        pass


def html_to_text(markup: str) -> tuple[str, bool]:
    """Visible text of an HTML document, plus whether hidden text was dropped."""
    parser = _HtmlToText()
    parser.feed(markup)
    parser.close()
    return "".join(parser.out), parser.hidden_removed


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #
# Zero-width and other invisible format characters used to pad or obfuscate.
_INVISIBLE = re.compile("[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ﻿ﾠ]")
_TYPOGRAPHIC = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "′": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        " ": " ",
        " ": " ",
        " ": " ",
        " ": " ",
        "　": " ",
    }
)
_SPACES = re.compile(r"[ \t\f\v]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def normalize(text: str) -> str:
    """Strip invisible characters, plain-ify quotes/spaces, tidy whitespace."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _INVISIBLE.sub("", unicodedata.normalize("NFC", text))
    text = text.translate(_TYPOGRAPHIC)
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def clean_header(value: str) -> str:
    """A decoded header (subject/from) without invisible chars or line folds."""
    return _SPACES.sub(" ", _INVISIBLE.sub("", value or "").replace("\n", " ")).strip()


# --------------------------------------------------------------------------- #
# Newest reply vs quoted history
# --------------------------------------------------------------------------- #
_REPLY_HEADER = re.compile(
    # Gmail/Apple: "On Mon, … wrote:", possibly wrapped onto a second line.
    r"^(?:On\b[^\n]{0,250}(?:\n[^\n]{0,250})?\bwrote:[ \t]*$"
    r"|-{2,}[ \t]*Original Message[ \t]*-{2,}"  # Outlook
    r"|-{2,}[ \t]*Forwarded message[ \t]*-{2,}"
    r"|Begin forwarded message:"
    r"|_{10,}[ \t]*$"  # Outlook's separator line before "From:"
    r"|From:[^\n]*\n(?:Sent|Date):)",
    re.I | re.M,
)


def newest_text(full: str) -> str:
    """The reply above any quoted history (may be empty)."""
    m = _REPLY_HEADER.search(full)
    head = full[: m.start()] if m else full
    kept = [line for line in head.split("\n") if not line.lstrip().startswith(">")]
    return _BLANK_LINES.sub("\n\n", "\n".join(kept)).strip()


def _meaningful(text: str) -> int:
    return sum(ch.isalnum() for ch in text)


# --------------------------------------------------------------------------- #
# Message → ReadText
# --------------------------------------------------------------------------- #
def _text_parts(msg: Message) -> tuple[list[Message], list[Message]]:
    plain, html = [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        disp = str(part.get("Content-Disposition", "")).lower()
        if "attachment" in disp:
            continue
        ctype = part.get_content_type()
        if ctype == "text/plain":
            plain.append(part)
        elif ctype == "text/html":
            html.append(part)
    return plain, html


def _decode_part(part: Message, issues: set[str]) -> str:
    payload = part.get_payload(decode=True)
    if not payload:
        return ""
    text, part_issues = decode_bytes(payload, part.get_content_charset())
    issues |= part_issues
    return text


def read_message(msg: Message) -> ReadText:
    """Extract clean full + newest text from a parsed message. Never raises
    for bad content; unexpected errors surface to the caller's isolation."""
    issues: set[str] = set()
    plain_parts, html_parts = _text_parts(msg)

    full = normalize("\n\n".join(_decode_part(p, issues) for p in plain_parts))
    if html_parts:
        html_issues: set[str] = set()
        chunks = []
        for part in html_parts:
            text, hidden = html_to_text(_decode_part(part, html_issues))
            chunks.append(text)
            if hidden:
                html_issues.add(HIDDEN_REMOVED)
        html_full = normalize("\n\n".join(chunks))
        # Use the HTML when there is no plain text, or the plain part is a stub
        # ("view this email in your browser") next to a real HTML body.
        stub = bool(full) and (
            _meaningful(html_full) >= _STUB_MIN_HTML
            and _meaningful(full) < _STUB_SHARE * _meaningful(html_full)
        )
        if not full or stub:
            full = html_full
            issues |= html_issues | {HTML_CONVERTED}
            if stub:
                issues.add(PLAIN_STUB)

    if not full:
        issues.add(BLANK)
        if not plain_parts and not html_parts:
            issues.add(NO_TEXT_PART)
        return ReadText("", "", tuple(sorted(issues)))

    newest = newest_text(full)
    if newest != full and _meaningful(newest) < _MIN_NEWEST_CHARS:
        newest = full  # stripping quotes left ~nothing: keep everything
        issues.add(QUOTE_FALLBACK)
    return ReadText(full, newest, tuple(sorted(issues)))
