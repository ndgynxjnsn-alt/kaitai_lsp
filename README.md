# Kaitai Struct

VS Code extension for [Kaitai Struct](https://kaitai.io/) `.ksy` files.

## Features

**Editor support**
- Diagnostics: YAML structure errors, unknown keys, invalid values, and expression syntax are flagged immediately. Deep semantic errors (unknown types, duplicate IDs, missing endianness) are reported via the Kaitai compiler after a short debounce.
- Hover documentation for all Kaitai Struct keys.
- Syntax highlighting for keys, built-in types, expressions, and enum paths.
- Comment toggling, auto-closing brackets, and indentation rules.

**Binary viewer**

Open a `.ksy` file and click the file icon in the editor toolbar (or run **Kaitai: Open Hex Viewer**) to open two side panels:

- **Kaitai Hex** — hex dump of the binary file.
- **Kaitai Tree** — parsed structure based on the active `.ksy`.

Run **Kaitai: Select Binary File** to pick the binary to parse. Selecting a byte range in either panel highlights the corresponding region in the other.

## Development

```sh
npm install
cd server && npm install
cd ../webview && npm install
```

Run tests:

```sh
cd server && npx vitest        # LSP server tests
cd webview && npm test         # Webview / HexViewer tests
```

Press **F5** in VS Code to launch the Extension Development Host.
