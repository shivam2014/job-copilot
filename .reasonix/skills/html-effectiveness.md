---
name: html-effectiveness
description: Create single-file HTML pages for any purpose — exploration, planning, code review, design, prototyping, diagrams, slide decks, reports.
---
# HTML Effectiveness Skill

Produce single-file `.html` pages instead of markdown walls when the content benefits from layout, interactivity, color, or spatial arrangement. Every page is self-contained — no build step, no external dependencies.

## Principles

- One self-contained `.html` file — inline CSS and JS only
- Minimal, readable HTML structure; no framework or build step
- Dark/light friendly palette via CSS custom properties
- Dark mode toggle with 3-state cycling (system → dark → light) included by default
- Content-first: use layout to clarify, not decorate
- Prefer serif headings + sans body for long-form reading

## When to use HTML instead of markdown

| Use markdown for… | Use HTML for… |
|---|---|
| Short answers, code snippets, quick lists | Side-by-side comparisons, tabbed content |
| Linear docs, READMEs | Interactive explainers, clickable prototypes |
| Simple status updates | Animated timelines, visual charts |
| Static diagrams (Mermaid) | Live SVG illustrations, interactive flowcharts |

## Categories & When to Use Each

- **Exploration & Planning**: Side-by-side tradeoffs, visual layout options, milestone timelines
- **Code Review & Understanding**: Annotated diff with margin notes, module maps with boxes and arrows
- **Design**: Color swatches, type scales, component variants on one sheet
- **Prototyping**: Isolated transitions with sliders, clickable multi-screen flows
- **Illustrations & Diagrams**: Inline SVG figures, annotated clickable flowcharts
- **Decks**: Arrow-key-navigable slide presentations
- **Research & Learning**: Collapsible steps, tabbed config, live interactive demos
- **Reports**: Status reports with charts, incident post-mortems
- **Custom Editors**: Drag-and-drop boards, toggle groups, live template editors

## Default Styling Palette

Use these CSS custom properties for consistent look:

```css
:root {
  --ivory:    #FAF9F5;
  --paper:    #FFFFFF;
  --slate:    #141413;
  --clay:     #D97757;
  --clay-d:   #B85C3E;
  --oat:      #E3DACC;
  --olive:    #788C5D;
  --g100:     #F0EEE6;
  --g200:     #E6E3DA;
  --g300:     #D1CFC5;
  --g500:     #87867F;
  --g700:     #3D3D3A;
  --serif:    ui-serif, Georgia, "Times New Roman", Times, serif;
  --sans:     system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono:     ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
}
```

## Guidelines

- **Structure**: `<header>`, `<section>`, `<footer>` semantic elements
- **Typography**: serif for headings, sans for body, mono for code
- **Responsive**: `clamp()` for font sizes, `auto-fill`/`auto-fit` for grids
- **Interactivity**: Keep JS under 50 lines; use `click`, `input`, `drag` events
- **Export**: For editors, always include a copy/export button that serializes state
- **SVG**: Inline SVG for diagrams — color with currentColor or CSS variables
- **No frameworks**: No React, no libraries, no CDN scripts — vanilla HTML/CSS/JS
- **File size**: Target under 30 KB

## Dark Mode Toggle

Every HTML page should include a built-in dark mode toggle using the 3-state `data-dm` attribute approach. See the full implementation in the original skill at `~/.codex/skills/html-effectiveness/SKILL.md` for the complete CSS + JS pattern.
