# Kaitai Struct LSP

A Language Server Protocol implementation for [Kaitai Struct](https://kaitai.io/) `.ksy` files, providing real-time diagnostics, hover documentation, and syntax highlighting in VS Code.

## Architecture

```
┌─────────────────┐       IPC        ┌─────────────────────────────┐
│  VS Code Client  │ ◄──────────────► │       Language Server        │
│  (extension.ts)  │                  │         (server.ts)          │
└─────────────────┘                  │                             │
                                     │  ┌───────────────────────┐  │
                                     │  │  tree-sitter-yaml     │  │
                                     │  │  (WASM)               │  │
                                     │  │  Fast YAML parsing &  │  │
                                     │  │  AST for diagnostics  │  │
                                     │  └───────────────────────┘  │
                                     │                             │
                                     │  ┌───────────────────────┐  │
                                     │  │  Schema Validation    │  │
                                     │  │  Key/value checks,    │  │
                                     │  │  expression parsing   │  │
                                     │  └───────────────────────┘  │
                                     │                             │
                                     │  ┌───────────────────────┐  │
                                     │  │  Kaitai Struct        │  │
                                     │  │  Compiler (npm)       │  │
                                     │  │  Semantic validation  │  │
                                     │  │  (debounced)          │  │
                                     │  └───────────────────────┘  │
                                     └─────────────────────────────┘
```

The server uses a **two-tier validation pipeline**:

1. **Fast tier** (immediate) — tree-sitter parses the YAML and the schema validator checks structure, keys, values, and expressions. Results are sent to the client as soon as the document changes.
2. **Slow tier** (debounced, 1 s) — the full Kaitai Struct Compiler (`kaitai-struct-compiler` npm package) compiles the `.ksy` to JavaScript. Any compiler errors are mapped back to precise source locations via tree-sitter AST path resolution.

This split keeps the editor responsive while still surfacing deep semantic errors from the real compiler.

## Capabilities

### Diagnostics

| Check | Source | Latency |
|-------|--------|---------|
| YAML syntax errors | tree-sitter | Immediate |
| Unknown/invalid keys | Schema validator | Immediate |
| Invalid `endian`, `encoding`, `repeat` values | Schema validator | Immediate |
| Missing `meta.id` | Schema validator | Immediate |
| Expression syntax errors (`if`, `size`, `repeat-expr`, …) | Expression parser | Immediate |
| Unknown type references | Kaitai compiler | Debounced |
| Duplicate attribute IDs | Kaitai compiler | Debounced |
| Missing endianness for sized types | Kaitai compiler | Debounced |
| All other compilation errors | Kaitai compiler | Debounced |

Compiler errors are resolved to the exact YAML value node (e.g., the invalid type name, not the `type:` key) using tree-sitter path resolution.

### Hover Documentation

Context-aware documentation for all Kaitai Struct keys — top-level (`meta`, `seq`, `types`, …), meta properties (`id`, `endian`, `encoding`, …), and attribute fields (`type`, `size`, `repeat`, `if`, …).

### Syntax Highlighting

A TextMate grammar provides highlighting for:

- Top-level, meta, and attribute keys (each scoped differently)
- Built-in types (`u1`, `s2le`, `f4be`, `str`, `strz`, …)
- Kaitai expressions with operator, number, string, and special identifier highlighting (`_root`, `_parent`, `_io`, `_index`)
- Enum paths (`::` separator), ternary expressions, and logical keywords (`not`, `or`, `and`)

### Language Configuration

- Comment toggling (`#`)
- Auto-closing brackets and quotes
- Indentation rules for YAML mappings

## Project Structure

```
kaitai_lsp/
├── client/
│   └── src/extension.ts        # VS Code extension entry point
├── server/
│   └── src/
│       ├── server.ts           # LSP server, validation pipeline
│       ├── kaitai-validation.ts # Schema-level validation
│       ├── kaitai-hover.ts     # Hover documentation provider
│       ├── kaitai-compiler.ts  # Kaitai compiler integration
│       ├── kaitai-expression.ts # Expression tokenizer & validator
│       └── ksy_schema.json     # Schema definitions
├── syntaxes/
│   └── kaitai-struct.tmLanguage.json  # TextMate grammar
├── wasm/
│   └── tree-sitter-yaml.wasm   # WASM parser
├── language-configuration.json
└── package.json                 # Extension manifest
```

## Development

```sh
npm install
cd server && npm install && npm run build
cd ../client && npm install && npm run build
```

Run tests:

```sh
cd server && npx vitest
```

To debug the extension, open the project in VS Code and press **F5** to launch the Extension Development Host.
