---
name: overleaf
description: Sync and manage Overleaf LaTeX projects from the command line. Pull, push, compile, and download .bbl files for arXiv submissions.
---
# Overleaf Skill

Manage Overleaf LaTeX projects via the `olcli` CLI.

## Installation
```
# Homebrew (recommended)
brew tap aloth/tap && brew install olcli

# npm
npm install -g @aloth/olcli
```

## Authentication
1. Log into [overleaf.com](https://www.overleaf.com)
2. Open DevTools (F12) → Application → Cookies
3. Copy the value of `overleaf_session2`

```
olcli auth --cookie "YOUR_SESSION_COOKIE"
olcli whoami    # Verify
olcli check     # Debug auth
```

## Common Workflows

### Pull a project
```
olcli pull "My Paper"
cd My_Paper/
```

### Edit and sync
```
olcli push              # Upload changes only
olcli sync              # Bidirectional sync (pull + push)
```

### Compile and download PDF
```
olcli pdf                      # Compile and download
olcli pdf -o paper.pdf         # Custom output name
```

### Download .bbl for arXiv submission
```
olcli output bbl               # Download compiled .bbl
olcli output bbl -o main.bbl   # Custom filename
```

### Upload figures
```
olcli upload figure1.png "My Paper"
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `olcli auth --cookie <value>` | Authenticate with session cookie |
| `olcli whoami` | Check auth status |
| `olcli list` | List all projects |
| `olcli pull [project] [dir]` | Download project files |
| `olcli push [dir]` | Upload local changes |
| `olcli sync [dir]` | Bidirectional sync |
| `olcli upload <file> [project]` | Upload a single file |
| `olcli compile [project]` | Trigger compilation |
| `olcli pdf [project]` | Compile and download PDF |
| `olcli output [type]` | Download compile outputs |

## Tips
- Run commands from a synced directory (contains `.olcli.json`) to skip the project argument.
- Use `olcli push --dry-run` to preview changes before uploading.
- Use `olcli pull --force` to overwrite local changes.
