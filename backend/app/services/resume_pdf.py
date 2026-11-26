"""The PDF maker for written documents (résumés, cover letters).

Markdown in the layout the writers are told to use becomes a letter-size PDF
drawn in the owner's master résumé template (spec 025): a navy name with a
thick navy rule under the header, a blue title line, grey contact text, section
headings on a light-blue rule, a two-column skills table, job headers with the
dates on the right, blue sub-headings, core-areas boxes, and "Page X of Y".

The layout (every piece is optional, so older résumés still render)::

    # Full Name
    > Title line
    City, ST · phone · email · links

    ## SUMMARY
    A paragraph.

    ## CORE AREAS            (boxes side by side; the master's, not a job's)
    ### Box title
    a short list

    ## SKILLS
    **Label:** items, items   (a table row)

    ## EXPERIENCE
    **Job Title** · Company | Sep 2024 – Present
    ### Group                 (a blue sub-heading)
    - Bullet

    **Company** | *Job Title* | 2019 – 2021     (the older layout, same look)

Uses fpdf2 — pure Python, so it works on Windows and free-tier Linux with no
native GTK/Cairo libraries (which is why weasyprint was dropped). Moved out of
``api/v1/ai.py`` (spec 022) so a résumé made for a job can be stored as a real
PDF file. Text stays real text in reading order, so applicant tracking systems
can read it.
"""

import logging
import re
from pathlib import Path

from fpdf.errors import FPDFException

logger = logging.getLogger(__name__)

_FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
# A trailing employment date range on a job-header line — used to right-align it,
# the way a real resume does ("Company | Title ............ Sep 2024 – Present").
_DATE_RE = re.compile(
    r"((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{4})"
    r"\s*(?:–|—|-|to)\s*"
    r"((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{4}"
    r"|present|current|now)\s*$",
    re.I,
)
# "**Label:** items" (or "**Label**: items") — one skills-table row.
_LABEL_RE = re.compile(r"^\*\*([^*]+?):\*\*\s*(.*)$|^\*\*([^*]+?)\*\*:\s*(.*)$")
# The parts of a header line: "a | b" (the older layout) or "a · b".
_PART_SPLIT = re.compile(r"\s*\|\s*|\s+·\s+")
# Sections whose entries are jobs or projects: the big header (title in 11 pt,
# company in blue). Other sections (education, certifications, coursework) get
# a compact one. Matched on the whole name, so "RELEVANT COURSEWORK" isn't WORK.
_BIG_SECTION = re.compile(
    r"(?:[A-Z&/,\- ]+ )?(?:EXPERIENCE|EMPLOYMENT|PROJECTS?|VOLUNTEERING|LEADERSHIP)"
    r"|(?:WORK|EMPLOYMENT|CAREER|PROFESSIONAL) HISTORY"
)
# The dates column never takes more than this share of the line.
_RIGHT_MAX = 0.35

# The template, measured from the owner's master résumé (sizes in points).
NAVY = (30, 58, 138)  # #1E3A8A: name, header rule, section headings, labels
BLUE = (37, 99, 235)  # #2563EB: title line, companies, sub-headings
GREY = (75, 85, 99)  # #4B5563: contact text
MUTED = (107, 114, 128)  # #6B7280: dates, footer
INK = (17, 24, 39)  # #111827: job titles
TEXT = (31, 41, 55)  # #1F2937: body text
BOX_TEXT = (55, 65, 81)  # #374151: core-areas box text
BAR = (191, 219, 254)  # #BFDBFE: the rule under a section heading
LINE = (229, 231, 235)  # #E5E7EB: skills-table rows, box borders
BOX = (248, 250, 252)  # #F8FAFC: core-areas boxes
MARGIN_X, MARGIN_Y = 43.2, 36.0
BODY, LH = 10.3, 13.0  # body text size and line height
LABEL_W = 118.5  # the skills table's label column


def _register_fonts(pdf) -> str:
    """Embed Carlito (the open, Calibri-metric font) so PDFs match the user's
    Calibri resume everywhere. Falls back to Helvetica if the files are missing."""
    try:
        pdf.add_font("Carlito", "", str(_FONT_DIR / "Carlito-Regular.ttf"))
        pdf.add_font("Carlito", "B", str(_FONT_DIR / "Carlito-Bold.ttf"))
        pdf.add_font("Carlito", "I", str(_FONT_DIR / "Carlito-Italic.ttf"))
        pdf.add_font("Carlito", "BI", str(_FONT_DIR / "Carlito-BoldItalic.ttf"))
        return "Carlito"
    except Exception:  # pragma: no cover - font files ship with the app
        return "Helvetica"


