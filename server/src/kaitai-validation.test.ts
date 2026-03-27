import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { validateKaitai } from './kaitai-validation';

let parser: Parser;

function parse(text: string): { diagnostics: Diagnostic[]; tree: Parser.Tree } {
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	const diagnostics = validateKaitai(tree.rootNode, doc);
	return { diagnostics, tree };
}

function messages(text: string): string[] {
	return parse(text).diagnostics.map(d => d.message);
}

function hasMessage(text: string, substring: string): boolean {
	return messages(text).some(m => m.includes(substring));
}

beforeAll(async () => {
	await Parser.init();
	const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
	const yamlLang = await Parser.Language.load(wasmPath);
	parser = new Parser();
	parser.setLanguage(yamlLang);
});

describe('top-level key validation', () => {
	it('accepts all valid top-level keys', () => {
		const yaml = `meta:\n  id: test\nseq: []\ntypes: {}\ninstances: {}\nenums: {}\ndoc: hello\ndoc-ref: ref\nparams: []\nto-string: str`;
		const diags = messages(yaml);
		expect(diags.filter(m => m.includes('Unknown top-level key'))).toEqual([]);
	});

	it('reports unknown top-level key', () => {
		expect(hasMessage('meta:\n  id: test\nbogus: 1', "Unknown top-level key 'bogus'")).toBe(true);
	});

	it('allows dash-prefixed keys at top level', () => {
		const diags = messages('meta:\n  id: test\n-comment: ignored');
		expect(diags.filter(m => m.includes('-comment'))).toEqual([]);
	});
});

describe('meta validation', () => {
	it('requires id in top-level meta', () => {
		expect(hasMessage('meta:\n  endian: le', "missing required key 'id'")).toBe(true);
	});

	it('no error when meta has id', () => {
		expect(hasMessage('meta:\n  id: test', "missing required key 'id'")).toBe(false);
	});

	it('reports unknown meta key', () => {
		expect(hasMessage('meta:\n  id: test\n  bogus: 1', "Unknown meta key 'bogus'")).toBe(true);
	});

	it('accepts all valid meta keys', () => {
		const yaml = `meta:
  id: test
  endian: le
  bit-endian: be
  file-extension: ksy
  application: test
  title: Test
  license: MIT
  ks-version: "0.9"
  ks-debug: true
  ks-opaque-types: true
  imports: []
  encoding: UTF-8
  xref: {}
  tags: []`;
		const diags = messages(yaml).filter(m => m.includes('Unknown meta key'));
		expect(diags).toEqual([]);
	});

	it('validates endian values', () => {
		expect(hasMessage('meta:\n  id: test\n  endian: lee', "Invalid endian value 'lee'")).toBe(true);
	});

	it('accepts valid endian', () => {
		expect(hasMessage('meta:\n  id: test\n  endian: le', 'Invalid endian')).toBe(false);
		expect(hasMessage('meta:\n  id: test\n  endian: be', 'Invalid endian')).toBe(false);
	});

	it('validates bit-endian values', () => {
		expect(hasMessage('meta:\n  id: test\n  bit-endian: bad', "Invalid bit-endian value 'bad'")).toBe(true);
	});

	it('validates encoding values', () => {
		expect(hasMessage('meta:\n  id: test\n  encoding: NOPE', "Invalid encoding value 'NOPE'")).toBe(true);
	});

	it('accepts valid encodings', () => {
		for (const enc of ['ASCII', 'UTF-8', 'UTF-16BE', 'ISO-8859-1', 'Shift_JIS']) {
			expect(hasMessage(`meta:\n  id: test\n  encoding: ${enc}`, 'Invalid encoding')).toBe(false);
		}
	});

	it('allows dash-prefixed keys in meta', () => {
		expect(hasMessage('meta:\n  id: test\n  -note: something', '-note')).toBe(false);
	});
});

