import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
import { EXPRESSION_KEYS } from './kaitai-expression';
import { STRING_ENCODINGS } from './kaitai-validation';

// ---- AST helpers (same pattern as other modules) ----

function extractScalarText(node: Parser.SyntaxNode): string | null {
	if (node.type === 'flow_node' || node.type === 'block_node') {
		for (const child of node.children) {
			const t = extractScalarText(child);
			if (t !== null) return t;
		}
		return null;
	}
	if (
		node.type === 'plain_scalar' ||
		node.type === 'single_quote_scalar' ||
		node.type === 'double_quote_scalar'
	) {
		for (const child of node.children) {
			if (child.type === 'string_scalar') return child.text;
		}
		return node.text;
	}
	if (node.type === 'string_scalar') return node.text;
	return null;
}

function getKeyText(pair: Parser.SyntaxNode): string | null {
	const keyNode = pair.childForFieldName('key');
	if (!keyNode) return null;
	return extractScalarText(keyNode);
}

function findDocumentMapping(root: Parser.SyntaxNode): Parser.SyntaxNode | null {
	// Normal case: stream > document > block_node > block_mapping
	for (const child of root.children) {
		if (child.type === 'document') {
			for (const dc of child.children) {
				if (dc.type === 'block_node') {
					for (const bc of dc.children) {
						if (bc.type === 'block_mapping') return bc;
					}
				}
			}
		}
	}

	// Error recovery: tree-sitter may create an ERROR root with block_mapping_pair
	// children directly (e.g. when YAML ends with `::` which is an ambiguous token).
	// Return that ERROR node so findPairByKey can traverse its children normally.
	const errorNode = root.type === 'ERROR' ? root : root.children.find(c => c.type === 'ERROR') ?? null;
	if (errorNode?.children.some(c => c.type === 'block_mapping_pair')) return errorNode;

	return null;
}

function findPairByKey(mapping: Parser.SyntaxNode, key: string): Parser.SyntaxNode | null {
	for (const child of mapping.children) {
		if (child.type === 'block_mapping_pair') {
			if (getKeyText(child) === key) return child;
		} else if (child.type === 'block_mapping') {
			const result = findPairByKey(child, key);
			if (result) return result;
		}
	}
	return null;
}

function findMappingIn(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
	if (node.type === 'block_mapping') return node;
	if (node.type === 'block_node' || node.type === 'flow_node') {
		for (const child of node.children) {
			const m = findMappingIn(child);
			if (m) return m;
		}
	}
	return null;
}

function findSequenceIn(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
	if (node.type === 'block_sequence') return node;
	for (const child of node.children) {
		if (child.type === 'block_sequence') return child;
		if (child.type === 'block_node') {
			for (const bc of child.children) {
				if (bc.type === 'block_sequence') return bc;
			}
		}
	}
	return null;
}

function findMappingInItem(item: Parser.SyntaxNode): Parser.SyntaxNode | null {
	for (const child of item.children) {
		if (child.type === 'block_node') {
			for (const bc of child.children) {
				if (bc.type === 'block_mapping') return bc;
			}
		}
		if (child.type === 'block_mapping') return child;
	}
	return null;
}

// ---- Data collection ----

function collectTypeNames(root: Parser.SyntaxNode): string[] {
	const names: string[] = [];
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return names;
	const typesPair = findPairByKey(docMapping, 'types');
	if (!typesPair) return names;
	const typesValue = typesPair.childForFieldName('value');
	if (!typesValue) return names;
	const typesMapping = findMappingIn(typesValue);
	if (!typesMapping) return names;
	for (const child of typesMapping.children) {
		if (child.type === 'block_mapping_pair') {
			const key = getKeyText(child);
			if (key) names.push(key);
		}
	}
	return names;
}

function collectEnumNames(root: Parser.SyntaxNode): string[] {
	const names: string[] = [];
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return names;
	const enumsPair = findPairByKey(docMapping, 'enums');
	if (!enumsPair) return names;
	const enumsValue = enumsPair.childForFieldName('value');
	if (!enumsValue) return names;
	const enumsMapping = findMappingIn(enumsValue);
	if (!enumsMapping) return names;
	for (const child of enumsMapping.children) {
		if (child.type === 'block_mapping_pair') {
			const key = getKeyText(child);
			if (key) names.push(key);
		}
	}
	return names;
}

