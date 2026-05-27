---
name: electron
description: Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify) using agent-browser via Chrome DevTools Protocol.
---
# Electron App Automation

Automate any Electron desktop app using agent-browser. Electron apps are built on Chromium and expose a Chrome DevTools Protocol (CDP) port that agent-browser can connect to.

## Core Workflow

1. **Launch** the Electron app with remote debugging enabled
2. **Connect** agent-browser to the CDP port
3. **Snapshot** to discover interactive elements
4. **Interact** using element refs
5. **Re-snapshot** after navigation or state changes

```
# Launch an Electron app with remote debugging
open -a "Slack" --args --remote-debugging-port=9222

# Connect agent-browser to the app (install: npm install -g agent-browser)
agent-browser connect 9222

# Standard workflow from here
agent-browser snapshot -i
agent-browser click @e5
agent-browser screenshot slack-desktop.png
```

## Launching Electron Apps with CDP

Every Electron app supports `--remote-debugging-port` since it's built into Chromium.

### macOS
```
open -a "Slack" --args --remote-debugging-port=9222
open -a "Visual Studio Code" --args --remote-debugging-port=9223
open -a "Discord" --args --remote-debugging-port=9224
open -a "Figma" --args --remote-debugging-port=9225
open -a "Notion" --args --remote-debugging-port=9226
open -a "Spotify" --args --remote-debugging-port=9227
```

## Connecting

```
agent-browser connect 9222
# Or using --cdp on each command
agent-browser --cdp 9222 snapshot -i
```

After `connect`, all subsequent commands target the connected app.

## Tab Management

Electron apps often have multiple windows or webviews:
```
agent-browser tab              # List all targets
agent-browser tab 2            # Switch to tab by index
agent-browser tab --url "*settings*"  # Switch by URL pattern
```

## Common Patterns

### Take Screenshots
```
agent-browser connect 9222
agent-browser screenshot app-state.png
```

### Fill Forms
```
agent-browser connect 9222
agent-browser snapshot -i
agent-browser fill @e3 "search query"
agent-browser press Enter
agent-browser wait 1000
agent-browser snapshot -i
```

## Troubleshooting

- "Connection refused" — make sure the app was launched with `--remote-debugging-port=NNNN`
- App launches but connect fails — wait a few seconds: `sleep 3`
- Elements not appearing in snapshot — use `agent-browser tab` to list targets and switch to the right one