describe('seq / attribute validation', () => {
	it('reports unknown attribute key', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    bogus: 1`;
		expect(hasMessage(yaml, "Unknown attribute key 'bogus'")).toBe(true);
	});

	it('accepts all valid attribute keys', () => {
		const yaml = `meta:
  id: test
seq:
  - id: foo
    type: u4
    size: 4
    size-eos: true
    repeat: eos
    repeat-expr: 3
    repeat-until: _.done
    if: flag
    doc: docs
    doc-ref: ref
    contents: []
    encoding: ASCII
    enum: my_enum
    process: zlib
    pad-right: 0
    terminator: 0
    consume: true
    include: true
    eos-error: true
    valid: {}
    pos: 0
    io: _root._io
    value: 42`;
		const diags = messages(yaml).filter(m => m.includes('Unknown attribute key'));
		expect(diags).toEqual([]);
	});

	it('validates repeat values', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    repeat: bogus`;
		expect(hasMessage(yaml, "Invalid repeat value 'bogus'")).toBe(true);
	});

	it('accepts valid repeat values', () => {
		for (const val of ['eos', 'expr', 'until']) {
			const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    repeat: ${val}`;
			expect(hasMessage(yaml, 'Invalid repeat')).toBe(false);
		}
	});
});

describe('instances validation', () => {
	it('reports unknown instance key', () => {
		const yaml = `meta:\n  id: test\ninstances:\n  foo:\n    bogus: 1`;
		expect(hasMessage(yaml, "Unknown instance key 'bogus'")).toBe(true);
	});

	it('accepts valid instance keys (same as attribute keys)', () => {
		const yaml = `meta:\n  id: test\ninstances:\n  foo:\n    value: 42\n    pos: 0\n    io: _root._io`;
		const diags = messages(yaml).filter(m => m.includes('Unknown instance key'));
		expect(diags).toEqual([]);
	});
});

describe('types validation', () => {
	it('reports unknown type key', () => {
		const yaml = `meta:\n  id: test\ntypes:\n  my_type:\n    bogus: 1`;
		expect(hasMessage(yaml, "Unknown type key 'bogus'")).toBe(true);
	});

	it('accepts valid type keys', () => {
		const yaml = `meta:\n  id: test\ntypes:\n  my_type:\n    seq:\n      - id: foo\n        type: u4`;
		const diags = messages(yaml).filter(m => m.includes('Unknown type key'));
		expect(diags).toEqual([]);
	});

	it('validates nested seq in types', () => {
		const yaml = `meta:\n  id: test\ntypes:\n  my_type:\n    seq:\n      - id: foo\n        bogus: 1`;
		expect(hasMessage(yaml, "Unknown attribute key 'bogus'")).toBe(true);
	});

	it('validates nested types recursively', () => {
		const yaml = `meta:\n  id: test\ntypes:\n  outer:\n    types:\n      inner:\n        seq:\n          - id: bar\n            bad_key: 1`;
		expect(hasMessage(yaml, "Unknown attribute key 'bad_key'")).toBe(true);
	});
});

describe('enums validation', () => {
	it('validates enum name format', () => {
		const yaml = `meta:\n  id: test\nenums:\n  BadName:\n    0: a`;
		expect(hasMessage(yaml, "Invalid enum name 'BadName'")).toBe(true);
	});

	it('accepts valid enum names', () => {
		const yaml = `meta:\n  id: test\nenums:\n  good_name:\n    0: a`;
		expect(hasMessage(yaml, 'Invalid enum name')).toBe(false);
	});

	it('reports unknown enum value keys', () => {
		const yaml = `meta:\n  id: test\nenums:\n  my_enum:\n    0:\n      id: a\n      bogus: 1`;
		expect(hasMessage(yaml, "Unknown enum value key 'bogus'")).toBe(true);
	});

	it('accepts valid enum value keys', () => {
		const yaml = `meta:\n  id: test\nenums:\n  my_enum:\n    0:\n      id: a\n      doc: description\n      doc-ref: ref`;
		const diags = messages(yaml).filter(m => m.includes('Unknown enum value key'));
		expect(diags).toEqual([]);
	});
});

describe('params validation', () => {
	it('requires id in params', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - type: u4`;
		expect(hasMessage(yaml, "missing required key 'id'")).toBe(true);
	});

	it('no error when param has id', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type: u4`;
		expect(hasMessage(yaml, "missing required key 'id'")).toBe(false);
	});

	it('reports unknown param key', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    bogus: 1`;
		expect(hasMessage(yaml, "Unknown param key 'bogus'")).toBe(true);
	});

	it('accepts valid param keys', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type: u4\n    doc: docs\n    doc-ref: ref\n    enum: my_enum`;
		const diags = messages(yaml).filter(m => m.includes('Unknown param key'));
		expect(diags).toEqual([]);
	});
});

describe('expression validation in context', () => {
	it('validates expression in size field', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    size: (a +`;
		const diags = parse(yaml).diagnostics;
		const exprDiags = diags.filter(d => d.source === 'kaitai-expression');
		expect(exprDiags.length).toBeGreaterThan(0);
	});

	it('accepts valid expressions in expression keys', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    size: header.length + 4\n    if: flag == true`;
		const diags = parse(yaml).diagnostics;
		const exprDiags = diags.filter(d => d.source === 'kaitai-expression');
		expect(exprDiags).toEqual([]);
	});

	it('validates expression in instance value', () => {
		const yaml = `meta:\n  id: test\ninstances:\n  foo:\n    value: a.`;
		const diags = parse(yaml).diagnostics;
		const exprDiags = diags.filter(d => d.source === 'kaitai-expression');
		expect(exprDiags.length).toBeGreaterThan(0);
	});

	it('skips pure numbers in expression validation', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    size: 42`;
		const diags = parse(yaml).diagnostics;
		const exprDiags = diags.filter(d => d.source === 'kaitai-expression');
		expect(exprDiags).toEqual([]);
	});

	it('skips booleans in expression validation', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    if: true`;
		const diags = parse(yaml).diagnostics;
		const exprDiags = diags.filter(d => d.source === 'kaitai-expression');
		expect(exprDiags).toEqual([]);
	});
});
