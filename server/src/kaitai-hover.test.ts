import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { getHover } from './kaitai-hover';

let parser: Parser;

function hover(text: string, substring: string): ReturnType<typeof getHover> {
	const offset = text.indexOf(substring);
	if (offset === -1) throw new Error(`Substring '${substring}' not found in text`);
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	return getHover(tree.rootNode, doc, offset);
}

function hoverContent(text: string, substring: string): string | null {
	const result = hover(text, substring);
	if (!result) return null;
	if (typeof result.contents === 'string') return result.contents;
	if ('value' in result.contents) return result.contents.value;
	return null;
}

beforeAll(async () => {
	await Parser.init();
	const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
	const yamlLang = await Parser.Language.load(wasmPath);
	parser = new Parser();
	parser.setLanguage(yamlLang);
});

describe('top-level key hover', () => {
	const yaml = `meta:\n  id: test\nseq: []\ntypes: {}\ninstances: {}\nenums: {}\ndoc: hello\ndoc-ref: ref\nparams: []\nto-string: str`;

	it('shows hover for meta', () => {
		const content = hoverContent(yaml, 'meta');
		expect(content).toContain('**meta**');
		expect(content).toContain('top-level');
	});

	it('shows hover for seq', () => {
		const content = hoverContent(yaml, 'seq');
		expect(content).toContain('**seq**');
		expect(content).toContain('primary structure');
	});

	it('shows hover for types', () => {
		const content = hoverContent(yaml, 'types');
		expect(content).toContain('**types**');
		expect(content).toContain('user-defined types');
	});

	it('shows hover for instances', () => {
		const content = hoverContent(yaml, 'instances');
		expect(content).toContain('**instances**');
		expect(content).toContain('outside of normal sequential parsing');
	});

	it('shows hover for enums', () => {
		const content = hoverContent(yaml, 'enums');
		expect(content).toContain('**enums**');
		expect(content).toContain('named enums');
	});

	it('shows hover for doc', () => {
		const content = hoverContent(yaml, 'doc:');
		expect(content).toContain('**doc**');
	});

	it('shows hover for doc-ref', () => {
		const content = hoverContent(yaml, 'doc-ref');
		expect(content).toContain('**doc-ref**');
		expect(content).toContain('original documentation');
	});

	it('shows hover for to-string', () => {
		const content = hoverContent(yaml, 'to-string');
		expect(content).toContain('**to-string**');
		expect(content).toContain('human-readable string');
	});
});

describe('meta key hover', () => {
	const yaml = `meta:\n  id: test\n  title: Test\n  endian: le\n  encoding: UTF-8\n  bit-endian: be\n  ks-version: "0.9"\n  imports: []`;

	it('shows hover for meta id', () => {
		const content = hoverContent(yaml, 'id');
		expect(content).toContain('**id**');
		expect(content).toContain('meta');
		expect(content).toContain('Unique string');
	});

	it('shows hover for title', () => {
		const content = hoverContent(yaml, 'title');
		expect(content).toContain('**title**');
		expect(content).toContain('Brief name');
	});

	it('shows hover for endian', () => {
		const content = hoverContent(yaml, 'endian');
		expect(content).toContain('**endian**');
		expect(content).toContain('byte order');
	});

	it('shows hover for encoding', () => {
		const content = hoverContent(yaml, 'encoding');
		expect(content).toContain('**encoding**');
		expect(content).toContain('character encoding');
	});

	it('shows hover for bit-endian', () => {
		const content = hoverContent(yaml, 'bit-endian');
		expect(content).toContain('**bit-endian**');
		expect(content).toContain('bit endianness');
	});

	it('shows hover for imports', () => {
		const content = hoverContent(yaml, 'imports');
		expect(content).toContain('**imports**');
	});
});

describe('attribute key hover', () => {
	const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u4\n    size: 4\n    repeat: eos\n    if: flag\n    pos: 0\n    io: _root._io\n    value: 42\n    terminator: 0\n    encoding: UTF-8`;

	it('shows hover for attribute id', () => {
		// Match the indented 'id' under the seq item (after '- ')
		const idOffset = yaml.indexOf('- id') + 2; // skip '- ' to land on 'id'
		const tree = parser.parse(yaml);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, yaml);
		const result = getHover(tree.rootNode, doc, idOffset);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**id**');
		expect(content).toContain('attribute');
	});

	it('shows hover for type', () => {
		const content = hoverContent(yaml, 'type');
		expect(content).toContain('**type**');
		expect(content).toContain('data type');
	});

	it('shows hover for size', () => {
		const content = hoverContent(yaml, 'size');
		expect(content).toContain('**size**');
		expect(content).toContain('number of bytes');
	});

	it('shows hover for repeat', () => {
		const content = hoverContent(yaml, 'repeat');
		expect(content).toContain('**repeat**');
		expect(content).toContain('repeated attribute');
	});

	it('shows hover for if', () => {
		const content = hoverContent(yaml, 'if');
		expect(content).toContain('**if**');
		expect(content).toContain('optional');
	});

	it('shows hover for pos', () => {
		const content = hoverContent(yaml, 'pos');
		expect(content).toContain('**pos**');
		expect(content).toContain('position');
	});

	it('shows hover for io', () => {
		const ioOffset = yaml.indexOf('\n    io') + 5; // land on 'io'
		const tree = parser.parse(yaml);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, yaml);
		const result = getHover(tree.rootNode, doc, ioOffset);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**io**');
		expect(content).toContain('IO stream');
	});

	it('shows hover for value', () => {
		const content = hoverContent(yaml, 'value');
		expect(content).toContain('**value**');
		expect(content).toContain('Overrides');
	});

	it('shows hover for terminator', () => {
		const content = hoverContent(yaml, 'terminator');
		expect(content).toContain('**terminator**');
		expect(content).toContain('stop');
	});
});

describe('instance key hover', () => {
	it('shows hover for instance attribute keys', () => {
		const yaml = `meta:\n  id: test\ninstances:\n  foo:\n    value: 42\n    pos: 0`;
		const content = hoverContent(yaml, 'value');
		expect(content).toContain('**value**');
		expect(content).toContain('attribute');
	});
});

describe('param key hover', () => {
	it('shows hover for param id', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type: u4`;
		const idOffset = yaml.indexOf('- id', yaml.indexOf('params')) + 2;
		const tree = parser.parse(yaml);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, yaml);
		const result = getHover(tree.rootNode, doc, idOffset);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**id**');
		expect(content).toContain('param');
	});

	it('shows hover for param type', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type: u4`;
		const content = hoverContent(yaml, 'type');
		expect(content).toContain('**type**');
		expect(content).toContain('param');
	});
});

describe('no hover', () => {
	it('returns null for values (not keys)', () => {
		const yaml = `meta:\n  id: test`;
		// Hover on the value 'test', not the key
		const result = hover(yaml, 'test');
		expect(result).toBeNull();
	});

	it('returns null for unknown keys', () => {
		const yaml = `meta:\n  id: test\nbogus: 1`;
		const result = hover(yaml, 'bogus');
		expect(result).toBeNull();
	});
});
