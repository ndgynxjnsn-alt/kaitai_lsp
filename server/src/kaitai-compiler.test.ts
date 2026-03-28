import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { compileAndGetDiagnostics, buildSymbolDocs } from './kaitai-compiler';
import * as yaml from 'js-yaml';

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

describe('buildSymbolDocs', () => {
	it('extracts doc from seq fields', () => {
		const ksy = yaml.load([
			'meta:',
			'  id: test',
			'  endian: le',
			'seq:',
			'  - id: primary_geometry',
			'    doc: DOCUMENTATION_GEOMETRY',
			'    size: 0x1000',
			'  - id: primary_metadata',
			'    doc: primary_metadata doc',
			'    size: 4',
		].join('\n'));
		const docs = buildSymbolDocs(ksy);
		expect(docs.get('primary_geometry')).toBe('DOCUMENTATION_GEOMETRY');
		expect(docs.get('primary_metadata')).toBe('primary_metadata doc');
	});

	it('extracts doc from nested types and instances', () => {
		const ksy = yaml.load([
			'meta:',
			'  id: nested',
			'  endian: le',
			'types:',
			'  inner:',
			'    seq:',
			'      - id: field_a',
			'        doc: doc for field_a',
			'        size: 1',
			'    instances:',
			'      inst_b:',
			'        doc: doc for inst_b',
			'        value: 42',
		].join('\n'));
		const docs = buildSymbolDocs(ksy);
		expect(docs.get('field_a')).toBe('doc for field_a');
		expect(docs.get('inst_b')).toBe('doc for inst_b');
	});

	it('ignores fields without doc', () => {
		const ksy = yaml.load('meta:\n  id: t\nseq:\n  - id: nodoc\n    size: 1');
		const docs = buildSymbolDocs(ksy);
		expect(docs.has('nodoc')).toBe(false);
	});
});
