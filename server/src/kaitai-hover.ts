import { Hover, MarkupKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';

/**
 * Descriptions extracted from ksy_schema.json.
 * Keys are organized by context (top-level, meta, attribute, param).
 */

const TOP_LEVEL_DESCRIPTIONS: Record<string, string> = {
	'meta': 'Metadata about the format specification.',
	'seq': 'Identifier for a primary structure described in top-level map.',
	'instances': 'Description of data that lies outside of normal sequential parsing flow (for example, that requires seeking somewhere in the file) or just needs to be loaded only by special request.\n\nWould be translated into distinct methods (that read desired data on demand) in current class.',
	'types': 'Maps of strings to user-defined types.\n\nDeclares types for substructures that can be referenced in the attributes of `seq` or `instances` element.\n\nWould be directly translated into classes.',
	'enums': 'Allows for the setup of named enums, mappings of integer constants to symbolic names. Can be used with integer attributes using the `enum` key.\n\nWould be represented as enum-like construct (or closest equivalent, if target language doesn\'t support enums), nested or namespaced in current type/class.',
	'doc': 'Used to give a more detailed description of a user-defined type. In most languages, it will be used as a docstring compatible with tools like Javadoc, Doxygen, JSDoc, etc.',
	'doc-ref': 'Used to provide reference to original documentation (if the ksy file is actually an implementation of some documented format).\n\nContains:\n1. URL as text,\n2. arbitrary string, or\n3. URL as text + space + arbitrary string.',
	'params': 'List of parameters that the type accepts.',
	'to-string': 'Expression that provides a human-readable string representation of an object of this user-defined type for debugging purposes.\n\nIt will be used to override `toString()` (or similar) in most target languages, `__str__()` in Python and `to_s` in Ruby; in Rust, it is the `Display` trait.',
};

const META_DESCRIPTIONS: Record<string, string> = {
	'id': 'Unique string that identifies this format.\n\nShould be identical to the file name without the `.ksy` extension (e.g. `microsoft_pe` for `microsoft_pe.ksy`).\n\nUsed to derive the name of the top-level type when generating parsers.\n\nRequired at the top level, shouldn\'t be used at nested levels.',
	'title': 'Brief name of the format.',
	'application': 'Applications that use this format and are typically associated with it.',
	'file-extension': 'File extensions typically used for this format, without the leading dot and in lowercase letters.\n\nShould be sorted from most popular to least popular.',
	'xref': 'Cross-references to external resources about this format.',
	'tags': 'List of tags (categories/keywords) that can be assigned to the format.\n\nUsed in the format gallery to display formats at https://formats.kaitai.io/.\n\nShould be written in `lower_snake_case` and sorted in alphabetical order.',
	'license': 'License under which the KSY file is released.\n\nMust be a valid SPDX expression. We recommend `CC0-1.0` or `MIT`.',
	'ks-version': 'Minimum Kaitai Struct compiler (KSC) version required to compile this .ksy file.\n\nOnly versions 0.6 or higher are accepted.\n\nThe value must sometimes be enclosed in quotes, for example `ks-version: \'0.10\'`.',
	'ks-debug': 'Advise the Kaitai Struct Compiler (KSC) to use debug mode.',
	'ks-opaque-types': 'Advise the Kaitai Struct Compiler (KSC) to ignore missing types in the .ksy file, and assume that these types are already provided externally.',
	'imports': 'List of relative or absolute paths to another `.ksy` files to import (without the `.ksy` extension).\n\nThe top-level type of the imported file will be accessible under the name specified in its `meta/id`.',
	'encoding': 'Default character encoding for string fields (`str` or `strz`) in the current type and its subtypes.',
	'endian': 'Default endianness (byte order) of built-in multibyte numeric types (`sX`, `uX`, `fX`).\n\nApplies to the current type and its subtypes.\n\nRequired if you use any `sX`, `uX` or `fX` types (other than `s1` and `u1`) without an explicit `le` or `be` suffix.',
	'bit-endian': 'Default parsing direction (bit endianness) of bit-sized integers (built-in `bX` types).\n\nBig-endian (`be`) order is default, but it is recommended to specify it explicitly.',
};

const ATTRIBUTE_DESCRIPTIONS: Record<string, string> = {
	'id': 'Contains a string used to identify one attribute among others.',
	'doc': 'Used to give a more detailed description of a user-defined type. In most languages, it will be used as a docstring compatible with tools like Javadoc, Doxygen, JSDoc, etc.',
	'doc-ref': 'Used to provide reference to original documentation.',
	'contents': 'Specify fixed contents that the parser should encounter at this point. If the content of the stream doesn\'t match the given bytes, an error is thrown and it\'s meaningless to continue parsing.',
	'valid': 'Validation constraints that the actual value of the attribute must satisfy, otherwise a `ValidationFailedError` will be raised.',
	'type': 'Defines data type for an attribute.\n\nThe type can also be user-defined in the `types` key.\n\nOne can reference a nested user-defined type by specifying a relative path with `::` as delimiter (e.g. `foo::bar::my_type`).',
	'repeat': 'Designates repeated attribute in a structure.\n\n| Value | Description |\n|---|---|\n| `eos` | repeat until the end of the current stream |\n| `expr` | repeat as many times as specified in `repeat-expr` |\n| `until` | repeat until the expression in `repeat-until` becomes `true` |',
	'repeat-expr': 'Specify number of repetitions for repeated attribute.',
	'repeat-until': 'Specifies a condition to be checked after each parsed item, repeating while the expression is `false`.\n\nOne can use `_` in the expression, which references the last read element.',
	'if': 'Marks the attribute as optional (attribute is parsed only if the condition specified evaluates to `true`).',
	'size': 'The number of bytes to read if `type` isn\'t defined.\n\nCan also be an expression.',
	'size-eos': 'If `true`, reads all the bytes till the end of the stream.\n\nDefault is `false`.',
	'process': 'Specifies an algorithm to be applied to the underlying byte buffer before parsing.\n\nCan be used only if the size is known (`size`, `size-eos: true` or `terminator` are specified).\n\nBuilt-in: `xor(key)`, `rol(n)`, `ror(n)`, `zlib`.',
	'enum': 'Name of existing enum — field data type becomes given enum.',
	'encoding': 'Character encoding for this string field.',
	'pad-right': 'Specify a byte which is the string or byte array padded with after the end up to the total size.\n\nCan be used only with `size` or `size-eos: true`.',
	'terminator': 'String or byte array reading will stop when it encounters this byte.\n\nCannot be used with `type: strz` (which already implies `terminator: 0`).',
	'consume': 'Specify if terminator byte should be "consumed" when reading.\n\nIf `true`: stream pointer will point to the byte after the terminator.\nIf `false`: stream pointer will point to the terminator byte itself.\n\nDefault is `true`.',
	'include': 'Specifies if terminator byte should be considered part of the string read and thus be appended to it.\n\nDefault is `false`.',
	'eos-error': 'Allows the compiler to ignore the lack of a terminator if disabled. String reading will stop at either:\n1. terminator being encountered\n2. end of stream is reached\n\nDefault is `true`.',
	'pos': 'Specifies position at which the value should be parsed.',
	'io': 'Specifies an IO stream from which a value should be parsed.',
	'value': 'Overrides any reading & parsing. Instead, just calculates function specified in value and returns the result as this instance.',
	'switch-on': 'Expression to switch on for determining the type.',
	'cases': 'Map of expression values to types for switch-on.',
};

const PARAM_DESCRIPTIONS: Record<string, string> = {
	'id': 'Identifier for this parameter.',
	'type': 'Specifies "pure" type of the parameter, without any serialization details.\n\nSupported: `u1`-`u8`, `s1`-`s8`, `bX`, `f4`, `f8`, `bytes`, `str`, `bool`/`b1`, `struct`, `io`, `any`, or a user-defined type.\n\nAppend `[]` for arrays (e.g. `u2[]`, `str[]`).',
	'doc': 'Documentation for this parameter.',
	'doc-ref': 'Reference to original documentation.',
	'enum': 'Path to an enum type. Only integer-based enums are supported.',
};

export type KeyContext = 'top-level' | 'meta' | 'attribute' | 'param' | 'type';

function getDescriptionForKey(key: string, context: KeyContext): string | undefined {
	switch (context) {
		case 'top-level':
		case 'type':
			return TOP_LEVEL_DESCRIPTIONS[key];
		case 'meta':
			return META_DESCRIPTIONS[key];
		case 'attribute':
			return ATTRIBUTE_DESCRIPTIONS[key];
		case 'param':
			return PARAM_DESCRIPTIONS[key];
	}
}

/**
 * Determine the context of a block_mapping_pair by walking up the tree.
 * Skips the pair itself and looks at ancestor pairs to determine context.
 */
function determineKeyContext(pair: Parser.SyntaxNode): KeyContext {
	// Walk up from the pair's parent to find the enclosing section
	let node: Parser.SyntaxNode | null = pair.parent;
	while (node) {
		if (node.type === 'block_mapping_pair') {
			const parentKey = getKeyTextFromPair(node);
			if (parentKey === 'meta') return 'meta';
			if (parentKey === 'seq' || parentKey === 'instances') return 'attribute';
			if (parentKey === 'params') return 'param';
			if (parentKey === 'types') return 'type';
		}
		node = node.parent;
	}
	return 'top-level';
}

function getKeyTextFromPair(pair: Parser.SyntaxNode): string | null {
	const keyNode = pair.childForFieldName('key');
	if (!keyNode) return null;
	return extractScalarText(keyNode);
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
			if (child.type === 'string_scalar') return child.text;
		}
		return node.text;
	}
	if (node.type === 'string_scalar') return node.text;
	return null;
}

