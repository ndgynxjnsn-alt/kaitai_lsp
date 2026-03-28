import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { getCompletions } from './kaitai-completion';

let parser: Parser;

beforeAll(async () => {
	await Parser.init();
	const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
	const yamlLang = await Parser.Language.load(wasmPath);
	parser = new Parser();
	parser.setLanguage(yamlLang);
});

function complete(text: string, offset: number) {
	const tree = parser.parse(text);
	const doc = TextDocument.create('file:///test.ksy', 'kaitai-struct', 1, text);
	return getCompletions(tree.rootNode, doc, offset);
}

function labels(text: string, offset: number): string[] {
	return complete(text, offset).map(i => i.label);
}

// Place cursor at the first occurrence of a marker string within the yaml,
// at the start of that marker (useful for key-side positions).
function offsetOf(text: string, marker: string): number {
	const i = text.indexOf(marker);
	if (i === -1) throw new Error(`Marker '${marker}' not found`);
	return i;
}

// ---- Key completions ----

describe('key completions — top level', () => {
	it('suggests top-level keys when cursor is at root level', () => {
		// Cursor at start of a new root-level key (no colon yet)
		const yaml = `meta:\n  id: test\nseq`;
		const ls = labels(yaml, yaml.length); // cursor at end, on 'seq' key side
		expect(ls).toContain('seq');
		expect(ls).toContain('types');
		expect(ls).toContain('instances');
		expect(ls).toContain('enums');
		expect(ls).toContain('params');
	});

	it('does not suggest meta-specific keys at top level', () => {
		const yaml = `meta:\n  id: test\nseq`;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('endian');
		expect(ls).not.toContain('encoding');
	});
});

describe('key completions — meta context', () => {
	it('suggests meta keys inside meta block', () => {
		// Cursor on 'endian' key (no colon yet → key completion mode)
		const yaml = `meta:\n  id: test\n  endian`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('endian');
		expect(ls).toContain('title');
		expect(ls).toContain('encoding');
		expect(ls).toContain('ks-version');
	});

	it('does not suggest top-level keys inside meta', () => {
		const yaml = `meta:\n  id: test\n  endian`;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('seq');
		expect(ls).not.toContain('types');
	});
});

describe('key completions — attribute context (seq item)', () => {
	it('suggests attribute keys inside a seq item', () => {
		// Cursor on 'type' key (before the colon)
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('type');
		expect(ls).toContain('size');
		expect(ls).toContain('repeat');
		expect(ls).toContain('if');
		expect(ls).toContain('enum');
		expect(ls).toContain('doc');
	});

	it('does not suggest top-level keys inside seq item', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type`;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('meta');
		expect(ls).not.toContain('instances');
	});
});

describe('key completions — param context', () => {
	it('suggests param keys inside a params item', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('type');
		expect(ls).toContain('id');
		expect(ls).toContain('doc');
		expect(ls).toContain('enum');
	});

	it('does not suggest seq-only keys in param context', () => {
		const yaml = `meta:\n  id: test\nparams:\n  - id: foo\n    type`;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('repeat');
		expect(ls).not.toContain('size');
	});
});

// ---- Value completions — type: ----

describe('value completions — type:', () => {
	it('suggests built-in types', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('u1');
		expect(ls).toContain('u4');
		expect(ls).toContain('s2');
		expect(ls).toContain('str');
		expect(ls).toContain('bytes');
		expect(ls).toContain('b8');
	});

	it('suggests user-defined types from types: section', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'types:',
			'  my_header:',
			'    seq: []',
			'seq:',
			'  - id: hdr',
			'    type: ',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('my_header');
		expect(ls).toContain('u4'); // built-ins still present
	});

	it('does not suggest non-type values', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('le');
		expect(ls).not.toContain('eos');
	});
});

// ---- Value completions — enum: ----

describe('value completions — enum:', () => {
	it('suggests enum names', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'enums:',
			'  sections:',
			'    1: struct',
			'  file_type:',
			'    0: text',
			'seq:',
			'  - id: kind',
			'    type: u1',
			'    enum: ',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('sections');
		expect(ls).toContain('file_type');
	});

	it('does not suggest built-in types for enum:', () => {
		const yaml = `meta:\n  id: test\nenums:\n  sect:\n    1: a\nseq:\n  - id: x\n    enum: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('u4');
	});
});

// ---- Value completions — fixed values ----

