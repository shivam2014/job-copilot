---
name: local-latex
description: Compile LaTeX documents to PDF using a local TinyTeX installation at /Users/shivam94/Documents/Resume/texlive/.
---
# Local LaTeX Compilation (TinyTeX)

A lightweight TeX Live 2026 installation at `/Users/shivam94/Documents/Resume/texlive/`. Installed via TinyTeX — auto-installs missing LaTeX packages on demand.

## Setup

Add TinyTeX to PATH before any LaTeX command:
```
export PATH="/Users/shivam94/Documents/Resume/texlive/bin/universal-darwin:$PATH"
```

## Compile a .tex file to PDF

Two passes for cross-references and outlines:
```
export PATH="/Users/shivam94/Documents/Resume/texlive/bin/universal-darwin:$PATH"
cd /path/to/tex/file
pdflatex -interaction=nonstopmode -halt-on-error filename.tex
pdflatex -interaction=nonstopmode -halt-on-error filename.tex
```

## Install missing packages

TinyTeX auto-installs missing packages during compilation. If that fails:
```
export PATH="/Users/shivam94/Documents/Resume/texlive/bin/universal-darwin:$PATH"
tlmgr install package-name
```

## Check if a package is available
```
export PATH="/Users/shivam94/Documents/Resume/texlive/bin/universal-darwin:$PATH"
kpsewhich filename.sty
```

## Troubleshooting

### "Font not loadable: Metric (TFM) file not found"
Install the font package:
```
tlmgr install charter
tlmgr install avantgar
tlmgr install helvetic
tlmgr install courier
```

### "I can't find file" or "No output PDF file produced"
Check the `.log` file:
```
grep -i "error\|missing\|not found" filename.log
```

## Notes
- Installation is at `/Users/shivam94/Documents/Resume/texlive/` (not default `~/Library/TinyTeX/`)
- Use `pdflatex` (pdfTeX engine), not XeTeX or LuaTeX
- All generated files (`.aux`, `.log`, `.pdf`) appear alongside the `.tex` file