function collectFieldNames(root: Parser.SyntaxNode): string[] {
	const names: string[] = [];
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return names;
	collectFieldsFromMapping(docMapping, names);
	return names;
}

/** Collect only root-level fields (seq ids + instances keys), without recursing into nested types. */
function collectRootFieldNames(root: Parser.SyntaxNode): string[] {
	const names: string[] = [];
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return names;

	const seqPair = findPairByKey(docMapping, 'seq');
	if (seqPair) {
		const seqValue = seqPair.childForFieldName('value');
		if (seqValue) {
			const seq = findSequenceIn(seqValue);
			if (seq) {
				for (const item of seq.children) {
					if (item.type !== 'block_sequence_item') continue;
					const itemMapping = findMappingInItem(item);
					if (!itemMapping) continue;
					const idPair = findPairByKey(itemMapping, 'id');
					if (!idPair) continue;
					const idValue = idPair.childForFieldName('value');
					if (idValue) {
						const text = extractScalarText(idValue);
						if (text) names.push(text);
					}
				}
			}
		}
	}

	const instancesPair = findPairByKey(docMapping, 'instances');
	if (instancesPair) {
		const instancesValue = instancesPair.childForFieldName('value');
		if (instancesValue) {
			const instancesMapping = findMappingIn(instancesValue);
			if (instancesMapping) {
				for (const child of instancesMapping.children) {
					if (child.type === 'block_mapping_pair') {
						const key = getKeyText(child);
						if (key) names.push(key);
					}
				}
			}
		}
	}

	return names;
}

/** Collect member names (values) from a specific enum. */
function collectEnumMembers(root: Parser.SyntaxNode, enumName: string): string[] {
	const members: string[] = [];
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return members;
	collectEnumMembersFromMapping(docMapping, enumName, members);
	return members;
}

