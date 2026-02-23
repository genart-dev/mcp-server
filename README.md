# @genart-dev/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server for [genart.dev](https://genart.dev) — 33 tools, 4 resources, and 3 prompts for creating and manipulating generative art with AI agents.

Works with any MCP client: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Claude Desktop](https://claude.ai/download), [Codex CLI](https://github.com/openai/codex), [Cursor](https://cursor.sh), and more.

## Install

```bash
npm install -g @genart-dev/mcp-server
```

For screenshot/export capture, also install Puppeteer:

```bash
npm install -g puppeteer
```

## Quick Start

### Claude Code

```bash
claude mcp add genart-mcp -- genart-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "genart": {
      "command": "genart-mcp"
    }
  }
}
```

### Codex CLI

Add to `.codex/config.toml`:

```toml
[mcp_servers.genart]
command = "genart-mcp"
```

Then ask your AI agent to create generative art:

> "Create a workspace with a p5.js sketch that draws a grid of rotating squares using the golden ratio"

## Tools (33)

### Workspace (5)

| Tool | Description |
|------|-------------|
| `create_workspace` | Create a new `.genart-workspace` with optional initial sketches |
| `open_workspace` | Open an existing `.genart-workspace` and load all sketches |
| `add_sketch_to_workspace` | Add an existing `.genart` file to the active workspace |
| `remove_sketch_from_workspace` | Remove a sketch from workspace (optionally delete file) |
| `list_workspace_sketches` | List all sketches with metadata summaries |

### Sketch Lifecycle (7)

| Tool | Description |
|------|-------------|
| `create_sketch` | Create a new `.genart` sketch — supports all 5 renderers |
| `open_sketch` | Open a sketch by ID and set selection |
| `update_sketch` | Update metadata, parameters, colors, canvas |
| `update_algorithm` | Replace algorithm source code with optional validation |
| `save_sketch` | Persist in-memory state to disk |
| `fork_sketch` | Create a variant with new ID and optional modifications |
| `delete_sketch` | Delete sketch file and remove from workspace |

### Selection & Context (4)

| Tool | Description |
|------|-------------|
| `get_selection` | Full context for selected sketch(es) — algorithm, params, colors, philosophy |
| `select_sketch` | Set canvas selection to one or more sketches |
| `get_editor_state` | Full snapshot of workspace, sketches, and selection |
| `set_working_directory` | Set base directory for sandboxed file operations |

### Parameters (5)

| Tool | Description |
|------|-------------|
| `set_parameters` | Update runtime parameter values |
| `set_colors` | Update runtime color palette values |
| `set_seed` | Set random seed (or generate random) |
| `set_canvas_size` | Change dimensions via preset or explicit W/H |
| `randomize_parameters` | Generate random values for all/specific parameters |

### Arrangement (3)

| Tool | Description |
|------|-------------|
| `arrange_sketches` | Move sketches to explicit canvas positions |
| `auto_arrange` | Auto-layout with grid, row, column, or masonry |
| `group_sketches` | Create/update named groups of sketches |

### Gallery (2)

| Tool | Description |
|------|-------------|
| `list_sketches` | Scan a directory for `.genart` files with metadata |
| `search_sketches` | Search loaded sketches by title, renderer, params, skills |

### Merge (1)

| Tool | Description |
|------|-------------|
| `merge_sketches` | Combine parameters, colors, and philosophies from 2+ sketches |

### Capture (3)

| Tool | Description |
|------|-------------|
| `capture_screenshot` | Headless capture of a sketch — returns metadata + inline JPEG for AI viewing |
| `capture_batch` | Capture multiple sketches in parallel |
| `snapshot_layout` | Structural summary of workspace layout for spatial reasoning |

### Export (1)

| Tool | Description |
|------|-------------|
| `export_sketch` | Export as standalone HTML, PNG, SVG, raw algorithm, or ZIP bundle |

### Knowledge (3)

| Tool | Description |
|------|-------------|
| `list_skills` | List available design knowledge skills by category |
| `load_skill` | Load a skill with full theory, principles, and examples |
| `get_guidelines` | Design guidelines for composition, color, parameters, animation, performance |

## Resources (4)

| URI | Description |
|-----|-------------|
| `genart://skills` | Available design knowledge skills |
| `genart://presets/canvas` | Canvas dimension presets (18 built-in) |
| `genart://gallery` | Loaded sketches with metadata summaries |
| `genart://renderers` | Available renderer types and metadata |

## Prompts (3)

| Prompt | Description |
|--------|-------------|
| `create-generative-art` | Guided workflow: concept → sketch → algorithm → capture → iterate |
| `explore-variations` | Fork and explore parameter/seed space across multiple variants |
| `apply-design-theory` | Apply Gestalt, color theory, composition, rhythm, or contrast principles |

## Supported Renderers

| Type | Runtime | Algorithm |
|------|---------|-----------|
| `p5` | p5.js | `function sketch(p, state) { ... }` |
| `three` | Three.js | `function sketch(THREE, state, container) { ... }` |
| `glsl` | WebGL2 | Fragment shader source |
| `canvas2d` | Native | `function sketch(ctx, state) { ... }` |
| `svg` | Native | `function sketch(state) { ... }` |

## Library API

For programmatic use (e.g., building a custom MCP host):

```typescript
import { createServer, EditorState } from "@genart-dev/mcp-server/lib";

const state = new EditorState();
const server = createServer(state);

// Connect to any MCP transport
// ...
```

### Exports from `@genart-dev/mcp-server/lib`

| Export | Description |
|--------|-------------|
| `createServer(state)` | Create a configured `McpServer` instance |
| `EditorState` | Server-scoped mutable state (workspace, sketches, selection) |
| `LoadedSketch` | Type — sketch definition + file path + dirty flag |
| `EditorMutationType` | Type — mutation event names (`sketch:created`, `workspace:loaded`, etc.) |
| `EditorMutationEvent` | Type — mutation event payload |
| `EditorStateSnapshot` | Type — serializable snapshot of all state |

### EditorState

```typescript
const state = new EditorState();

// Load from disk
await state.loadWorkspace("/path/to/project.genart-workspace");

// Access loaded sketches
state.sketches;               // Map<string, LoadedSketch>
state.selection;              // Set<string>
state.workspace;              // WorkspaceDefinition | null

// Sandbox file operations (for hosted environments)
state.basePath = "/safe/dir";
state.remoteMode = true;      // Return file content instead of writing to disk

// Listen for mutations
state.on("mutation", (event) => {
  console.log(event.type);    // "sketch:created", "workspace:loaded", etc.
});

// Serializable snapshot
const snapshot = state.getSnapshot();
```

## Modes

### stdio (default)

Standard MCP transport for CLI agents:

```bash
genart-mcp
```

### Sidecar

Stdio transport + IPC mutation bridge for Electron app integration:

```bash
genart-mcp --mode sidecar
```

Mutations are forwarded to the parent process via Node IPC, enabling real-time UI updates when AI agents modify sketches.

## Agent Attribution

Most mutation tools accept optional `agent` and `model` parameters for provenance tracking:

```json
{
  "agent": "claude-code",
  "model": "claude-opus-4-6"
}
```

Stored in sketch metadata to track which AI agent created or modified each sketch.

## Related Packages

| Package | Purpose |
|---------|---------|
| [`@genart-dev/format`](https://github.com/genart-dev/format) | File format types, parsers, presets |
| [`@genart-dev/core`](https://github.com/genart-dev/core) | Renderer adapters, skill registry (dependency) |

## License

MIT
