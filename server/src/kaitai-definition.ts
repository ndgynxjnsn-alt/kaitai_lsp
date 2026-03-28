import { Location } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import { EXPRESSION_KEYS } from './kaitai-expression';

const BUILTIN_TYPES = new Set([
	'u1', 'u2', 'u4', 'u8',
	'u2le', 'u4le', 'u8le', 'u2be', 'u4be', 'u8be',
	's1', 's2', 's4', 's8',
	's2le', 's4le', 's8le', 's2be', 's4be', 's8be',
	'f4', 'f8', 'f4le', 'f8le', 'f4be', 'f8be',
	'str', 'strz', 'bytes',
]);

for (let i = 1; i <= 64; i++) BUILTIN_TYPES.add(`b${i}`);

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

/**
 * Find the word (identifier) at cursor within the value side of a block_mapping_pair.
 * Returns { keyName, word, fullValue } where fullValue is the complete value text.
 */
function findValueContext(
	root: Parser.SyntaxNode,
	offset: number
): { keyName: string; word: string; fullValue: string; valueNode: Parser.SyntaxNode } | null {
	const node = root.descendantForIndex(offset);
	if (!node) return null;

	let current: Parser.SyntaxNode | null = node;
	let pair: Parser.SyntaxNode | null = null;
	while (current) {
		if (current.type === 'block_mapping_pair') {
			pair = current;
			break;
		}
		current = current.parent;
	}
	if (!pair) return null;

	const keyNode = pair.childForFieldName('key');
	const valueNode = pair.childForFieldName('value');
	if (!keyNode || offset <= keyNode.endIndex) return null;
	if (!valueNode) return null;

	const keyName = extractScalarText(keyNode);
	if (!keyName) return null;

	const fullValue = extractScalarText(valueNode) ?? '';

	const text = node.text;
	const rel = offset - node.startIndex;
	if (rel < 0 || rel > text.length) return null;

	const wordRe = /[a-zA-Z_][a-zA-Z0-9_]*/g;
	let m: RegExpExecArray | null;
	while ((m = wordRe.exec(text)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		if (start <= rel && rel <= end) {
			return { keyName, word: m[0], fullValue, valueNode };
		}
	}
	return null;
}

function locationOfKeyNode(keyNode: Parser.SyntaxNode, textDocument: TextDocument): Location {
	return {
		uri: textDocument.uri,
		range: {
			start: textDocument.positionAt(keyNode.startIndex),
			end: textDocument.positionAt(keyNode.endIndex),
		},
	};
}

/**
 * Resolve a `::` type path starting from a given types mapping.
 * Returns the location of the key node for the resolved type, or null.
 */
function resolveTypePath(
	typesMapping: Parser.SyntaxNode,
	parts: string[],
	textDocument: TextDocument
): Location | null {
	let currentMapping = typesMapping;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const targetPair = findPairByKey(currentMapping, part);
		if (!targetPair) return null;

		if (i === parts.length - 1) {
			const keyNode = targetPair.childForFieldName('key');
			if (!keyNode) return null;
			return locationOfKeyNode(keyNode, textDocument);
		}

		// Navigate into this type's nested types section
		const typeValue = targetPair.childForFieldName('value');
		if (!typeValue) return null;
		const innerMapping = findMappingIn(typeValue);
		if (!innerMapping) return null;
		const innerTypesPair = findPairByKey(innerMapping, 'types');
		if (!innerTypesPair) return null;
		const innerTypesValue = innerTypesPair.childForFieldName('value');
		if (!innerTypesValue) return null;
		const innerTypesMapping = findMappingIn(innerTypesValue);
		if (!innerTypesMapping) return null;
		currentMapping = innerTypesMapping;
	}
	return null;
}

/**
 * Resolve a type reference. The cursor word determines how much of the
 * `::` path to resolve (cursor on first segment → navigate to first type,
 * cursor on second → navigate to first::second, etc.).
 *
 * fullValue is the complete type string (e.g. "foo::bar::baz").
 * word is the segment the cursor is on.
 */