def _strip_md(s: str) -> str:
    """Remove all inline markers (used where we set the font style ourselves)."""
    return s.replace("`", "").replace("**", "").replace("*", "")


def _md_inline(s: str) -> str:
    """Keep **bold** (fpdf renders it) but drop single-* italics + backticks so
    they don't show as literal asterisks in body text."""
    s = s.replace("`", "").replace("**", "\x00").replace("*", "")
    return s.replace("\x00", "**")


def _label_row(s: str) -> tuple[str, str] | None:
    """("Label", "items") for a one-label "**Label:** items" line, else None."""
    m = _LABEL_RE.match(s)
    if not m or s.count("**") != 2:
        return None
    label, items = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    return label.strip(), items.strip()


def _split_header(s: str) -> tuple[list[str], str | None] | None:
    """A job/school/certification header → (left parts, right text), else None.

    The right text is only the trailing date range (whatever comes before it in
    the same part stays on the left), or (after a "|") a short unmarked note
    such as "In progress". A header starts bold, or has "|" / "·" parts and
    ends with a date range; a plain sentence that ends in years is not one."""
    if _label_row(s) or s.startswith(("- ", "* ")):
        return None
    bold = s.startswith("**")
    has_parts = bool(re.search(r"\|", s) or re.search(r"\s·\s", s))
    if not bold and not has_parts:
        return None
    right = None
    if m := _DATE_RE.search(s):
        right, s = s[m.start() :].strip(), s[: m.start()].rstrip(" ,·|–—-")
    else:
        pipe = re.split(r"\s*\|\s*", s)
        last = pipe[-1].strip()
        if len(pipe) > 1 and "*" not in last and 0 < len(last) <= 40:
            right, s = last, " | ".join(pipe[:-1])
    if bold and right is None and not has_parts:
        return None  # a bold sentence, not a header
    if not bold and (right is None or len(s) > 100 or not _DATE_RE.search(right)):
        return None
    parts = [p.strip() for p in _PART_SPLIT.split(s) if p.strip()]
    return (parts, right) if parts else None


def _parse(text: str) -> list[dict]:
    """The Markdown as a list of blocks: {"kind", "text", ...}."""
    blocks: list[dict] = []
    lines = text.replace("\r\n", "\n").split("\n")
    in_header = False
    section = ""
    blank = False
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        i += 1
        if not s:
            if in_header:
                in_header = False
                blocks.append({"kind": "rule"})
            blank = True
            continue
        if s.startswith("# ") and not s.startswith("## "):
            blocks.append({"kind": "name", "text": _strip_md(s[2:])})
            in_header = True
            blank = False
            continue
        if s.startswith("## "):
            if in_header:
                in_header = False
                blocks.append({"kind": "rule"})
            section = _strip_md(s[3:]).strip().upper()
            blocks.append({"kind": "section", "text": section})
            blank = False
            if section == "CORE AREAS":
                # "### Box" + its lines, up to the next "## " heading.
                boxes: list[dict] = []
                while i < len(lines) and not lines[i].strip().startswith(("## ", "# ")):
                    t = lines[i].strip()
                    i += 1
                    if t.startswith("### "):
                        boxes.append({"title": _strip_md(t[4:]), "lines": []})
                    elif t and boxes:
                        boxes[-1]["lines"].append(_strip_md(t.lstrip("-* ")))
                    elif t:
                        boxes.append({"title": "", "lines": [_strip_md(t)]})
                if boxes:
                    blocks.append({"kind": "boxes", "boxes": boxes})
            continue
        if re.fullmatch(r"[-*_ ]{3,}", s):
            continue  # a Markdown horizontal rule: the template draws its own
        if s.startswith("> "):
            blocks.append({"kind": "title", "text": _strip_md(s[2:])})
        elif in_header:
            contact = re.sub(r"\s+\|\s+", " · ", _strip_md(s))
            blocks.append({"kind": "contact", "text": contact})
        elif s.startswith(("### ", "#### ")):
            blocks.append({"kind": "group", "text": _strip_md(s.lstrip("#").strip())})
        elif s.startswith(("- ", "* ", "• ")):
            blocks.append({"kind": "bullet", "text": _md_inline(s[2:])})
        elif row := _label_row(s):
            blocks.append(
                {"kind": "row", "label": _strip_md(row[0]), "text": _md_inline(row[1])}
            )
        elif head := _split_header(s):
            big = bool(_BIG_SECTION.fullmatch(section))
            blocks.append(
                {"kind": "entry", "parts": head[0], "right": head[1], "big": big}
            )
        else:
            blocks.append({"kind": "para", "text": s, "blank": blank})
        blank = False
    if in_header:
        blocks.append({"kind": "rule"})
    return blocks