describe('value completions — endian:', () => {
	it('suggests le and be', () => {
		const yaml = `meta:\n  id: test\n  endian: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('le');
		expect(ls).toContain('be');
		expect(ls).toHaveLength(2);
	});
});

describe('value completions — bit-endian:', () => {
	it('suggests le and be', () => {
		const yaml = `meta:\n  id: test\n  bit-endian: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('le');
		expect(ls).toContain('be');
	});
});

describe('value completions — repeat:', () => {
	it('suggests eos, expr, until', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u1\n    repeat: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('eos');
		expect(ls).toContain('expr');
		expect(ls).toContain('until');
		expect(ls).toHaveLength(3);
	});
});

describe('value completions — boolean flags', () => {
	it('suggests true/false for size-eos', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    size-eos: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('true');
		expect(ls).toContain('false');
	});

	it('suggests true/false for eos-error', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: str\n    eos-error: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('true');
		expect(ls).toContain('false');
	});
});

// ---- Value completions — expression keys ----

describe('value completions — expression keys', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'seq:',
		'  - id: flag',
		'    type: u1',
		'  - id: data',
		'    type: u4',
		'    if: ',
	].join('\n');

	it('suggests field names for if:', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('flag');
		expect(ls).toContain('data');
	});

	it('suggests special identifiers for if:', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('_parent');
		expect(ls).toContain('_root');
		expect(ls).toContain('_io');
		expect(ls).toContain('_index');
		expect(ls).toContain('_');
	});

	it('suggests keywords for if:', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('true');
		expect(ls).toContain('false');
		expect(ls).toContain('not');
		expect(ls).toContain('and');
		expect(ls).toContain('or');
	});

	it('suggests enum names in expression context', () => {
		const yamlWithEnum = [
			'meta:',
			'  id: test',
			'enums:',
			'  sections:',
			'    1: struct',
			'seq:',
			'  - id: kind',
			'    type: u1',
			'    if: ',
		].join('\n');
		const ls = labels(yamlWithEnum, yamlWithEnum.length);
		expect(ls).toContain('sections');
	});

	it('suggests field names for size:', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: len\n    type: u2\n  - id: body\n    size: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('len');
	});

	it('suggests field names from nested types', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'types:',
			'  inner:',
			'    seq:',
			'      - id: nested_field',
			'        type: u1',
			'seq:',
			'  - id: data',
			'    type: u4',
			'    if: ',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('nested_field');
		expect(ls).toContain('data');
	});

	it('suggests instance names in expressions', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'instances:',
			'  my_inst:',
			'    value: 42',
			'seq:',
			'  - id: x',
			'    size: ',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('my_inst');
	});

	it('suggests expression items for repeat-expr:', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: count\n    type: u4\n  - id: items\n    type: u1\n    repeat: expr\n    repeat-expr: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('count');
		expect(ls).toContain('_parent');
		expect(ls).toContain('true');
	});

	it('suggests expression items for value: in instances', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: len\n    type: u4\ninstances:\n  computed:\n    value: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('len');
		expect(ls).toContain('_root');
	});
});

// ---- Dot completions ----

describe('dot completions — _root.', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'seq:',
		'  - id: header',
		'    type: u4',
		'instances:',
		'  len_sector:',
		'    value: 0x200',
		'  descriptor:',
		'    pos: start_descriptor * _root.',
	].join('\n');

	it('suggests root-level seq fields after _root.', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('header');
	});

	it('suggests root-level instances after _root.', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('len_sector');
	});

	it('does not suggest methods after _root.', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).not.toContain('to_i');
		expect(ls).not.toContain('length');
	});

	it('suggests root fields even when typing a partial name after _root.', () => {
		const yaml = `meta:\n  id: t\ninstances:\n  len_sector:\n    value: 0x200\n  other:\n    pos: _root.len`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('len_sector');
	});
});

describe('dot completions — _parent.', () => {
	it('suggests all field names after _parent.', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'seq:',
			'  - id: num_vertices',
			'    type: u4',
			'instances:',
			'  computed:',
			'    pos: _parent.',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('num_vertices');
		expect(ls).not.toContain('to_i');
	});
});

