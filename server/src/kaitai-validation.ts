import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
import { ATTRIBUTE_KEYS, META_KEYS, PARAM_KEYS, TOP_LEVEL_KEYS } from './kaitai-completion';
import { EXPRESSION_KEYS, validateExpression } from './kaitai-expression';


const VALID_ENDIAN = new Set(['le', 'be']);
const VALID_REPEAT = new Set(['eos', 'expr', 'until']);

export const STRING_ENCODINGS = new Set([
	'ASCII', 'UTF-8', 'UTF-16BE', 'UTF-16LE', 'UTF-32BE', 'UTF-32LE',
	'ISO-8859-1', 'ISO-8859-2', 'ISO-8859-3', 'ISO-8859-4', 'ISO-8859-5',
	'ISO-8859-6', 'ISO-8859-7', 'ISO-8859-8', 'ISO-8859-9', 'ISO-8859-10',
	'ISO-8859-11', 'ISO-8859-13', 'ISO-8859-14', 'ISO-8859-15', 'ISO-8859-16',
	'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253',
	'windows-1254', 'windows-1255', 'windows-1256', 'windows-1257',
	'windows-1258', 'IBM437', 'IBM866', 'Shift_JIS', 'Big5', 'EUC-KR',
]);

export function validateKaitai(
	root: Parser.SyntaxNode,
	textDocument: TextDocument
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const doc = findDocumentMapping(root);
	if (!doc) return diagnostics;

	let hasMeta = false;
	let hasMetaId = false;

	for (const pair of iterMappingPairs(doc)) {
		const key = getKeyText(pair);
		if (!key) continue;

		if (key.startsWith('-')) continue;

		if (!TOP_LEVEL_KEYS.includes(key)) {
			addDiagnostic(diagnostics, pair, textDocument,
				`Unknown top-level key '${key}'`, DiagnosticSeverity.Warning);
			continue;
		}

		if (key === 'meta') {
			hasMeta = true;
			hasMetaId = validateMeta(pair, textDocument, diagnostics, true);
		} else if (key === 'seq') {
			validateSeq(pair, textDocument, diagnostics);
		} else if (key === 'types') {
			validateTypes(pair, textDocument, diagnostics);
		} else if (key === 'instances') {
			validateInstances(pair, textDocument, diagnostics);
		} else if (key === 'enums') {
			validateEnums(pair, textDocument, diagnostics);
		} else if (key === 'params') {
			validateParams(pair, textDocument, diagnostics);
		}
	}

	if (hasMeta && !hasMetaId) {
		addDiagnostic(diagnostics, doc, textDocument,
			`Top-level 'meta' is missing required key 'id'`, DiagnosticSeverity.Warning);
	}

	return diagnostics;
}

function validateMeta(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[],
	isTopLevel: boolean = false
): boolean {
	const value = getMappingValue(pair);
	if (!value) return false;

	let hasId = false;

	for (const child of iterMappingPairs(value)) {
		const key = getKeyText(child);
		if (!key) continue;

		if (key.startsWith('-')) continue;

		if (!META_KEYS.includes(key)) {
			addDiagnostic(diagnostics, child, doc,
				`Unknown meta key '${key}'`, DiagnosticSeverity.Warning);
			continue;
		}

		if (key === 'id') hasId = true;

		if (key === 'endian') {
			validateEnumValue(child, doc, diagnostics, VALID_ENDIAN, 'endian');
		} else if (key === 'bit-endian') {
			validateEnumValue(child, doc, diagnostics, VALID_ENDIAN, 'bit-endian');
		} else if (key === 'encoding') {
			validateEnumValue(child, doc, diagnostics, STRING_ENCODINGS, 'encoding', true);
		}
	}

	return hasId;
}

function validateSeq(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const seq = getSequenceValue(pair);
	if (!seq) return;

	for (const item of iterSequenceItems(seq)) {
		validateAttribute(item, doc, diagnostics);
	}
}

function validateAttribute(
	node: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	for (const pair of iterMappingPairs(node)) {
		const key = getKeyText(pair);
		if (!key) continue;

		if (key.startsWith('-')) continue;

		if (!ATTRIBUTE_KEYS.includes(key)) {
			addDiagnostic(diagnostics, pair, doc,
				`Unknown attribute key '${key}'`, DiagnosticSeverity.Warning);
			continue;
		}

		if (key === 'repeat') {
			validateEnumValue(pair, doc, diagnostics, VALID_REPEAT, 'repeat');
		} else if (key === 'encoding') {
			validateEnumValue(pair, doc, diagnostics, STRING_ENCODINGS, 'encoding', true);
		} else if (EXPRESSION_KEYS.has(key)) {
			validateExpressionValue(pair, doc, diagnostics);
		}
	}
}