function findTypeDefinition(
	root: Parser.SyntaxNode,
	word: string,
	fullValue: string,
	textDocument: TextDocument
): Location | null {
	if (BUILTIN_TYPES.has(fullValue)) return null;

	// Determine which path prefix to resolve based on cursor position
	const parts = fullValue.split('::');
	const cursorSegIndex = parts.indexOf(word);
	// If word not found in path (shouldn't happen), resolve the whole path
	const pathToResolve = cursorSegIndex >= 0 ? parts.slice(0, cursorSegIndex + 1) : parts;

	const docMapping = findDocumentMapping(root);
	if (!docMapping) return null;

	const typesPair = findPairByKey(docMapping, 'types');
	if (!typesPair) return null;

	const typesValue = typesPair.childForFieldName('value');
	if (!typesValue) return null;

	const typesMapping = findMappingIn(typesValue);
	if (!typesMapping) return null;

	return resolveTypePath(typesMapping, pathToResolve, textDocument);
}

function findEnumDefinition(
	root: Parser.SyntaxNode,
	enumName: string,
	textDocument: TextDocument
): Location | null {
	const docMapping = findDocumentMapping(root);
	if (!docMapping) return null;

	const enumsPair = findPairByKey(docMapping, 'enums');
	if (!enumsPair) return null;

	const enumsValue = enumsPair.childForFieldName('value');
	if (!enumsValue) return null;

	const enumsMapping = findMappingIn(enumsValue);
	if (!enumsMapping) return null;

	const targetPair = findPairByKey(enumsMapping, enumName);
	if (!targetPair) return null;

	const keyNode = targetPair.childForFieldName('key');
	if (!keyNode) return null;
	return locationOfKeyNode(keyNode, textDocument);
}

/**
 * Search for a field definition (by id) in seq and instances, recursively
 * through nested types. Returns the location of the id value node in seq,
 * or the key node in instances.
 */
function searchFieldInMapping(
	mapping: Parser.SyntaxNode,
	fieldName: string,
	textDocument: TextDocument
): Location | null {
	// seq items
	const seqPair = findPairByKey(mapping, 'seq');
	if (seqPair) {
		const seqValue = seqPair.childForFieldName('value');
		if (seqValue) {
			const seq = findSequenceIn(seqValue);
			if (seq) {
				for (const child of seq.children) {
					if (child.type !== 'block_sequence_item') continue;
					const itemMapping = findMappingInItem(child);
					if (!itemMapping) continue;
					const idPair = findPairByKey(itemMapping, 'id');
					if (!idPair) continue;
					const idValue = idPair.childForFieldName('value');
					if (!idValue) continue;
					if (extractScalarText(idValue) === fieldName) {
						return {
							uri: textDocument.uri,
							range: {
								start: textDocument.positionAt(idValue.startIndex),
								end: textDocument.positionAt(idValue.endIndex),
							},
						};
					}
				}
			}
		}
	}

	// instances — keys are the field names
	const instancesPair = findPairByKey(mapping, 'instances');
	if (instancesPair) {
		const instancesValue = instancesPair.childForFieldName('value');
		if (instancesValue) {
			const instancesMapping = findMappingIn(instancesValue);
			if (instancesMapping) {
				const targetPair = findPairByKey(instancesMapping, fieldName);
				if (targetPair) {
					const keyNode = targetPair.childForFieldName('key');
					if (keyNode) return locationOfKeyNode(keyNode, textDocument);
				}
			}
		}
	}

	// Recurse into nested types
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
					if (!innerMapping) continue;
					const loc = searchFieldInMapping(innerMapping, fieldName, textDocument);
					if (loc) return loc;
				}
			}
		}
	}

	return null;
}

export function getDefinition(
	root: Parser.SyntaxNode,
	textDocument: TextDocument,
	offset: number
): Location | null {
	const ctx = findValueContext(root, offset);
	if (!ctx) return null;

	if (ctx.keyName === 'type') {
		return findTypeDefinition(root, ctx.word, ctx.fullValue, textDocument);
	}

	if (ctx.keyName === 'enum') {
		return findEnumDefinition(root, ctx.fullValue, textDocument);
	}

	if (EXPRESSION_KEYS.has(ctx.keyName)) {
		const docMapping = findDocumentMapping(root);
		if (!docMapping) return null;
		return searchFieldInMapping(docMapping, ctx.word, textDocument);
	}

	return null;
}
