---
name: tauri-agent-control
description: Observe and control a running Tauri app via curl over HTTP. Use when asked to interact with the app UI, click buttons, fill inputs, inspect elements, debug the webview, or automate any Tauri desktop app interaction.
triggers:
  - interact with app
  - click button
  - test UI
  - screenshot app
  - inspect element
  - debug webview
  - fill input
  - switch tab
  - navigate app
---

# tauri-agent-control

HTTP bridge for observing and controlling a running Tauri webview at `http://localhost:9876`.

## Prerequisites

The Tauri app must be running in **dev mode** (`npm run tauri dev`). The plugin is stripped from release builds.

Verify it's running:
```bash
curl -s http://localhost:9876/health
# {"ok":true}
```

## Workflow

Always follow this pattern: **snapshot → locate → act → verify**

### Step 1: Snapshot the page

```bash
curl -s "http://localhost:9876/snapshot?format=compact"
```

Returns a readable DOM tree with element refs:
```
[page] 点滴日志 — http://localhost:1420/
  @e1 [button] "今日" role="tab"
  @e2 [button] "日志" role="tab"
  @e3 [button] "报告" role="tab"
  @e4 [button] "设置" role="tab"
  @e5 [input]
```

**Important:** Refs (`@e1`, `e2`, ...) are reassigned on every snapshot. Always snapshot before acting.

### Step 2: Interact with elements

#### Click
```bash
curl -s -X POST http://localhost:9876/click \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e4"}'
# {"ok":true}
```

#### Double-click
```bash
curl -s -X POST http://localhost:9876/dblclick \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e1"}'
```

#### Fill input (direct set, fires input + change)
```bash
curl -s -X POST http://localhost:9876/fill \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e5","text":"Hello World"}'
```

#### Type into input (character-by-character, fires keydown/keypress/keyup)
```bash
curl -s -X POST http://localhost:9876/type \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e5","text":"Hello"}'
```

#### Clear input
```bash
curl -s -X POST http://localhost:9876/clear \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e5"}'
```

#### Select dropdown option
```bash
curl -s -X POST http://localhost:9876/select \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e10","value":"dark"}'
```

#### Hover
```bash
curl -s -X POST http://localhost:9876/hover \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e1"}'
```

#### Scroll into view
```bash
curl -s -X POST http://localhost:9876/scrollIntoView \
  -H "Content-Type: application/json" \
  -d '{"ref":"@e10"}'
```

### Step 3: Semantic Find (locate without snapshot)

Find elements by text, role, label, or CSS selector. Optionally perform an action immediately.

```bash
# Find by visible text and click it
curl -s -X POST http://localhost:9876/find \
  -H "Content-Type: application/json" \
  -d '{"by":"text","value":"设置","action":"click"}'
# {"ref":"@e7","tag":"button","text":"设置"}

# Find by ARIA role
curl -s -X POST http://localhost:9876/find \
  -H "Content-Type: application/json" \
  -d '{"by":"role","value":"tab","name":"日志","action":"click"}'

# Find by aria-label
curl -s -X POST http://localhost:9876/find \
  -H "Content-Type: application/json" \
  -d '{"by":"label","value":"关闭"}'

# Find by CSS selector
curl -s -X POST http://localhost:9876/find \
  -H "Content-Type: application/json" \
  -d '{"by":"css","value":"input[type=password]"}'
```

Returns `{"ref":"@eN","tag":"...","text":"..."}`. Accepted actions: `click`, `fill`, `type`, `clear`, `hover`, `dblclick`.

### Step 4: Evaluate JavaScript

```bash
curl -s -X POST http://localhost:9876/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"document.title"}'
# {"value":"点滴日志"}

curl -s -X POST http://localhost:9876/eval \
  -H "Content-Type: application/json" \
  -d '{"code":"document.querySelectorAll(\"button\").length"}'
# {"value":4}
```

### Step 5: Screenshot

```bash
curl -s http://localhost:9876/screenshot --output screenshot.png
```

> **Note:** Screenshot may not work on Windows due to platform limitations.

### Step 6: Verify changes

Always snapshot again after interactions to verify the result:
```bash
curl -s "http://localhost:9876/snapshot?format=compact"
```

## API Reference

### Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | - | Health check |
| GET | `/snapshot?format=compact\|json` | - | DOM snapshot |
| POST | `/click` | `{"ref":"@eN"}` | Click element |
| POST | `/dblclick` | `{"ref":"@eN"}` | Double-click |
| POST | `/fill` | `{"ref":"@eN","text":"..."}` | Set value directly |
| POST | `/type` | `{"ref":"@eN","text":"..."}` | Type char-by-char |
| POST | `/clear` | `{"ref":"@eN"}` | Clear input |
| POST | `/select` | `{"ref":"@eN","value":"..."}` | Select option |
| POST | `/hover` | `{"ref":"@eN"}` | Hover element |
| POST | `/scrollIntoView` | `{"ref":"@eN"}` | Scroll into view |
| POST | `/find` | `{"by":"...","value":"...","action":"..."}` | Semantic find |
| POST | `/eval` | `{"code":"..."}` | Evaluate JS |
| GET | `/screenshot` | - | Capture screenshot PNG |

### Find `by` options

| Value | Description | Example |
|-------|-------------|---------|
| `text` | Match visible text content | `{"by":"text","value":"提交"}` |
| `role` | Match ARIA role, optional `name` | `{"by":"role","value":"button","name":"Save"}` |
| `label` | Match aria-label attribute | `{"by":"label","value":"关闭"}` |
| `css` | CSS selector | `{"by":"css","value":".my-class"}` |

## Tips

- Refs are **ephemeral** — always snapshot before interacting
- Use `/find` with `action` to combine locate + act in one call
- Use `/eval` for anything the built-in endpoints don't cover
- The plugin only runs in debug builds — zero overhead in production