function validateInstance(
	node: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	for (const pair of iterMappingPairs(node)) {
		const key = getKeyText(pair);
		if (!key) continue;

		if (key.startsWith('-')) continue;

		if (!ATTRIBUTE_KEYS.includes(key)) {
			addDiagnostic(diagnostics, pair, doc,
				`Unknown instance key '${key}'`, DiagnosticSeverity.Warning);
		}

		if (key === 'repeat') {
			validateEnumValue(pair, doc, diagnostics, VALID_REPEAT, 'repeat');
		} else if (key === 'encoding') {
			validateEnumValue(pair, doc, diagnostics, STRING_ENCODINGS, 'encoding', true);
		} else if (EXPRESSION_KEYS.has(key)) {
			validateExpressionValue(pair, doc, diagnostics);
		}
	}
}

function validateTypes(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const value = getMappingValue(pair);
	if (!value) return;

	for (const typePair of iterMappingPairs(value)) {
		const typeBody = getMappingValue(typePair);
		if (!typeBody) continue;

		for (const child of iterMappingPairs(typeBody)) {
			const key = getKeyText(child);
			if (!key) continue;

			if (key.startsWith('-')) continue;

			if (!TOP_LEVEL_KEYS.includes(key)) {
				addDiagnostic(diagnostics, child, doc,
					`Unknown type key '${key}'`, DiagnosticSeverity.Warning);
				continue;
			}

			if (key === 'meta') {
				validateMeta(child, doc, diagnostics);
			} else if (key === 'seq') {
				validateSeq(child, doc, diagnostics);
			} else if (key === 'instances') {
				validateInstances(child, doc, diagnostics);
			} else if (key === 'types') {
				validateTypes(child, doc, diagnostics);
			} else if (key === 'enums') {
				validateEnums(child, doc, diagnostics);
			} else if (key === 'params') {
				validateParams(child, doc, diagnostics);
			}
		}
	}
}

function validateInstances(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const value = getMappingValue(pair);
	if (!value) return;

	for (const instancePair of iterMappingPairs(value)) {
		const instanceBody = getMappingValue(instancePair);
		if (!instanceBody) continue;
		validateInstance(instanceBody, doc, diagnostics);
	}
}

function validateEnums(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const value = getMappingValue(pair);
	if (!value) return;

	for (const enumPair of iterMappingPairs(value)) {
		const enumName = getKeyText(enumPair);
		if (!enumName) continue;

		if (!/^[a-z][a-z0-9_]*$/.test(enumName)) {
			addDiagnostic(diagnostics, enumPair, doc,
				`Invalid enum name '${enumName}'. Must match [a-z][a-z0-9_]*`, DiagnosticSeverity.Warning);
		}

		const enumBody = getMappingValue(enumPair);
		if (!enumBody) continue;

		for (const valuePair of iterMappingPairs(enumBody)) {
			const enumValueBody = getMappingValue(valuePair);
			if (!enumValueBody) continue;

			for (const child of iterMappingPairs(enumValueBody)) {
				const key = getKeyText(child);
				if (!key) continue;
				if (key.startsWith('-')) continue;

				if (!new Set(['id', 'doc', 'doc-ref']).has(key)) {
					addDiagnostic(diagnostics, child, doc,
						`Unknown enum value key '${key}'`, DiagnosticSeverity.Warning);
				}
			}
		}
	}
}

function validateParams(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const seq = getSequenceValue(pair);
	if (!seq) return;

	for (const item of iterSequenceItems(seq)) {
		let hasId = false;
		for (const child of iterMappingPairs(item)) {
			const key = getKeyText(child);
			if (!key) continue;
			if (key.startsWith('-')) continue;

			if (key === 'id') hasId = true;

			if (!PARAM_KEYS.includes(key)) {
				addDiagnostic(diagnostics, child, doc,
					`Unknown param key '${key}'`, DiagnosticSeverity.Warning);
			}
		}

		if (!hasId) {
			addDiagnostic(diagnostics, item, doc,
				`Param is missing required key 'id'`, DiagnosticSeverity.Warning);
		}
	}
}

function validateEnumValue(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[],
	validValues: Set<string>,
	fieldName: string,
	caseInsensitive = false
): void {
	const value = getValueText(pair);
	if (value === null) return;

	const matches = caseInsensitive
		? [...validValues].some(v => v.toLowerCase() === value.toLowerCase())
		: validValues.has(value);
	if (!matches) {
		const valueNode = getValueNode(pair);
		if (valueNode) {
			diagnostics.push({
				severity: DiagnosticSeverity.Error,
				range: {
					start: doc.positionAt(valueNode.startIndex),
					end: doc.positionAt(valueNode.endIndex),
				},
				message: `Invalid ${fieldName} value '${value}'. Expected: ${[...validValues].join(', ')}`,
				source: 'kaitai-struct',
			});
		}
	}
}

