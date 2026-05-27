---
name: sysml-modeling
description: Systems Modeling Language (SysML) for Model-Based Systems Engineering (MBSE) — requirements diagrams, BDD, IBD, parametrics, and activity diagrams.
---
# SysML Modeling Skill

Systems Modeling Language (SysML) for Model-Based Systems Engineering (MBSE) and complex system design.

## Diagram Types

### Behavior Diagrams
| Diagram | Purpose |
|---------|---------|
| Activity | Flow of actions and data |
| Sequence | Object interactions over time |
| State Machine | Lifecycle behavior |
| Use Case | System-actor interactions |

### Structure Diagrams
| Diagram | Purpose |
|---------|---------|
| Block Definition (BDD) | System structure hierarchy |
| Internal Block (IBD) | Internal component connections |
| Package | Model organization |

### Requirements & Parametrics
| Diagram | Purpose |
|---------|---------|
| Requirements | Requirements and relationships |
| Parametric | Constraint equations |

## Requirements Diagram (PlantUML)

```plantuml
rectangle "<<requirement>>\nREQ-001: System Performance" as REQ001 {
  id = "REQ-001"
  text = "System shall process 1000 requests/second"
}
rectangle "<<requirement>>\nREQ-002: Response Time" as REQ002
REQ001 <-- REQ002 : <<deriveReqt>>
```

### Requirement Relationships
`<<deriveReqt>>` — Derived requirement | `<<satisfy>>` — Design satisfies requirement | `<<verify>>` — Test verifies requirement | `<<trace>>` — General traceability

## Block Definition Diagram (BDD)

Blocks use `<<block>>` stereotype with `values`, `parts`, `operations` compartments, plus `<<valueType>>` for typed values with units, and `<<enumeration>>` for enumerated types.

## Internal Block Diagram (IBD)

Shows internal connections between parts via ports with `<<itemFlow>>` for matter/energy/data flows.

## Parametric Diagram

Constraint blocks express equations (e.g., `{ F = m * a }`) with binding connectors linking to value properties.

## MBSE Workflow

1. **Define Requirements** — Capture stakeholder needs
2. **Model Structure** — BDD for system decomposition
3. **Define Interfaces** — IBD for part connections and flows
4. **Specify Behavior** — Activity, sequence, state diagrams
5. **Add Constraints** — Parametric diagrams for physics/math
6. **Allocate Functions** — Map behaviors to structural elements
7. **Trace & Verify** — Link requirements through to verification

For complete PlantUML syntax examples and detailed reference, see `~/.codex/skills/sysml-modeling/SKILL.md`.