function collectEnumMembersFromMapping(mapping: Parser.SyntaxNode, enumName: string, out: string[]): void {
	const enumsPair = findPairByKey(mapping, 'enums');
	if (enumsPair) {
		const enumsValue = enumsPair.childForFieldName('value');
		if (enumsValue) {
			const enumsMapping = findMappingIn(enumsValue);
			if (enumsMapping) {
				const enumPair = findPairByKey(enumsMapping, enumName);
				if (enumPair) {
					const enumValue = enumPair.childForFieldName('value');
					if (enumValue) {
						const enumMapping = findMappingIn(enumValue);
						if (enumMapping) {
							for (const child of enumMapping.children) {
								if (child.type === 'block_mapping_pair') {
									const valueNode = child.childForFieldName('value');
									if (!valueNode) continue;
									const text = extractScalarText(valueNode);
									if (text) {
										out.push(text);
									} else {
										// Complex enum value: mapping with an `id` field
										// (e.g. `0: { id: end, doc: '...' }`)
										const innerMapping = findMappingIn(valueNode);
										if (innerMapping) {
											const idPair = findPairByKey(innerMapping, 'id');
											if (idPair) {
												const idValue = idPair.childForFieldName('value');
												if (idValue) {
													const idText = extractScalarText(idValue);
													if (idText) out.push(idText);
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Also search inside nested types
	const typesPair = findPairByKey(mapping, 'types');
	if (typesPair) {
		const typesValue = typesPair.childForFieldName('value');
		if (typesValue) {
			const typesMapping = findMappingIn(typesValue);
			if (typesMapping) {
				for (const child of typesMapping.children) {
					if (child.type !== 'block_mapping_pair') continue;
					const typeValue = child.childForFieldName('value');
					if (!typeValue) continue;
					const innerMapping = findMappingIn(typeValue);
					if (innerMapping) collectEnumMembersFromMapping(innerMapping, enumName, out);
				}
			}
		}
	}
}

function collectFieldsFromMapping(mapping: Parser.SyntaxNode, out: string[]): void {
	const seqPair = findPairByKey(mapping, 'seq');
	if (seqPair) {
		const seqValue = seqPair.childForFieldName('value');
		if (seqValue) {
			const seq = findSequenceIn(seqValue);
			if (seq) {
				for (const item of seq.children) {
					if (item.type !== 'block_sequence_item') continue;
					const itemMapping = findMappingInItem(item);
					if (!itemMapping) continue;
					const idPair = findPairByKey(itemMapping, 'id');
					if (!idPair) continue;
					const idValue = idPair.childForFieldName('value');
					if (idValue) {
						const text = extractScalarText(idValue);
						if (text) out.push(text);
					}
				}
			}
		}
	}

	const instancesPair = findPairByKey(mapping, 'instances');
	if (instancesPair) {
		const instancesValue = instancesPair.childForFieldName('value');
		if (instancesValue) {
			const instancesMapping = findMappingIn(instancesValue);
			if (instancesMapping) {
				for (const child of instancesMapping.children) {
					if (child.type === 'block_mapping_pair') {
						const key = getKeyText(child);
						if (key) out.push(key);
					}
				}
			}
		}
	}

	const typesPair = findPairByKey(mapping, 'types');
	if (typesPair) {
		const typesValue = typesPair.childForFieldName('value');
		if (typesValue) {
			const typesMapping = findMappingIn(typesValue);
			if (typesMapping) {
				for (const child of typesMapping.children) {
					if (child.type !== 'block_mapping_pair') continue;
					const typeValue = child.childForFieldName('value');
					if (!typeValue) continue;
					const innerMapping = findMappingIn(typeValue);
					if (innerMapping) collectFieldsFromMapping(innerMapping, out);
				}
			}
		}
	}
}

// ---- Context detection ----

type CompletionSection = 'top-level' | 'meta' | 'attribute' | 'param' | 'type';

const SECTION_KEYS: Partial<Record<string, CompletionSection>> = {
	meta: 'meta',
	seq: 'attribute',
	instances: 'attribute',
	params: 'param',
	types: 'type',
};

/**
 * Walk backwards through the text before the cursor to determine the key-completion context.
 * Uses indentation levels to find the enclosing section key.
 * This is more robust than AST-based detection when the YAML is incomplete (no `:` yet).
 */
function determineKeySection(textDocument: TextDocument, offset: number): CompletionSection {
	const text = textDocument.getText().slice(0, offset);
	const lines = text.split('\n');

	const currentLine = lines[lines.length - 1];
	const currentIndent = currentLine.length - currentLine.trimStart().length;

	for (let i = lines.length - 2; i >= 0; i--) {
		const line = lines[i];
		const trimmed = line.trimStart();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const indent = line.length - trimmed.length;
		if (indent >= currentIndent) continue; // same or deeper level

		// Look for a `key:` pattern at lower indentation
		const keyMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s/.exec(trimmed)
			?? /^([a-zA-Z_][a-zA-Z0-9_-]*):$/.exec(trimmed);
		if (!keyMatch) continue; // not a key line (e.g. sequence item `- ...`)

		const key = keyMatch[1];
		const section = SECTION_KEYS[key];
		if (section) return section;
		// Non-section key (e.g. a nested type name) — keep walking up
	}

	return 'top-level';
}

// ---- Static data ----

export const TOP_LEVEL_KEYS = [
	'meta', 'seq', 'types', 'instances', 'enums', 'doc', 'doc-ref', 'params', 'to-string',
];

export const META_KEYS = [
	'id', 'title', 'endian', 'encoding', 'bit-endian', 'ks-version', 'ks-debug',
	'ks-opaque-types', 'imports', 'application', 'file-extension', 'license', 'xref', 'tags',
];

export const ATTRIBUTE_KEYS = [
	'id', 'type', 'size', 'size-eos', 'repeat', 'repeat-expr', 'repeat-until',
	'if', 'doc', 'doc-ref', 'contents', 'encoding', 'enum', 'process',
	'pad-right', 'terminator', 'consume', 'include', 'eos-error', 'valid',
	'pos', 'io', 'value',
];

export const PARAM_KEYS = ['id', 'type', 'doc', 'doc-ref', 'enum'];

export const BUILTIN_TYPES: string[] = [
	'u1', 'u2', 'u4', 'u8',
	'u2le', 'u4le', 'u8le', 'u2be', 'u4be', 'u8be',
	's1', 's2', 's4', 's8',
	's2le', 's4le', 's8le', 's2be', 's4be', 's8be',
	'f4', 'f8', 'f4le', 'f8le', 'f4be', 'f8be',
	'str', 'strz', 'bytes',
];
for (let i = 1; i <= 64; i++) BUILTIN_TYPES.push(`b${i}`);

const EXPRESSION_METHODS: CompletionItem[] = [
	{ label: 'to_i', kind: CompletionItemKind.Method, detail: 'Convert to integer' },
	{ label: 'to_s', kind: CompletionItemKind.Method, detail: 'Convert to string' },
	{ label: 'to_f', kind: CompletionItemKind.Method, detail: 'Convert to float' },
	{ label: 'length', kind: CompletionItemKind.Property, detail: 'Length of string or array' },
	{ label: 'size', kind: CompletionItemKind.Property, detail: 'Size in bytes' },
	{ label: 'first', kind: CompletionItemKind.Property, detail: 'First element of array' },
	{ label: 'last', kind: CompletionItemKind.Property, detail: 'Last element of array' },
	{ label: 'min', kind: CompletionItemKind.Method, detail: 'Minimum value in array' },
	{ label: 'max', kind: CompletionItemKind.Method, detail: 'Maximum value in array' },
	{ label: 'reverse', kind: CompletionItemKind.Method, detail: 'Reversed copy' },
	{ label: 'substring', kind: CompletionItemKind.Method, detail: 'Substring: .substring(from, to_exclusive)' },
	{ label: 'eof', kind: CompletionItemKind.Property, detail: 'End-of-stream flag (on IO objects)' },
];

const EXPRESSION_SPECIAL: CompletionItem[] = [
	{ label: '_parent', kind: CompletionItemKind.Variable, detail: 'Parent object' },
	{ label: '_root', kind: CompletionItemKind.Variable, detail: 'Root object' },
	{ label: '_io', kind: CompletionItemKind.Variable, detail: 'Current IO stream' },
	{ label: '_index', kind: CompletionItemKind.Variable, detail: 'Current repeat index' },
	{ label: '_', kind: CompletionItemKind.Variable, detail: 'Current repeat item (repeat-until)' },
];

const EXPRESSION_KEYWORDS: CompletionItem[] = [
	{ label: 'true', kind: CompletionItemKind.Keyword },
	{ label: 'false', kind: CompletionItemKind.Keyword },
	{ label: 'not', kind: CompletionItemKind.Keyword },
	{ label: 'or', kind: CompletionItemKind.Keyword },
	{ label: 'and', kind: CompletionItemKind.Keyword },
	{ label: 'sizeof', kind: CompletionItemKind.Keyword, detail: 'Size of a type in bytes' },
	{ label: 'as', kind: CompletionItemKind.Keyword, detail: 'Type cast' },
];

// ---- Main export ----

/**
 * Compute completion items at the given offset in a Kaitai Struct document.
 */
export function getCompletions(
	root: Parser.SyntaxNode,
	textDocument: TextDocument,
	offset: number
): CompletionItem[] {
	const text = textDocument.getText();
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const lineUpToCursor = text.slice(lineStart, offset);

	// Key-side enum member completion: `cases:` key typed as `EnumName::` or `EnumName::partial`.
	// Must be checked before valueMatch because `tag::` is mis-parsed as key=tag prefix=:
	const keyEnumMatch = /^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)::(\w*)$/.exec(lineUpToCursor);
	if (keyEnumMatch) {
		return collectEnumMembers(root, keyEnumMatch[1]).map(m => ({
			label: m,
			kind: CompletionItemKind.EnumMember,
		}));
	}

	// Detect value context: line matches `[- ]key: prefix`
	const valueMatch = /^[ \t]*(?:-[ \t]+)?([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(lineUpToCursor);
	if (valueMatch) {
		const key = valueMatch[1];
		const prefix = valueMatch[2];

		// Enum member completion: `EnumName::` or `EnumName::partial`
		const enumScopeMatch = /([a-zA-Z_][a-zA-Z0-9_]*)::[\w]*$/.exec(prefix);
		if (enumScopeMatch) {
			return collectEnumMembers(root, enumScopeMatch[1]).map(m => ({
				label: m,
				kind: CompletionItemKind.EnumMember,
			}));
		}

		// Dot completion: cursor is after a `.` in an expression value
		const dotMatch = /([a-zA-Z_][a-zA-Z0-9_]*)\.[\w]*$/.exec(prefix);
		if (dotMatch || prefix.endsWith('.')) {
			const base = dotMatch ? dotMatch[1] : '';
			if (base === '_root') {
				return collectRootFieldNames(root).map(f => ({
					label: f, kind: CompletionItemKind.Variable,
				}));
			}
			if (base === '_parent') {
				return collectFieldNames(root).map(f => ({
					label: f, kind: CompletionItemKind.Variable,
				}));
			}
			return EXPRESSION_METHODS;
		}

		return valueCompletions(key, prefix, root);
	}

	// Key completion
	const section = determineKeySection(textDocument, offset);
	return keyCompletions(section);
}

function keyCompletions(section: CompletionSection): CompletionItem[] {
	let keys: string[];
	switch (section) {
		case 'meta': keys = META_KEYS; break;
		case 'attribute': keys = ATTRIBUTE_KEYS; break;
		case 'param': keys = PARAM_KEYS; break;
		case 'type':
		case 'top-level':
		default: keys = TOP_LEVEL_KEYS; break;
	}
	return keys.map(k => ({ label: k, kind: CompletionItemKind.Keyword }));
}

function valueCompletions(key: string, _prefix: string, root: Parser.SyntaxNode): CompletionItem[] {
	if (key === 'type') {
		return [
			...BUILTIN_TYPES.map(t => ({ label: t, kind: CompletionItemKind.TypeParameter })),
			...collectTypeNames(root).map(t => ({ label: t, kind: CompletionItemKind.Class })),
		];
	}

	if (key === 'enum') {
		return collectEnumNames(root).map(e => ({ label: e, kind: CompletionItemKind.Enum }));
	}

	if (key === 'endian' || key === 'bit-endian') {
		return [
			{ label: 'le', kind: CompletionItemKind.Value, detail: 'Little-endian' },
			{ label: 'be', kind: CompletionItemKind.Value, detail: 'Big-endian' },
		];
	}

	if (key === 'repeat') {
		return [
			{ label: 'eos', kind: CompletionItemKind.Value, detail: 'Repeat until end of stream' },
			{ label: 'expr', kind: CompletionItemKind.Value, detail: 'Repeat N times (see repeat-expr)' },
			{ label: 'until', kind: CompletionItemKind.Value, detail: 'Repeat until condition (see repeat-until)' },
		];
	}

	if (key === 'encoding') {
		const PRIORITY: Record<string, string> = { 'UTF-8': '0', 'ASCII': '1' };
		return [...STRING_ENCODINGS].map(e => ({
			label: e,
			kind: CompletionItemKind.Value,
			sortText: (PRIORITY[e] ?? '2') + '_' + e,
		}));
	}

	if (key === 'size-eos' || key === 'ks-debug' || key === 'ks-opaque-types' ||
		key === 'consume' || key === 'include' || key === 'eos-error') {
		return [
			{ label: 'true', kind: CompletionItemKind.Value },
			{ label: 'false', kind: CompletionItemKind.Value },
		];
	}

	if (EXPRESSION_KEYS.has(key) || key === 'to-string') {
		const items: CompletionItem[] = [
			...collectFieldNames(root).map(f => ({ label: f, kind: CompletionItemKind.Variable })),
			...collectEnumNames(root).map(e => ({ label: e, kind: CompletionItemKind.Enum })),
			...EXPRESSION_SPECIAL,
			...EXPRESSION_KEYWORDS,
		];
		return items;
	}

	return [];
}
