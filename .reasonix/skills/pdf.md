---
name: pdf
description: Read, create, or review PDF files where rendering and layout matter. Uses reportlab, pdfplumber, and Poppler for visual checks.
---
# PDF Skill

## When to use
- Read or review PDF content where layout and visuals matter.
- Create PDFs programmatically with reliable formatting.
- Validate final rendering before delivery.

## Workflow
1. Prefer visual review: render PDF pages to PNGs and inspect them.
   - Use `pdftoppm` if available.
   - If unavailable, install Poppler or ask the user to review output locally.
2. Use `reportlab` to generate PDFs when creating new documents.
3. Use `pdfplumber` (or `pypdf`) for text extraction and quick checks.
4. After each meaningful update, re-render pages and verify alignment, spacing, legibility.

## Dependencies
Prefer `uv` for dependency management:
```
uv pip install reportlab pdfplumber pypdf
```
System tools:
```
# macOS
brew install poppler
```

## Rendering command
```
pdftoppm -png $INPUT_PDF $OUTPUT_PREFIX
```

## Temp and output conventions
- Use `tmp/pdfs/` for intermediate files; delete when done.
- Write final artifacts under `output/pdf/`.
- Keep filenames stable and descriptive.

## Quality expectations
- Maintain polished visual design: consistent typography, spacing, margins, section hierarchy.
- Avoid rendering issues: clipped text, overlapping elements, broken tables.
- Charts, tables, and images must be sharp, aligned, and clearly labeled.
- Use ASCII hyphens only. Avoid U+2011 (non-breaking hyphen) and Unicode dashes.
- Citations must be human-readable; never leave tool tokens or placeholder strings.

## Final checks
- Do not deliver until the latest PNG inspection shows zero visual or formatting defects.
- Confirm headers/footers, page numbering, section transitions look polished.
- Keep intermediate files organized or remove them after final approval.
