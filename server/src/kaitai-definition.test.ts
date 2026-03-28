import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { getDefinition } from './kaitai-definition';

let parser: Parser;

function definition(text: string, substring: string): ReturnType<typeof getDefinition> {
	const offset = text.indexOf(substring);
	if (offset === -1) throw new Error(`Substring '${substring}' not found`);
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	return getDefinition(tree.rootNode, doc, offset);
}

function definitionAt(text: string, offset: number): ReturnType<typeof getDefinition> {
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	return getDefinition(tree.rootNode, doc, offset);
}

/** Extract the highlighted text from a Location result */
function highlighted(text: string, result: ReturnType<typeof getDefinition>): string | null {
	if (!result) return null;
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	const start = doc.offsetAt(result.range.start);
	const end = doc.offsetAt(result.range.end);
	return text.substring(start, end);
}

beforeAll(async () => {
	await Parser.init();
	const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
	const yamlLang = await Parser.Language.load(wasmPath);
	parser = new Parser();
	parser.setLanguage(yamlLang);
});

describe('type reference → types section', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: header',
		'    type: my_header',
		'types:',
		'  my_header:',
		'    seq:',
		'      - id: magic',
		'        type: u4',
	].join('\n');

	it('navigates to user-defined type definition', () => {
		const result = definition(ksy, 'my_header');
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('my_header');
		// Should point into the types section, not the seq reference
		const typesSectionIndex = ksy.indexOf('types:');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		expect(doc.offsetAt(result!.range.start)).toBeGreaterThan(typesSectionIndex);
	});

	it('returns null for built-in types', () => {
		// 'u4' appears as a type in the nested seq
		const offset = ksy.lastIndexOf('u4');
		expect(definitionAt(ksy, offset)).toBeNull();
	});

	it('returns null when types section is absent', () => {
		const noTypes = [
			'meta:',
			'  id: test',
			'  endian: le',
			'seq:',
			'  - id: foo',
			'    type: missing_type',
		].join('\n');
		expect(definition(noTypes, 'missing_type')).toBeNull();
	});

	it('returns null for an undefined type name', () => {
		const result = definition(ksy, 'magic'); // 'magic' is an id, not a type name
		// 'magic' here is under seq id, not a type key — definition returns null
		// (it's in the id: magic value, not type:)
		expect(result).toBeNull();
	});
});

describe('nested type path (::)', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: h',
		'    type: outer::inner',
		'types:',
		'  outer:',
		'    seq:',
		'      - id: x',
		'        type: u1',
		'    types:',
		'      inner:',
		'        seq:',
		'          - id: y',
		'            type: u1',
	].join('\n');

	it('navigates to first segment (outer) when cursor is on it', () => {
		// cursor on 'outer' in 'outer::inner'
		const outerOffset = ksy.indexOf('outer::inner');
		const result = definitionAt(ksy, outerOffset + 2); // cursor on 'outer'
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('outer');
		// Must be in the types section definition
		const typesSectionIndex = ksy.indexOf('types:');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		expect(doc.offsetAt(result!.range.start)).toBeGreaterThan(typesSectionIndex);
	});

	it('navigates to nested type (inner) when cursor is on second segment', () => {
		// cursor on 'inner' in 'outer::inner'
		const innerOffset = ksy.indexOf('outer::inner') + 'outer::'.length;
		const result = definitionAt(ksy, innerOffset + 1); // cursor on 'inner'
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('inner');
	});
});

describe('enum reference → enums section', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: kind',
		'    type: u1',
		'    enum: file_type',
		'enums:',
		'  file_type:',
		'    0: unknown',
		'    1: regular',
	].join('\n');

	it('navigates to enum definition', () => {
		const result = definition(ksy, 'file_type');
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('file_type');
		// Must point into enums section
		const enumsSectionIndex = ksy.indexOf('enums:');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		expect(doc.offsetAt(result!.range.start)).toBeGreaterThan(enumsSectionIndex);
	});

	it('returns null when enum not found', () => {
		const result = definition(ksy, 'unknown');
		expect(result).toBeNull();
	});
});

