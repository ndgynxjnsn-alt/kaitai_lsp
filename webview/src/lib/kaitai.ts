import yaml from "js-yaml";
import KaitaiStructCompiler from "kaitai-struct-compiler";
import { KaitaiStream } from "kaitai-struct";

/** Node types in the parsed tree */
export type TreeNodeType = "object" | "array" | "bytes" | "primitive";

export interface ByteRange {
  start: number;
  end: number; // exclusive
}

export interface TreeNode {
  name: string;
  type: TreeNodeType;
  /** Byte range in the original buffer */
  range?: ByteRange;
  /** For objects: the kaitai class name */
  className?: string;
  /** For primitives: the raw value */
  value?: string | number | boolean | null;
  /** For integers: hex representation */
  hexValue?: string;
  /** For bytes: hex preview string */
  bytesPreview?: string;
  /** For bytes: full length */
  bytesLength?: number;
  /** For arrays: item count */
  arrayLength?: number;
  /** Child nodes (object fields, array items) */
  children?: TreeNode[];
}

export interface ParseResult {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

/**
 * Compile a .ksy YAML string and parse the given buffer with it.
 */
export async function compileAndParse(
  ksyYaml: string,
  buffer: ArrayBuffer
): Promise<ParseResult> {
  // 1. Parse the YAML
  let ksyObject: Record<string, unknown>;
  try {
    const parsed = yaml.load(ksyYaml);
    if (!parsed || typeof parsed !== "object") {
      return { success: false, error: "Invalid KSY: not a valid YAML object" };
    }
    ksyObject = parsed as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Invalid KSY: ${msg}` };
  }

  const rootClassName =
    (ksyObject.meta as Record<string, unknown> | undefined)?.id as
      | string
      | undefined;

  // 2. Compile to JavaScript
  const importer = {
    importYaml(_name: string, _mode: string): Promise<unknown> {
      return Promise.reject(
        new Error(`Imports are not supported. Referenced: ${_name}`)
      );
    },
  };

  let compiledFiles: Record<string, string>;
  try {
    compiledFiles = await KaitaiStructCompiler.compile(
      "javascript",
      ksyObject,
      importer,
      true
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Compilation failed: ${msg}` };
  }

  // 3. Join all generated source files
  const jsCode = Object.values(compiledFiles).join("\n");

  // 4. Execute the generated code to get the parser class.
  //    The compiler emits a UMD wrapper:
  //      define(['exports', 'kaitai-struct/KaitaiStream'], function(exports, KaitaiStream) { ... })
  //    The factory populates the exports object and the constructor calls _read() internally.
  const classes: Record<string, unknown> = {};

  const fakeDefine = (
    _deps: string[],
    factory: (exports: Record<string, unknown>, ks: typeof KaitaiStream) => void
  ) => {
    factory(classes, KaitaiStream);
  };
  (fakeDefine as unknown as Record<string, boolean>).amd = true;

  const fn = new Function("define", "KaitaiStream", jsCode);
  fn(fakeDefine, KaitaiStream);

  // The main class is exported under its PascalCase name (e.g. SimplePacket.SimplePacket)
  const mainClassName = Object.keys(classes)[0];
  type KaitaiParser = Record<string, unknown> & { _read(): void };
  const MainClass = mainClassName
    ? (classes[mainClassName] as new (
        stream: KaitaiStream,
        parent: unknown,
        root: unknown
      ) => KaitaiParser)
    : null;

  if (!MainClass) {
    return { success: false, error: "Compilation produced no parser class" };
  }

  // 5. Instantiate and parse (_read() is called by the constructor)
  try {
    const stream = new KaitaiStream(buffer, 0);
    const parsed = new MainClass(stream, null, null);
    parsed._read();

    // 6. Build the tree
    const tree = buildTreeNode(
      rootClassName ?? "root",
      parsed,
      (parsed as Record<string, unknown>)._debug as Record<string, DebugInfo> | undefined
    );
    return { success: true, tree };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Parse error: ${msg}` };
  }
}

interface DebugInfo {
  start?: number;
  end?: number;
  ioOffset?: number;
  arr?: DebugInfo[];
}

function getRange(debug: DebugInfo | undefined): ByteRange | undefined {
  if (!debug || typeof debug.start !== "number" || typeof debug.end !== "number") return undefined;
  const offset = debug.ioOffset ?? 0;
  return { start: offset + debug.start, end: offset + debug.end };
}

function buildTreeNode(
  name: string,
  obj: unknown,
  debug: Record<string, DebugInfo> | undefined,
  depth = 0
): TreeNode {
  if (depth > 30) {
    return { name, type: "primitive", value: "[max depth]" };
  }

  if (obj === null || obj === undefined) {
    return { name, type: "primitive", value: obj ?? null };
  }

  // Byte arrays
  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
    const bytes = obj instanceof ArrayBuffer ? new Uint8Array(obj) : obj;
    const preview = Array.from(bytes.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return {
      name,
      type: "bytes",
      bytesPreview: bytes.length > 16 ? preview + " ..." : preview,
      bytesLength: bytes.length,
    };
  }

  // Arrays
  if (Array.isArray(obj)) {
    const children = obj.map((item, i) => {
      const itemDebug = debug as unknown as DebugInfo;
      const childDebugInfo = itemDebug?.arr?.[i];
      const childObj = item as Record<string, unknown>;
      const childDebug = childObj && typeof childObj === "object" && !Array.isArray(childObj)
        ? (childObj as Record<string, unknown>)._debug as Record<string, DebugInfo> | undefined
        : undefined;
      const node = buildTreeNode(String(i), item, childDebug, depth + 1);
      if (childDebugInfo) {
        node.range = getRange(childDebugInfo);
      }
      return node;
    });
    return { name, type: "array", arrayLength: obj.length, children };
  }

  // Objects (parsed kaitai structs)
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const className = record.constructor?.name;
    const objDebug = record._debug as Record<string, DebugInfo> | undefined;

    const children: TreeNode[] = [];
    for (const key of Object.keys(record)) {
      if (key.startsWith("_")) continue;
      const fieldDebug = objDebug?.[key];
      const childVal = record[key];
      const childObj = childVal as Record<string, unknown>;
      const childObjDebug = childVal && typeof childVal === "object" && !Array.isArray(childVal)
        ? (childObj._debug as Record<string, DebugInfo> | undefined)
        : undefined;
      const node = buildTreeNode(key, childVal, childObjDebug, depth + 1);
      if (fieldDebug) {
        node.range = getRange(fieldDebug);
      }
      children.push(node);
    }

    // Compute range for the object itself from children
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const child of children) {
      if (child.range) {
        minStart = Math.min(minStart, child.range.start);
        maxEnd = Math.max(maxEnd, child.range.end);
      }
    }

    return {
      name,
      type: "object",
      className: className && className !== "Object" ? className : undefined,
      children,
      range: minStart < Infinity ? { start: minStart, end: maxEnd } : undefined,
    };
  }

  // Primitives
  const node: TreeNode = { name, type: "primitive", value: obj as string | number | boolean };
  if (typeof obj === "number" && Number.isInteger(obj)) {
    node.hexValue = "0x" + obj.toString(16).toUpperCase();
  }
  return node;
}
