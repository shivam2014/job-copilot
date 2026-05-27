---
name: excalidraw-diagram
description: Create Excalidraw diagram JSON files that make visual arguments for workflows, architectures, and concepts.
---
# Excalidraw Diagram Creator

Generate `.excalidraw` JSON files that **argue visually**, not just display information.

## Core Philosophy

**Diagrams should ARGUE, not DISPLAY.** The shape should BE the meaning.

**The Isomorphism Test**: If you removed all text, would the structure alone communicate the concept? If not, redesign.

## Design Process

### Step 0: Assess Depth Required
- **Simple/Conceptual**: Abstract shapes, labels, relationships
- **Comprehensive/Technical**: Concrete examples, code snippets, real data

For technical diagrams: research actual specs, formats, event names, and APIs before drawing.

### Step 1: Map Concepts to Patterns

| If the concept... | Use this pattern |
|-------------------|------------------|
| Spawns multiple outputs | **Fan-out** (radial arrows from center) |
| Combines inputs into one | **Convergence** (funnel, arrows merging) |
| Has hierarchy/nesting | **Tree** (lines + free-floating text) |
| Is a sequence of steps | **Timeline** (line + dots + free-floating labels) |
| Loops or improves continuously | **Spiral/Cycle** |
| Transforms input to output | **Assembly line** |
| Compares two things | **Side-by-side** |

### Step 2: Ensure Variety
Each major concept must use a different visual pattern. No uniform cards or grids.

### Step 3: Generate JSON

Follow Excalidraw JSON format with elements array.

## Render & Validate (MANDATORY)

After generating the JSON, render to PNG using the bundled render script:
```
cd /Users/shivam94/.codex/skills/excalidraw-diagram/references && uv run python render_excalidraw.py <path-to-file.excalidraw>
```

Run the render-view-fix loop until the diagram looks right. Check for:
- Text clipped by containers
- Overlapping elements
- Arrows routing correctly
- Even spacing and balanced composition

## Key Principles

- **Minimal containers**: Default to free-floating text. Add containers only when they serve a purpose.
- **Lines as structure**: Use lines instead of boxes for timelines, trees, dividers.
- **Color as meaning**: Every color should encode information, not decoration.
- **Text rules**: JSON `text` property contains ONLY readable words. Use `fontFamily: 3`.
- **Roughness**: `roughness: 0` for clean/modern, `roughness: 1` for hand-drawn.
- **Opacity**: Always `opacity: 100` for all elements.

For full reference including element templates, color palette, and visual pattern library, see `~/.codex/skills/excalidraw-diagram/`.