/**
 * Find the block_mapping_pair node at the given offset, if the cursor is on a key.
 */
function findKeyPairAtOffset(root: Parser.SyntaxNode, offset: number): { pair: Parser.SyntaxNode; key: string } | null {
	// Find the deepest node at offset
	let node = root.descendantForIndex(offset);
	if (!node) return null;

	// Walk up to find a block_mapping_pair and check if we're on the key side
	let current: Parser.SyntaxNode | null = node;
	while (current) {
		if (current.type === 'block_mapping_pair') {
			const keyNode = current.childForFieldName('key');
			if (keyNode && offset >= keyNode.startIndex && offset <= keyNode.endIndex) {
				const key = extractScalarText(keyNode);
				if (key) return { pair: current, key };
			}
			return null;
		}
		current = current.parent;
	}
	return null;
}

export function getHover(
	root: Parser.SyntaxNode,
	textDocument: TextDocument,
	offset: number
): Hover | null {
	const result = findKeyPairAtOffset(root, offset);
	if (!result) return null;

	const { pair, key } = result;
	const context = determineKeyContext(pair);
	const description = getDescriptionForKey(key, context);
	if (!description) return null;

	const keyNode = pair.childForFieldName('key')!;
	return {
		contents: {
			kind: MarkupKind.Markdown,
			value: `**${key}** _(${context})_\n\n${description}`,
		},
		range: {
			start: textDocument.positionAt(keyNode.startIndex),
			end: textDocument.positionAt(keyNode.endIndex),
		},
	};
}
