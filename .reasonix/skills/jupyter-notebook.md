---
name: jupyter-notebook
description: Create, scaffold, or edit Jupyter notebooks (.ipynb) for experiments, explorations, or tutorials.
---
# Jupyter Notebook Skill

Create clean, reproducible Jupyter notebooks for experiments and tutorials.

## When to use
- Create a new `.ipynb` notebook from scratch.
- Convert rough notes or scripts into a structured notebook.
- Refactor an existing notebook to be more reproducible.
- Build experiments or tutorials that will be read or re-run by others.

## Decision tree
- If exploratory, analytical, or hypothesis-driven → choose `experiment`
- If instructional, step-by-step → choose `tutorial`
- If editing an existing notebook → preserve intent and improve structure

## Workflow
1. Lock the intent — identify notebook kind: `experiment` or `tutorial`
2. Scaffold from the template using the helper script (from Codex origin):
   ```
   python3 /Users/shivam94/.codex/skills/jupyter-notebook/scripts/new_notebook.py \
     --kind experiment \
     --title "Compare prompt variants" \
     --out output/jupyter-notebook/compare-prompt-variants.ipynb
   ```
3. Fill the notebook with small, runnable steps — one focused step per cell
4. Add short markdown cells that explain purpose and expected result
5. Validate the result — run the notebook top-to-bottom when possible

## Templates and helper script
- Templates live in the Codex skill at `~/.codex/skills/jupyter-notebook/assets/`
- Script: `/Users/shivam94/.codex/skills/jupyter-notebook/scripts/new_notebook.py`

## Dependencies
```
uv pip install jupyterlab ipykernel
```
The bundled scaffold script uses only Python standard library and does not require extra dependencies.

## Temp and output conventions
- Use `tmp/jupyter-notebook/` for intermediate files; delete when done.
- Write final artifacts under `output/jupyter-notebook/`.