describe('expression value → seq field definition', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: count',
		'    type: u4',
		'  - id: data',
		'    type: u1',
		'    repeat: expr',
		'    repeat-expr: count',
	].join('\n');

	it('navigates from repeat-expr to the referenced seq field', () => {
		// 'count' appears both as an id definition and in repeat-expr value
		const repeatExprOffset = ksy.lastIndexOf('count');
		const result = definitionAt(ksy, repeatExprOffset + 1);
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('count');
		// Should point to the first 'count' (the id value), not the repeat-expr value
		const firstCountOffset = ksy.indexOf('count');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		expect(doc.offsetAt(result!.range.start)).toBe(firstCountOffset);
	});

	it('navigates from size to seq field', () => {
		const ksy2 = [
			'meta:',
			'  id: test',
			'  endian: le',
			'seq:',
			'  - id: len',
			'    type: u2',
			'  - id: body',
			'    size: len',
		].join('\n');
		// lastIndexOf finds the reference in 'size: len', not the definition 'id: len'
		const offset = ksy2.lastIndexOf('len');
		const result = definitionAt(ksy2, offset + 1);
		expect(result).not.toBeNull();
		expect(highlighted(ksy2, result)).toBe('len');
		// Should point to the definition (first occurrence)
		expect(ksy2.substring(ksy2.indexOf('len'), ksy2.indexOf('len') + 3)).toBe('len');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy2);
		expect(doc.offsetAt(result!.range.start)).toBe(ksy2.indexOf('len'));
	});

	it('navigates from if expression to seq field', () => {
		const ksy3 = [
			'meta:',
			'  id: test',
			'  endian: le',
			'seq:',
			'  - id: flag',
			'    type: u1',
			'  - id: payload',
			'    type: u4',
			'    if: flag',
		].join('\n');
		// lastIndexOf finds the reference in 'if: flag', not the definition 'id: flag'
		const offset = ksy3.lastIndexOf('flag');
		const result = definitionAt(ksy3, offset + 1);
		expect(result).not.toBeNull();
		expect(highlighted(ksy3, result)).toBe('flag');
	});

	it('returns null for unknown identifier in expression', () => {
		const ksy4 = [
			'meta:',
			'  id: test',
			'  endian: le',
			'seq:',
			'  - id: data',
			'    size: nonexistent',
		].join('\n');
		expect(definition(ksy4, 'nonexistent')).toBeNull();
	});
});

describe('expression value → instances definition', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: raw',
		'    size: 4',
		'instances:',
		'  parsed_value:',
		'    value: raw',
		'  doubled:',
		'    value: parsed_value',
	].join('\n');

	it('navigates from value expression to instance definition', () => {
		// 'parsed_value' in 'value: parsed_value' should jump to 'parsed_value:' in instances
		const offset = ksy.lastIndexOf('parsed_value');
		const result = definitionAt(ksy, offset + 3);
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('parsed_value');
		// Should be the instances key, not the value reference
		const instancesIndex = ksy.indexOf('instances:');
		const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, ksy);
		expect(doc.offsetAt(result!.range.start)).toBeGreaterThan(instancesIndex);
	});

	it('navigates from expression to seq field (raw)', () => {
		// 'raw' in 'value: raw' → seq field
		const offset = ksy.indexOf('value: raw') + 'value: '.length;
		const result = definitionAt(ksy, offset);
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('raw');
	});
});

describe('no definition', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: foo',
		'    type: u4',
	].join('\n');

	it('returns null when hovering on a key (not a value)', () => {
		// 'type' is a key — no definition
		const result = definition(ksy, 'type');
		expect(result).toBeNull();
	});

	it('returns null when hovering on a non-navigable value', () => {
		// 'le' is a meta endian value — not a type/enum/expression key
		const result = definition(ksy, 'le');
		expect(result).toBeNull();
	});

	it('returns null for values not under a recognized key', () => {
		const ksy2 = 'meta:\n  id: test\n  endian: le\nseq:\n  - id: foo\n    doc: some reference';
		expect(definition(ksy2, 'reference')).toBeNull();
	});
});

describe('nested types field search', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'  endian: le',
		'seq:',
		'  - id: header',
		'    type: my_type',
		'types:',
		'  my_type:',
		'    seq:',
		'      - id: inner_field',
		'        type: u4',
		'    instances:',
		'      computed:',
		'        value: inner_field',
	].join('\n');

	it('finds field defined in a nested type seq', () => {
		// 'inner_field' in 'value: inner_field' should navigate to inner_field definition
		const offset = ksy.lastIndexOf('inner_field');
		const result = definitionAt(ksy, offset + 2);
		expect(result).not.toBeNull();
		expect(highlighted(ksy, result)).toBe('inner_field');
	});
});
