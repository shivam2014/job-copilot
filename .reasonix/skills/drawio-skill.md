---
name: drawio-skill
description: Generate .drawio XML diagrams and export to PNG/SVG/PDF using the draw.io desktop app CLI.
---
# Draw.io Diagrams

Generate `.drawio` XML files and export to PNG/SVG/PDF/JPG locally using the native draw.io desktop app CLI.

**Supported formats:** PNG, SVG, PDF, JPG

## Prerequisites

```
brew install --cask drawio
draw.io --version
```

Or download from https://github.com/jgraph/drawio-desktop/releases

## Workflow

1. **Plan** — identify shapes, relationships, layout (LR or TB), group by tier/layer
2. **Generate** — write `.drawio` XML file
3. **Export draft** — CLI to produce preview PNG (no `-e` for draft)
4. **Self-check** — use vision to read the PNG and catch issues
5. **Review loop** — show to user, collect feedback, edit, re-export, repeat
6. **Final export** — re-export with `-e` to embed XML

## Draw.io XML Structure

### File skeleton
```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="drawio" version="26.0.0">
  <diagram name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <!-- user shapes start at id="2" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Shape types
| Style keyword | Use for |
|--------------|---------|
| `rounded=1` | rounded rectangle — services, modules |
| `ellipse;` | circles/ovals — start/end, databases |
| `rhombus;` | diamond — decision points |
| `shape=cylinder3;` | cylinder — databases |
| `swimlane;` | group/container with title bar |

### Color palette
| Color | fillColor | strokeColor | Use for |
|-------|-----------|-------------|---------|
| Blue | `#dae8fc` | `#6c8ebf` | services, clients |
| Green | `#d5e8d4` | `#82b366` | success, databases |
| Yellow | `#fff2cc` | `#d6b656` | queues, decisions |
| Orange | `#ffe6cc` | `#d79b00` | gateways, APIs |
| Red | `#f8cecc` | `#b85450` | errors, alerts |
| Grey | `#f5f5f5` | `#666666` | external/neutral |
| Purple | `#e1d5e7` | `#9673a6` | security, auth |

## Export Commands

```bash
# Preview PNG (NO -e)
draw.io -x -f png -s 2 -o diagram.png input.drawio

# Final PNG (WITH -e for embedded XML)
draw.io -x -f png -e -s 2 -o diagram.drawio.png input.drawio
```

For full reference including macOS/Windows/Linux paths, XML details, and troubleshooting, see the original skill at `~/.codex/skills/drawio-skill/`.
