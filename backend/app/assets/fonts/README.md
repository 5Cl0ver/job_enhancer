# Bundled fonts

## Carlito

`Carlito-{Regular,Bold,Italic,BoldItalic}.ttf`

**Carlito** is an open-source, **metric-compatible** substitute for Microsoft
**Calibri** — same character widths and very similar letterforms — so generated
PDFs match a Calibri-authored resume on any machine, including the Linux
deploy target (Calibri itself is proprietary and can't be redistributed).

- License: **SIL Open Font License 1.1** (redistributable, including embedding in PDFs)
- Author: Łukasz Dziedzic (tyPoland), commissioned by Google
- Source: https://github.com/google/fonts/tree/main/ofl/carlito

Used by `app/api/v1/ai.py` (`_register_fonts`) when rendering generated
resumes/cover letters to PDF via `fpdf2`.