function validateExpressionValue(
	pair: Parser.SyntaxNode,
	doc: TextDocument,
	diagnostics: Diagnostic[]
): void {
	const valueText = getValueText(pair);
	if (valueText === null) return;

	// Skip pure numbers — they're valid expressions but not worth tokenizing
	if (/^-?\d+(\.\d+)?$/.test(valueText.trim())) return;
	// Skip booleans
	if (valueText.trim() === 'true' || valueText.trim() === 'false') return;

	const valueNode = getValueNode(pair);
	if (!valueNode) return;

	const errors = validateExpression(valueText);
	for (const error of errors) {
		const nodeStart = valueNode.startIndex;
		// Find the actual text start within the value node (skip quotes etc.)
		const rawText = valueNode.text;
		const textOffset = rawText.indexOf(valueText);
		const baseOffset = nodeStart + (textOffset >= 0 ? textOffset : 0);

		diagnostics.push({
			severity: DiagnosticSeverity.Warning,
			range: {
				start: doc.positionAt(baseOffset + error.offset),
				end: doc.positionAt(baseOffset + error.offset + error.length),
			},
			message: error.message,
			source: 'kaitai-expression',
		});
	}
}

// --- Tree-sitter YAML helpers ---

function findDocumentMapping(root: Parser.SyntaxNode): Parser.SyntaxNode | null {
	// stream > document > block_node > block_mapping
	for (const child of root.children) {
		if (child.type === 'document') {
			for (const docChild of child.children) {
				if (docChild.type === 'block_node') {
					for (const blockChild of docChild.children) {
						if (blockChild.type === 'block_mapping') {
							return blockChild;
						}
					}
				}
			}
		}
	}
	return null;
}

function* iterMappingPairs(node: Parser.SyntaxNode): Generator<Parser.SyntaxNode> {
	for (const child of node.children) {
		if (child.type === 'block_mapping_pair') {
			yield child;
		} else if (child.type === 'block_mapping') {
			yield* iterMappingPairs(child);
		}
	}
}

function* iterSequenceItems(node: Parser.SyntaxNode): Generator<Parser.SyntaxNode> {
	for (const child of node.children) {
		if (child.type === 'block_sequence_item') {
			for (const itemChild of child.children) {
				if (itemChild.type === 'block_node') {
					for (const blockChild of itemChild.children) {
						if (blockChild.type === 'block_mapping') {
							yield blockChild;
						}
					}
				}
			}
		}
	}
}

function getKeyText(pair: Parser.SyntaxNode): string | null {
	const keyNode = pair.childForFieldName('key');
	if (!keyNode) return null;
	return extractScalarText(keyNode);
}

function getValueText(pair: Parser.SyntaxNode): string | null {
	const valueNode = getValueNode(pair);
	if (!valueNode) return null;
	return extractScalarText(valueNode);
}

function getValueNode(pair: Parser.SyntaxNode): Parser.SyntaxNode | null {
	return pair.childForFieldName('value');
}

function getMappingValue(pair: Parser.SyntaxNode): Parser.SyntaxNode | null {
	const value = pair.childForFieldName('value');
	if (!value) return null;
	// value could be block_node > block_mapping, or directly a block_mapping
	if (value.type === 'block_node') {
		for (const child of value.children) {
			if (child.type === 'block_mapping') return child;
		}
	}
	if (value.type === 'block_mapping') return value;
	return null;
}

function getSequenceValue(pair: Parser.SyntaxNode): Parser.SyntaxNode | null {
	const value = pair.childForFieldName('value');
	if (!value) return null;
	if (value.type === 'block_node') {
		for (const child of value.children) {
			if (child.type === 'block_sequence') return child;
		}
	}
	if (value.type === 'block_sequence') return value;
	return null;
}

function extractScalarText(node: Parser.SyntaxNode): string | null {
	if (node.type === 'flow_node' || node.type === 'block_node') {
		for (const child of node.children) {
			const text = extractScalarText(child);
			if (text !== null) return text;
		}
		return null;
	}
	if (node.type === 'plain_scalar' || node.type === 'single_quote_scalar' || node.type === 'double_quote_scalar') {
		for (const child of node.children) {
			if (child.type === 'string_scalar') {
				return child.text;
			}
		}
		return node.text;
	}
	if (node.type === 'string_scalar') {
		return node.text;
	}
	return null;
}

function addDiagnostic(
	diagnostics: Diagnostic[],
	node: Parser.SyntaxNode,
	doc: TextDocument,
	message: string,
	severity: DiagnosticSeverity
): void {
	const keyNode = node.childForFieldName('key');
	const target = keyNode ?? node;
	diagnostics.push({
		severity,
		range: {
			start: doc.positionAt(target.startIndex),
			end: doc.positionAt(target.endIndex),
		},
		message,
		source: 'kaitai-struct',
	});
}
