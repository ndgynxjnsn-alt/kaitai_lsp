import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { getHover } from './kaitai-hover';

let parser: Parser;

function hover(text: string, substring: string, symbolDocs?: Map<string, string>, enumDocs?: Map<string, string>): ReturnType<typeof getHover> {
	const offset = text.indexOf(substring);
	if (offset === -1) throw new Error(`Substring '${substring}' not found in text`);
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	return getHover(tree.rootNode, doc, offset, symbolDocs ?? new Map(), enumDocs ?? new Map());
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
		const result = getHover(tree.rootNode, doc, idOffset, new Map(), new Map());
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
		const result = getHover(tree.rootNode, doc, ioOffset, new Map(), new Map());
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
		const result = getHover(tree.rootNode, doc, idOffset, new Map(), new Map());
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

describe('symbol doc hover', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: primary_geometry',
		'    doc: DOCUMENTATION_GEOMETRY',
		'    size: 0x1000',
		'  - id: primary_metadata',
		'    doc: primary_metadata doc',
		'    size: primary_geometry',
	].join('\n');

	it('shows doc when hovering identifier in expression value', () => {
		// Hover on 'primary_geometry' inside the size value on the last line
		const sizeValueOffset = ksy.lastIndexOf('primary_geometry');
		const tree = parser.parse(ksy);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		const result = getHover(tree.rootNode, doc, sizeValueOffset + 3, new Map([
			['primary_geometry', 'DOCUMENTATION_GEOMETRY'],
		]), new Map());
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('DOCUMENTATION_GEOMETRY');
		expect(content).toContain('**primary_geometry**');
	});

	it('returns null for identifier with no doc in symbol table', () => {
		// hover on id key 'primary_geometry' (a key, not a value) — should use key hover, not symbol hover
		const result = hover(ksy, 'primary_geometry', new Map());
		expect(result).toBeNull();
	});

});

describe('enum hover', () => {
	const enumDocs = new Map([['sections', '`struct` (0x1), `clump` (0x2)']]);

	it('shows enum info when hovering value of enum: key', () => {
		const ksy = `meta:\n  id: t\nseq:\n  - id: x\n    type: u1\n    enum: sections`;
		// hover on 'sections' — it's the value of 'enum:'
		const offset = ksy.lastIndexOf('sections');
		const tree = parser.parse(ksy);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		const result = getHover(tree.rootNode, doc, offset + 2, new Map(), enumDocs);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**sections**');
		expect(content).toContain('enum');
		expect(content).toContain('struct');
	});

	it('shows enum info when hovering enum name in expression value', () => {
		const ksy = `meta:\n  id: t\nseq:\n  - id: x\n    type: u1\n    if: sections`;
		const offset = ksy.lastIndexOf('sections');
		const tree = parser.parse(ksy);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		const result = getHover(tree.rootNode, doc, offset + 2, new Map(), enumDocs);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**sections**');
	});

	it('shows enum info when hovering cases key with enum path', () => {
		const ksy = [
			'meta:',
			'  id: t',
			'  endian: le',
			'seq:',
			'  - id: body',
			'    type:',
			'      switch-on: code',
			'      cases:',
			'        sections::clump: some_type',
		].join('\n');
		const offset = ksy.lastIndexOf('sections');
		const tree = parser.parse(ksy);
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		const result = getHover(tree.rootNode, doc, offset + 2, new Map(), enumDocs);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value;
		expect(content).toContain('**sections**');
		expect(content).toContain('enum');
	});

	it('returns null for enum name not in enumDocs', () => {
		const ksy = `meta:\n  id: t\nseq:\n  - id: x\n    type: u1\n    enum: unknown_enum`;
		const result = hover(ksy, 'unknown_enum', new Map(), new Map());
		expect(result).toBeNull();
	});
});

describe('import path hover', () => {
	const importedDoc = 'MS-DOS date and time are packed 16-bit values that specify local date/time.';
	// symbolDocs simulates what buildSymbolDocs produces after merging imported files:
	// the imported type's meta.id ('dos_datetime') is keyed to its top-level doc.
	const symbolDocs = new Map([['dos_datetime', importedDoc]]);

	const ksy = [
		'meta:',
		'  id: zip',
		'  imports:',
		'    - /common/dos_datetime',
	].join('\n');

	it('shows imported type doc when hovering the type name in the import path', () => {
		// Cursor on 'dos_datetime' (the identifier portion of '/common/dos_datetime')
		const result = hover(ksy, 'dos_datetime', symbolDocs);
		expect(result).not.toBeNull();
		const content = (result!.contents as any).value as string;
		expect(content).toContain('**dos_datetime**');
		expect(content).toContain('MS-DOS');
	});

	it('returns null when hovering the directory component of the import path', () => {
		// 'common' is not a known symbol — no doc expected
		const result = hover(ksy, 'common', symbolDocs);
		expect(result).toBeNull();
	});

	it('returns null when symbolDocs has no entry for the imported type', () => {
		const result = hover(ksy, 'dos_datetime', new Map());
		expect(result).toBeNull();
	});
});
