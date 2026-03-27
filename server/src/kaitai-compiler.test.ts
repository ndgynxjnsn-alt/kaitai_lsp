import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { compileAndGetDiagnostics } from './kaitai-compiler';

let parser: Parser;

function createDoc(text: string) {
	return TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
}

async function compile(text: string) {
	const tree = parser.parse(text);
	const doc = createDoc(text);
	return compileAndGetDiagnostics(text, tree.rootNode, doc);
}

beforeAll(async () => {
	await Parser.init();
	const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
	const yamlLang = await Parser.Language.load(wasmPath);
	parser = new Parser();
	parser.setLanguage(yamlLang);
});

describe('compileAndGetDiagnostics', () => {
	it('returns no diagnostics for valid KSY', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: foo
    type: u4`;
		const diags = await compile(yaml);
		expect(diags).toEqual([]);
	});

	it('detects missing endianness', async () => {
		const yaml = `meta:
  id: test
seq:
  - id: foo
    type: u4`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toContain('endian');
		expect(diags[0].source).toBe('kaitai-compiler');
	});

	it('detects unknown type reference', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: foo
    type: nonexistent`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toContain('nonexistent');
	});

	it('detects duplicate attribute IDs', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: foo
    type: u4
  - id: foo
    type: u4`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toContain('duplicate');
	});

	it('detects invalid expression', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: bar
    type: u4
    if: bad..expr`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toContain('expression');
	});

	it('points diagnostics to the correct YAML location', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: foo
    type: nonexistent`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		// The error path is /seq/0/type — should underline the value 'nonexistent'
		const diag = diags[0];
		const doc = createDoc(yaml);
		const startOffset = doc.offsetAt(diag.range.start);
		const endOffset = doc.offsetAt(diag.range.end);
		const highlighted = yaml.substring(startOffset, endOffset);
		expect(highlighted).toBe('nonexistent');
	});

	it('returns no diagnostics for invalid YAML', async () => {
		const yaml = `{{{not yaml`;
		const diags = await compile(yaml);
		expect(diags).toEqual([]);
	});

	it('returns no diagnostics for non-object YAML', async () => {
		const yaml = `just a string`;
		const diags = await compile(yaml);
		expect(diags).toEqual([]);
	});

	it('handles valid KSY with types', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: header
    type: my_header
types:
  my_header:
    seq:
      - id: magic
        type: u4`;
		const diags = await compile(yaml);
		expect(diags).toEqual([]);
	});

	it('detects errors in nested types', async () => {
		const yaml = `meta:
  id: test
  endian: le
seq:
  - id: header
    type: my_header
types:
  my_header:
    seq:
      - id: magic
        type: nonexistent_inner`;
		const diags = await compile(yaml);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].message).toContain('nonexistent_inner');
	});
});
