import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import * as yaml from 'js-yaml';

// The KSC npm package uses a UMD export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const KaitaiStructCompiler = require('kaitai-struct-compiler');

interface IYamlImporter {
	importYaml(name: string, mode: string): Promise<any>;
}

const nullImporter: IYamlImporter = {
	importYaml(_name: string, _mode: string): Promise<any> {
		return Promise.reject(new Error(`Import not supported in LSP`));
	},
};

/**
 * Parse the error message from the Kaitai Struct Compiler.
 * Format: "(type): /path/to/key:\n\terror: description"
 * or: "type: /path/to/key:\n\terror: description"
 */
function parseCompilerError(message: string): { path: string[]; description: string } | null {
	// Match: optional_prefix: /path:\n\tseverity: message
	const match = message.match(/^[^:]*:\s*\/([^:]*?):\s*\n?\s*error:\s*(.+)$/s);
	if (!match) return null;
	const pathStr = match[1];
	const description = match[2].trim();
	const path = pathStr.split('/').filter(p => p.length > 0);
	return { path, description };
}

/**
 * Resolve a KSY path (e.g. ["seq", "0", "type"]) to a tree-sitter node position.
 * Walks the YAML AST following the path components.
 */
function resolvePathToNode(root: Parser.SyntaxNode, path: string[]): Parser.SyntaxNode | null {
	let node = findDocumentMapping(root);
	if (!node) return null;

	for (let i = 0; i < path.length; i++) {
		const segment = path[i];
		const index = parseInt(segment, 10);

		if (!isNaN(index)) {
			// Numeric index — find the Nth item in a block_sequence
			const seqNode = findSequence(node);
			if (!seqNode) return null;
			const item = findSequenceItem(seqNode, index);
			if (!item) return null;
			// The item content is inside block_sequence_item > block_node > block_mapping
			node = findMappingInItem(item) ?? item;
		} else {
			// String key — find the block_mapping_pair with this key
			const pair = findPairByKey(node, segment);
			if (!pair) return null;

			if (i === path.length - 1) {
				// Last segment: return the value node (the erroneous content)
				return pair.childForFieldName('value') ?? pair;
			}

			// Navigate into the value
			const value = pair.childForFieldName('value');
			if (!value) return pair;
			const mapping = findMappingNode(value);
			if (mapping) {
				node = mapping;
			} else {
				// Value might be a sequence (next segment is numeric) or scalar
				node = value;
			}
		}
	}

	return node;
}

function findDocumentMapping(root: Parser.SyntaxNode): Parser.SyntaxNode | null {
	for (const child of root.children) {
		if (child.type === 'document') {
			for (const docChild of child.children) {
				if (docChild.type === 'block_node') {
					for (const blockChild of docChild.children) {
						if (blockChild.type === 'block_mapping') return blockChild;
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
			const keyNode = child.childForFieldName('key');
			if (keyNode && extractText(keyNode) === key) return child;
		} else if (child.type === 'block_mapping') {
			const result = findPairByKey(child, key);
			if (result) return result;
		}
	}
	return null;
}

function findSequence(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
	if (node.type === 'block_sequence') return node;
	if (node.type === 'block_mapping_pair') {
		const value = node.childForFieldName('value');
		if (value) return findSequence(value);
		return null;
	}
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

function findSequenceItem(seq: Parser.SyntaxNode, index: number): Parser.SyntaxNode | null {
	let i = 0;
	for (const child of seq.children) {
		if (child.type === 'block_sequence_item') {
			if (i === index) return child;
			i++;
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

function findMappingNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
	if (node.type === 'block_mapping') return node;
	if (node.type === 'block_node') {
		for (const child of node.children) {
			if (child.type === 'block_mapping') return child;
		}
	}
	return null;
}

function extractText(node: Parser.SyntaxNode): string | null {
	if (node.type === 'flow_node' || node.type === 'block_node') {
		for (const child of node.children) {
			const text = extractText(child);
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

export async function compileAndGetDiagnostics(
	text: string,
	tree: Parser.SyntaxNode,
	textDocument: TextDocument
): Promise<Diagnostic[]> {
	const diagnostics: Diagnostic[] = [];

	let ksyObject: any;
	try {
		ksyObject = yaml.load(text);
	} catch {
		// YAML parse errors are already handled by tree-sitter validation
		return diagnostics;
	}

	if (!ksyObject || typeof ksyObject !== 'object') return diagnostics;

	try {
		await KaitaiStructCompiler.compile('javascript', ksyObject, nullImporter, false);
	} catch (e: any) {
		const message = e?.message ?? String(e);

		// The compiler may throw multiple errors separated by newlines
		// Each error follows the pattern: "prefix: /path:\n\tseverity: msg"
		const errorBlocks = message.split(/\n(?=[^\t])/);

		for (const block of errorBlocks) {
			const parsed = parseCompilerError(block.trim());
			if (!parsed) {
				// Fallback: report at document start
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					message: block.trim(),
					source: 'kaitai-compiler',
				});
				continue;
			}

			const targetNode = resolvePathToNode(tree, parsed.path);
			if (targetNode) {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range: {
						start: textDocument.positionAt(targetNode.startIndex),
						end: textDocument.positionAt(targetNode.endIndex),
					},
					message: parsed.description,
					source: 'kaitai-compiler',
				});
			} else {
				diagnostics.push({
					severity: DiagnosticSeverity.Error,
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
					message: parsed.description,
					source: 'kaitai-compiler',
				});
			}
		}
	}

	return diagnostics;
}
