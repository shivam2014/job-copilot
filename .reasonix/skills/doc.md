---
name: doc
description: Read, create, or edit .docx documents with formatting fidelity. Uses python-docx plus rendering scripts for visual checks.
---
# DOCX Skill

## When to use
- Read or review DOCX content where layout matters (tables, diagrams, pagination).
- Create or edit DOCX files with professional formatting.
- Validate visual layout before delivery.

## Workflow
1. Prefer visual review (layout, tables, diagrams).
   - If `soffice` and `pdftoppm` are available, convert DOCX -> PDF -> PNGs.
   - Or use bundled render script (see below).
   - If tools are missing, install them or ask the user to review locally.
2. Use `python-docx` for edits and structured creation (headings, styles, tables, lists).
3. After each meaningful change, re-render and inspect the pages.
4. If visual review is not possible, extract text with `python-docx` as a fallback.
5. Keep intermediate outputs organized and clean up after final approval.

## Dependencies
Prefer `uv` for dependency management:
```
uv pip install python-docx pdf2image
```
System tools:
```
# macOS
brew install libreoffice poppler
```

## Rendering commands
```
soffice --headless --convert-to pdf --outdir $OUTDIR $INPUT_DOCX
pdftoppm -png $OUTDIR/$BASENAME.pdf $OUTDIR/$BASENAME
```

Bundled helper (from Codex origin):
```
python3 /Users/shivam94/.codex/skills/doc/scripts/render_docx.py /path/to/file.docx --output_dir /tmp/docx_pages
```

## Temp and output conventions
- Use `tmp/docs/` for intermediate files; delete when done.
- Write final artifacts under `output/doc/`.

## Quality expectations
- Deliver a client-ready document: consistent typography, spacing, margins, clear hierarchy.
- Avoid formatting defects: clipped/overlapping text, broken tables.
- Use ASCII hyphens only. Avoid U+2011 (non-breaking hyphen).
- Citations must be human-readable; never leave tool tokens or placeholders.

## Final checks
- Re-render and inspect every page at 100% zoom before final delivery.
- Fix any spacing, alignment, or pagination issues and repeat.
- Confirm there are no leftovers (temp files, duplicate renders).