def _render_markdown(pdf, text: str) -> None:
    """Draw the Markdown in the master's template onto ``pdf`` (any unit).

    fpdf2 has no CSS, so page-break rules are applied by measuring blocks first:
    a section heading or job/project/education header is never left alone at the
    bottom of a page (it moves down with its first line), a bullet or a table
    row is never split across pages, and the dates sit on their header's line."""
    from fpdf.enums import MethodReturnValue, XPos, YPos

    FONT = _register_fonts(pdf)
    pdf.c_margin = 0  # text sits exactly on the margins, like the master
    k = pdf.k  # points per user unit: every size below is in points

    def u(pt: float) -> float:
        return pt / k

    def font(style: str = "", size: float = BODY, color=TEXT) -> None:
        pdf.set_font(FONT, style, size)
        pdf.set_text_color(*color)

    font()
    BULLET_X = u(3)
    # The text starts ~10.5 pt in, like the master, with a clear gap after the
    # dot (so text readers see "•" as its own word).
    BULLET_W = max(u(7.5), pdf.get_string_width("•") + u(3.5))
    blocks = _parse(text)
    # A right-hand note too wide for the dates column (35% of the line) joins
    # the left text instead, so the title always has room and nothing overlaps.
    for b in blocks:
        if b["kind"] == "entry" and b.get("right"):
            pdf.set_font(FONT, "", 9.6)
            if pdf.get_string_width(b["right"]) + u(10) > pdf.epw * _RIGHT_MAX:
                b["parts"].append(b["right"])
                b["right"] = None
    font()

    def lines_of(
        txt: str, w: float, style: str = "", size: float = BODY, md=True
    ) -> int:
        pdf.set_font(FONT, style, size)
        rows = pdf.multi_cell(
            w, u(LH), txt, markdown=md, dry_run=True, output=MethodReturnValue.LINES
        )
        return max(1, len(rows))

    def right_w(b: dict) -> float:
        if not b.get("right"):
            return 0
        pdf.set_font(FONT, "", 9.6)
        return pdf.get_string_width(b["right"]) + u(10)

    def entry_lines(b: dict) -> int:
        joined = " · ".join(_strip_md(p) for p in b["parts"])
        return lines_of(
            joined, pdf.epw - right_w(b), "B", 11 if b["big"] else BODY, md=False
        )

    def box_h(box: dict, w: float) -> float:
        h = u(6.5 + 14 + 6.5)
        for ln in box["lines"]:
            h += lines_of(ln, w - u(13), size=9.4, md=False) * u(12.6)
        return h if box["title"] else h - u(14)

    def height(b: dict, full: bool = True) -> float:
        """Height of block ``b`` (its gap above included). ``full=False`` is the
        part that must stay with the header above it: two lines at most."""
        kind = b["kind"]
        if kind == "section":
            return u(6 + 14.6 + 0.8 + 3.6)
        if kind == "entry":
            lh = 14 if b["big"] else 14.3
            return u(5) + entry_lines(b) * u(lh)
        if kind == "group":
            return u(4) + lines_of(b["text"], pdf.epw, "B") * u(LH + 1)
        if kind == "bullet":
            n = lines_of(b["text"], pdf.epw - BULLET_X - BULLET_W)
            return u(1) + min(n, 99 if full else 2) * u(LH)
        if kind == "row":
            n = max(
                lines_of(b["label"], u(LABEL_W - 6), "B", md=False),
                lines_of(b["text"], pdf.epw - u(LABEL_W)),
            )
            return u(2.6 + 0.6 + 3) + n * u(LH)
        if kind == "boxes":
            n = min(4, len(b["boxes"]))
            w = (pdf.epw - u(10.4) * (n - 1)) / n
            return u(8) + max(box_h(x, w) for x in b["boxes"][:n])
        if kind == "para":
            n = lines_of(_md_inline(b["text"]), pdf.epw)
            return u(7 if b.get("blank") else 0) + min(n, 99 if full else 2) * u(LH)
        return 0

    def keep_together(h: float) -> bool:
        """break-inside/break-after: avoid — start a new page now if the next
        ``h`` won't fit, unless we're already at the top of a page. True when
        the block now starts a page (so it drops its gap above)."""
        top = pdf.t_margin + 0.01
        if pdf.get_y() + h > pdf.page_break_trigger and pdf.get_y() > top:
            pdf.add_page()
        return pdf.get_y() <= top

    def gap(pt: float, fresh: bool) -> None:
        if not fresh and pt:
            pdf.ln(u(pt))

    def with_next(i: int) -> float:
        """Block ``i`` plus what must follow it onto the same page."""
        h = height(blocks[i])
        if i + 1 < len(blocks):
            nxt = blocks[i + 1]
            if nxt["kind"] in ("bullet", "para", "row", "boxes"):
                h += height(nxt, full=False)
            elif nxt["kind"] in ("entry", "group") and blocks[i]["kind"] != "group":
                h += height(nxt)
                if i + 2 < len(blocks) and blocks[i + 2]["kind"] in (
                    "bullet",
                    "para",
                    "row",
                ):
                    h += height(blocks[i + 2], full=False)
        return h

    def runs(segments: list[tuple[str, str, float, tuple]], h: float) -> None:
        """Write styled pieces on one wrapping line (left-aligned)."""
        for txt, style, size, color in segments:
            font(style, size, color)
            pdf.write(h, txt)

    def draw_entry(b: dict, fresh: bool) -> None:
        big = b["big"]
        lh = u(14 if big else 14.3)
        if prev_section:
            gap(1.5, fresh)
        elif big:
            gap(6, fresh)
        else:
            gap(0 if prev_kind == "entry" else 3, fresh)
        y, page = pdf.get_y(), pdf.page
        rw = right_w(b)
        old_r = pdf.r_margin
        pdf.set_right_margin(old_r + rw)  # the left text never runs into the dates
        pdf.set_x(pdf.l_margin)
        segs: list[tuple[str, str, float, tuple]] = []
        for n, part in enumerate(b["parts"]):
            txt = _strip_md(part)
            if n == 0:
                segs.append((txt, "B", 11 if big else BODY, INK))
                continue
            segs.append((" · ", "", BODY, TEXT))
            segs.append((txt, "B", BODY, BLUE) if big else (txt, "", BODY, TEXT))
        runs(segs, lh)
        pdf.set_right_margin(old_r)
        end_y = pdf.get_y() + lh
        if b.get("right"):
            if pdf.page != page:
                y = pdf.get_y()  # wrapped onto a new page: the date goes there
            font("", 9.6, MUTED)
            pdf.set_xy(pdf.l_margin, y)
            pdf.cell(0, lh, b["right"], align="R")
        pdf.set_xy(pdf.l_margin, end_y)
        font()

    def draw_boxes(b: dict, fresh: bool) -> None:
        boxes = b["boxes"]
        first = True
        for start in range(0, len(boxes), 4):
            row = boxes[start : start + 4]
            n = len(row)
            w = (pdf.epw - u(10.4) * (n - 1)) / n
            h = max(box_h(x, w) for x in row)
            fresh_row = keep_together(u(8) + h)
            gap(4 if first else 8, fresh and first or fresh_row)
            first = False
            y = pdf.get_y()
            for c, box in enumerate(row):
                x = pdf.l_margin + c * (w + u(10.4))
                pdf.set_fill_color(*BOX)
                pdf.set_draw_color(*LINE)
                pdf.set_line_width(u(0.75))
                pdf.rect(x, y, w, h, style="DF", round_corners=True, corner_radius=u(4))
                pdf.set_xy(x + u(6.5), y + u(6.5))
                if box["title"]:
                    font("B", 10, NAVY)
                    pdf.multi_cell(
                        w - u(13),
                        u(14),
                        box["title"],
                        align="L",
                        new_x=XPos.LEFT,
                        new_y=YPos.NEXT,
                    )
                font("", 9.4, BOX_TEXT)
                for ln in box["lines"]:
                    pdf.multi_cell(
                        w - u(13),
                        u(12.6),
                        ln,
                        align="L",
                        new_x=XPos.LEFT,
                        new_y=YPos.NEXT,
                    )
            pdf.set_xy(pdf.l_margin, y + h)
        font()

    prev_section = False
    for i, b in enumerate(blocks):
        kind = b["kind"]
        prev_kind = blocks[i - 1]["kind"] if i else ""

        if kind == "name":
            font("B", 24, NAVY)
            pdf.multi_cell(
                0, u(30), b["text"], align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
        elif kind == "title":
            font("B", 11.5, BLUE)
            pdf.multi_cell(
                0, u(15), b["text"], align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
            pdf.ln(u(2.6))
        elif kind == "contact":
            font("", 9.6, GREY)
            pdf.multi_cell(
                0, u(12), b["text"], align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
        elif kind == "rule":
            # The header's thick navy rule, full width.
            pdf.ln(u(5))
            pdf.set_fill_color(*NAVY)
            pdf.rect(pdf.l_margin, pdf.get_y(), pdf.epw, u(2.3), style="F")
            nxt = blocks[i + 1]["kind"] if i + 1 < len(blocks) else ""
            # A section heading brings its own gap; a letter's text needs one.
            pdf.ln(u(2.3 + (1.5 if nxt == "section" else 12)))
            prev_section = True
            continue
        elif kind == "section":
            # Keep the heading with its first entry (and that entry's first
            # line) so it never sits alone at the bottom of a page.
            fresh = keep_together(with_next(i))
            gap(0 if prev_section else 6, fresh)
            font("B", 10.5, NAVY)
            pdf.set_char_spacing(1)
            pdf.cell(0, u(14.6), b["text"], new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_char_spacing(0)
            pdf.set_fill_color(*BAR)
            pdf.rect(pdf.l_margin, pdf.get_y(), pdf.epw, u(0.8), style="F")
            pdf.ln(u(0.8 + 3.6))
            font()
            prev_section = True
            continue
        elif kind == "boxes":
            draw_boxes(b, prev_section)
        elif kind == "entry":
            fresh = keep_together(with_next(i))
            draw_entry(b, fresh)
        elif kind == "group":
            fresh = keep_together(with_next(i))
            gap(0 if prev_section else 4, fresh)
            font("B", BODY, BLUE)
            pdf.multi_cell(
                0, u(LH + 1), b["text"], align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
            font()
        elif kind == "bullet":
            fresh = keep_together(height(b))  # a bullet never splits
            gap(1 if prev_kind == "bullet" else 0, fresh)
            # Hanging indent: the dot sits in its own cell and the text wraps
            # under itself, not under the dot. Left-aligned (ragged right), not
            # justified, so word spacing stays even.
            font()
            pdf.set_x(pdf.l_margin + BULLET_X)
            pdf.cell(BULLET_W, u(LH), "•")
            pdf.multi_cell(
                0,
                u(LH),
                b["text"],
                align="L",
                markdown=True,
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
        elif kind == "row":
            # A skills-table row: bold navy label left, items right, a thin
            # grey line under it.
            fresh = keep_together(height(b) - u(3))
            gap(0 if prev_section or prev_kind == "row" else 3, fresh)
            y = pdf.get_y() + u(2.6)
            font("B", BODY, NAVY)
            pdf.set_xy(pdf.l_margin, y)
            pdf.multi_cell(
                u(LABEL_W - 6),
                u(LH),
                b["label"],
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            y1 = pdf.get_y()
            font()
            pdf.set_xy(pdf.l_margin + u(LABEL_W), y)
            pdf.multi_cell(
                0,
                u(LH),
                b["text"],
                markdown=True,
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            y2 = max(y1, pdf.get_y()) + u(0.6)
            pdf.set_draw_color(*LINE)
            pdf.set_line_width(u(0.375))
            pdf.line(pdf.l_margin, y2, pdf.l_margin + pdf.epw, y2)
            pdf.set_xy(pdf.l_margin, y2)
        else:  # para
            fresh = keep_together(height(b, full=False))
            gap(7 if b.get("blank") and prev_kind in ("para", "bullet") else 0, fresh)
            gap(3 if prev_kind == "row" else 0, fresh)
            segs = re.split(r"(\*\*[^*]+\*\*)", b["text"])
            labels = [s for s in segs if s.startswith("**")]
            if labels and all(s[2:-2].rstrip().endswith(":") for s in labels):
                # "**Languages:** English. **Work:** authorized" — navy labels inline.
                pdf.set_x(pdf.l_margin)
                runs(
                    [
                        (s[2:-2], "B", BODY, NAVY)
                        if s.startswith("**")
                        else (_md_inline(s), "", BODY, TEXT)
                        for s in segs
                        if s
                    ],
                    u(LH),
                )
                pdf.ln(u(LH))
            else:
                font()
                pdf.multi_cell(
                    0,
                    u(LH),
                    _md_inline(b["text"]),
                    align="L",
                    markdown=True,
                    new_x=XPos.LMARGIN,
                    new_y=YPos.NEXT,
                )
        prev_section = False
    font()


def render_pdf(text: str) -> bytes:
    """Markdown → the PDF's bytes, in the master's template.

    Drawn twice: the first pass counts the pages so the footer can say
    "Page 1 of 2" exactly (a one-page document has no footer)."""
    return _output(text, _render_markdown)


# A cover letter's body (spec 031): a touch larger than a résumé's, with room
# between paragraphs.
LETTER_SIZE, LETTER_LH, LETTER_GAP = 10.8, 14.6, 8.0


def render_letter_pdf(header: str, body: str, date_line: str = "") -> bytes:
    """A cover letter in the résumé's look: the same header (name, title line,
    contact, navy rule) drawn from ``header`` Markdown, then the date and the
    letter's paragraphs as plain text. A blank line starts a new paragraph; a
    single line break stays one (a sign-off keeps its two lines)."""

    def draw(pdf, _text: str) -> None:
        _render_markdown(pdf, header)
        _render_letter_body(pdf, body, date_line)

    return _output(f"{header}\n\n{date_line}\n\n{body}", draw)


def _render_letter_body(pdf, body: str, date_line: str) -> None:
    from fpdf.enums import XPos, YPos

    family = "Carlito" if "carlito" in pdf.fonts else "Helvetica"
    k = pdf.k
    pdf.c_margin = 0
    if date_line:
        pdf.set_font(family, "", 9.6)
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 12 / k, date_line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(LETTER_GAP / k)
    pdf.set_font(family, "", LETTER_SIZE)
    pdf.set_text_color(*TEXT)
    gap = False
    for raw in (body or "").replace("\r\n", "\n").split("\n"):
        line = _strip_md(raw.strip())
        if not line:
            gap = True
            continue
        if gap and pdf.get_y() > pdf.t_margin + 0.01:
            pdf.ln(LETTER_GAP / k)
        gap = False
        pdf.multi_cell(
            0,
            LETTER_LH / k,
            line,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )


def _output(text: str, layout) -> bytes:
    """Draw with ``layout(pdf, text)`` twice (to count pages for the footer);
    plain text when the template can't lay it out."""
    from fpdf import FPDF

    class _Doc(FPDF):
        total = 0

        def footer(self) -> None:
            if self.total < 2:
                return
            self.set_y(-23)
            self.set_font(self.font_family or "Helvetica", "", 8.5)
            self.set_text_color(*MUTED)
            self.cell(0, 10, f"Page {self.page_no()} of {self.total}", align="R")

    def build(total: int, draw=layout) -> "FPDF":
        pdf = _Doc(format="letter", unit="pt")
        pdf.total = total
        pdf.set_margins(MARGIN_X, MARGIN_Y, MARGIN_X)
        pdf.set_auto_page_break(auto=True, margin=MARGIN_Y)
        pdf.add_page()
        draw(pdf, text or "")
        return pdf

    try:
        pages = build(0).pages_count
        return bytes(build(pages).output())
    except FPDFException:
        # Something the template can't lay out: never fail to make the file.
        logger.warning("resume_pdf: template failed, drawing plain text", exc_info=True)
        return bytes(build(0, _render_plain).output())


def _render_plain(pdf, text: str) -> None:
    """The fallback: every line as plain wrapped text, long words broken."""
    from fpdf.enums import WrapMode, XPos, YPos

    font = _register_fonts(pdf)
    pdf.c_margin = 0
    pdf.set_font(font, "", BODY)
    pdf.set_text_color(*TEXT)
    for raw in text.splitlines():
        s = _strip_md(raw.strip()).lstrip("#> ").strip()
        if not s:
            pdf.ln(LH / 2)
            continue
        pdf.multi_cell(
            0,
            LH,
            s,
            align="L",
            wrapmode=WrapMode.CHAR,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
