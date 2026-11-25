"""The PDF maker for written documents (résumés, cover letters).

Markdown in the layout the writers are told to use (``# Name``, a contact
line, ``## SECTIONS``, ``**Company** | *Title* | dates`` job lines, ``- ``
bullets) becomes a clean letter-size PDF. Uses fpdf2 — pure Python, so it
works on Windows and free-tier Linux with no native GTK/Cairo libraries (which
is why weasyprint was dropped). Moved out of ``api/v1/ai.py`` (spec 022) so a
résumé made for a job can be stored as a real PDF file.
"""

import re
from pathlib import Path

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


def _render_markdown(pdf, text: str) -> None:
    """Render an LLM's Markdown into a resume/letter that mirrors a real template:
    Carlito (Calibri) throughout, a centered name + contact header, black section
    headings with a full-width rule, bold skill labels, job headers with
    right-aligned dates, and round bullet points.

    fpdf2 has no CSS, so page-break rules are applied by measuring blocks first:
    a section heading or job/project/education header is never left alone at the
    bottom of a page (it moves down with its first bullet or line), and a bullet
    is never split across pages."""
    from fpdf.enums import MethodReturnValue, XPos, YPos

    FONT = _register_fonts(pdf)
    BODY = 10.5
    # Bullet dot indent, and the dot's cell width — sized to the old "•  "
    # prefix so the first line of every bullet starts exactly where it did.
    BULLET_X = 3
    pdf.set_font(FONT, "", BODY)
    BULLET_W = pdf.get_string_width("•  ")
    lines = text.split("\n")

    def para(
        txt: str, h: float, align: str = "L", style: str = "", size: float = BODY
    ) -> None:
        pdf.set_font(FONT, style, size)
        pdf.multi_cell(
            0,
            h,
            _md_inline(txt),
            align=align,
            markdown=True,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    def seg_style(seg: str) -> tuple[str, str]:
        if seg.startswith("**") and seg.endswith("**"):
            return seg[2:-2], "B"
        if seg.startswith("*") and seg.endswith("*"):
            return seg[1:-1], "I"
        return seg, ""

    def is_job_header(s: str) -> bool:
        return s.startswith("**") and bool(_DATE_RE.search(s))

    def text_h(
        txt: str, h: float, style: str = "", size: float = BODY, indent: float = 0
    ) -> float:
        # Height a multi_cell would take, measured without drawing anything.
        pdf.set_font(FONT, style, size)
        rows = pdf.multi_cell(
            pdf.epw - indent,
            h,
            txt,
            markdown=True,
            dry_run=True,
            output=MethodReturnValue.LINES,
        )
        pdf.set_font(FONT, "", BODY)
        return h * len(rows)

    def block_h(s: str) -> float:
        if s.startswith(("- ", "* ")):
            return text_h(_md_inline(s[2:]), 5, indent=BULLET_X + BULLET_W)
        if s.startswith("### "):
            return text_h(_md_inline(s[4:]), 5.5, style="B", size=11)
        if is_job_header(s):
            return 1.5 + 5
        # Plain paragraph: two lines are enough to not strand what's above it.
        return min(text_h(_md_inline(s), 5), 2 * 5)

    def next_content(i: int) -> int | None:
        for j in range(i + 1, len(lines)):
            if lines[j].strip():
                return j
        return None

    def with_first_line(i: int) -> float:
        # Height of block i plus the gap and first block that must follow it
        # (a header keeps at least its first bullet).
        h = block_h(lines[i].strip())
        j = next_content(i)
        if j is None:
            return h
        nxt = lines[j].strip()
        if nxt.startswith("#") or is_job_header(nxt):
            return h
        return h + 2 * (j - i - 1) + block_h(nxt)

    def keep_together(h: float) -> None:
        # break-inside/break-after: avoid — start a new page now if the next
        # `h` mm won't fit, unless we're already at the top of a page.
        if (
            pdf.get_y() + h > pdf.page_break_trigger
            and pdf.get_y() > pdf.t_margin + 0.01
        ):
            pdf.add_page()

    def job_header(line: str) -> None:
        # "**Company** | *Title* | Sep 2024 – Present" — left parts inline (with
        # their styles), the date range right-aligned on the same line.
        parts = [p.strip() for p in line.split("|")]
        date = None
        if parts and _DATE_RE.search(parts[-1]):
            date = parts[-1].strip()
            parts = parts[:-1]
        pdf.ln(1.5)
        y, page = pdf.get_y(), pdf.page
        pdf.set_x(pdf.l_margin)
        for i, seg in enumerate(parts):
            if i > 0:
                pdf.set_font(FONT, "", BODY)
                pdf.write(5, "  |  ")
            txt, style = seg_style(seg)
            pdf.set_font(FONT, style, BODY)
            pdf.write(5, txt)
        if date:
            pdf.set_font(FONT, "", BODY)
            if pdf.page != page:
                # The title wrapped onto a new page: keep the date on its line
                # there, not at the old page's y (which strands it a page later).
                y = pdf.get_y()
            pdf.set_xy(pdf.l_margin, y)
            pdf.cell(0, 5, date, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        else:
            pdf.ln(5)
            pdf.set_x(pdf.l_margin)  # write() left the cursor mid-line
        pdf.set_font(FONT, "", BODY)

    in_header = False
    pdf.set_font(FONT, "", BODY)

    for i, raw in enumerate(lines):
        stripped = raw.strip()

        if stripped.startswith("# ") and not stripped.startswith("## "):
            # Name — large, centered.
            pdf.set_font(FONT, "B", 17)
            pdf.multi_cell(
                0,
                8,
                _strip_md(stripped[2:]),
                align="C",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            pdf.set_font(FONT, "", BODY)
            in_header = True
            continue

        if stripped.startswith("## "):
            # Section heading — bold caps with a full-width rule under it.
            in_header = False
            # Keep the heading with its first entry (and that entry's first
            # bullet) so it never sits alone at the bottom of a page.
            heading_h = (
                2 + text_h(_strip_md(stripped[3:]).upper(), 5.5, "B", 11.5) + 1.8
            )
            j = next_content(i)
            # A "###" sub-heading is the section's first entry; only another
            # "#"/"##" heading means the section is empty.
            if j is not None and not lines[j].strip().startswith(("# ", "## ")):
                heading_h += 2 * (j - i - 1) + with_first_line(j)
            keep_together(heading_h)
            pdf.ln(2)
            pdf.set_font(FONT, "B", 11.5)
            pdf.multi_cell(
                0,
                5.5,
                _strip_md(stripped[3:]).upper(),
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            y = pdf.get_y() + 0.3
            pdf.set_draw_color(70, 70, 70)
            pdf.set_line_width(0.3)
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(1.8)
            pdf.set_font(FONT, "", BODY)
            continue

        if in_header:
            if not stripped:
                in_header = False
                pdf.ln(1.5)
                continue
            # Title / contact line — centered under the name.
            pdf.set_font(FONT, "", 10)
            pdf.multi_cell(
                0,
                5,
                _strip_md(stripped),
                align="C",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            pdf.set_font(FONT, "", BODY)
            continue

        if not stripped:
            pdf.ln(2)
            continue

        if stripped.startswith("### "):
            keep_together(with_first_line(i))
            para(stripped[4:], 5.5, style="B", size=11)
            continue

        if stripped.startswith(("- ", "* ")):
            keep_together(block_h(stripped))  # a bullet never splits
            # Hanging indent: the dot sits in its own cell and the text wraps
            # under itself, not under the dot. Left-aligned (ragged right), not
            # justified, so word spacing stays even.
            pdf.set_font(FONT, "", BODY)
            pdf.set_x(pdf.l_margin + BULLET_X)
            pdf.cell(BULLET_W, 5, "•")
            pdf.multi_cell(
                0,
                5,
                _md_inline(stripped[2:]),
                align="L",
                markdown=True,
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            continue

        # A job-header line: starts bold and ends with a date range.
        if is_job_header(stripped):
            keep_together(with_first_line(i))
            job_header(stripped)
            continue

        para(stripped, 5)


def render_pdf(text: str) -> bytes:
    """Markdown → the PDF's bytes."""
    from fpdf import FPDF

    pdf = FPDF(format="letter")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    _render_markdown(pdf, text or "")
    return bytes(pdf.output())