describe('dot completions', () => {
	it('suggests methods after a dot', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u1\n    size: foo.`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('to_i');
		expect(ls).toContain('to_s');
		expect(ls).toContain('length');
		expect(ls).toContain('size');
		expect(ls).toContain('first');
		expect(ls).toContain('last');
	});

	it('does not suggest field names after a dot', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: my_field\n    type: u1\n    size: my_field.`;
		const ls = labels(yaml, yaml.length);
		expect(ls).not.toContain('my_field');
		expect(ls).not.toContain('_parent');
	});

	it('suggests methods after partial method name following dot', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u1\n    size: foo.to`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('to_i');
		expect(ls).toContain('to_s');
	});

	it('suggests methods for _io.', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u1\n    size: _io.`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('eof');
		expect(ls).toContain('size');
	});
});

// ---- to-string ----

describe('to-string expression completions', () => {
	it('suggests field names and keywords for to-string:', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: name\n    type: u1\nto-string: `;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('name');
		expect(ls).toContain('_root');
		expect(ls).toContain('true');
	});
});

// ---- Enum member (::) completions ----

describe('enum member completions — ::', () => {
	const ksy = [
		'meta:',
		'  id: test',
		'enums:',
		'  sections:',
		'    1: struct',
		'    2: clump',
		'    3: frame_list',
		'  file_type:',
		'    0: text',
		'    1: binary',
		'seq:',
		'  - id: kind',
		'    type: u1',
		'    if: sections::',
	].join('\n');

	it('suggests enum members after EnumName::', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).toContain('struct');
		expect(ls).toContain('clump');
		expect(ls).toContain('frame_list');
	});

	it('does not suggest members from other enums', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).not.toContain('text');
		expect(ls).not.toContain('binary');
	});

	it('does not suggest field names or keywords after ::', () => {
		const ls = labels(ksy, ksy.length);
		expect(ls).not.toContain('kind');
		expect(ls).not.toContain('_root');
		expect(ls).not.toContain('true');
	});

	it('suggests members after partial member name', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'enums:',
			'  sections:',
			'    1: struct',
			'    2: clump',
			'seq:',
			'  - id: kind',
			'    type: u1',
			'    if: sections::cl',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('struct');
		expect(ls).toContain('clump');
	});

	it('works in size: context', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'enums:',
			'  my_enum:',
			'    5: five',
			'seq:',
			'  - id: x',
			'    size: my_enum::',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('five');
	});

	it('suggests members from enums defined inside nested types', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'types:',
			'  inner:',
			'    enums:',
			'      kind:',
			'        0: unknown',
			'        1: known',
			'    seq:',
			'      - id: x',
			'        type: u1',
			'        if: kind::',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('unknown');
		expect(ls).toContain('known');
	});

	it('suggests members on key side of cases: mapping', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'  endian: le',
			'enums:',
			'  tag:',
			'    1: byte',
			'    2: short',
			'seq:',
			'  - id: body',
			'    type:',
			'      switch-on: kind',
			'      cases:',
			'        tag::',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('byte');
		expect(ls).toContain('short');
	});

	it('suggests members on key side with partial name', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'enums:',
			'  tag:',
			'    1: byte',
			'    2: short',
			'seq:',
			'  - id: body',
			'    type:',
			'      switch-on: kind',
			'      cases:',
			'        tag::sh',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('byte');
		expect(ls).toContain('short');
	});

	it('suggests members for complex enum values with id field', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'enums:',
			'  tag:',
			'    0:',
			'      id: end',
			'      doc: end of list',
			'    1: byte',
			'    2: short',
			'seq:',
			'  - id: kind',
			'    type: u1',
			'    if: tag::',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('end');
		expect(ls).toContain('byte');
		expect(ls).toContain('short');
	});

	it('returns empty for unknown enum name', () => {
		const yaml = [
			'meta:',
			'  id: test',
			'seq:',
			'  - id: x',
			'    type: u1',
			'    if: nonexistent::',
		].join('\n');
		const ls = labels(yaml, yaml.length);
		expect(ls).toHaveLength(0);
	});
});

// ---- Edge cases ----

describe('edge cases', () => {
	it('returns empty for an empty document', () => {
		// Empty doc — cursor at offset 0, no context
		// Key completion at top-level
		const yaml = '';
		const ls = labels(yaml, 0);
		// Should return top-level key suggestions
		expect(ls).toContain('meta');
	});

	it('returns type completions for incomplete type value', () => {
		const yaml = `meta:\n  id: test\nseq:\n  - id: foo\n    type: u`;
		const ls = labels(yaml, yaml.length);
		expect(ls).toContain('u1');
		expect(ls).toContain('u4');
	});
});
