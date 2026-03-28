import * as path from 'path';
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind,
	HoverParams,
	Hover,
	DefinitionParams,
	Location,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import * as yaml from 'js-yaml';
import { validateKaitai } from './kaitai-validation';
import { getHover } from './kaitai-hover';
import { getDefinition } from './kaitai-definition';
import { compileAndGetDiagnostics, buildSymbolDocs, buildEnumDocs } from './kaitai-compiler';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let parser: Parser | null = null;

const COMPILER_DEBOUNCE_MS = 1000;
const compilerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const documentSymbolDocs = new Map<string, Map<string, string>>();
const documentEnumDocs = new Map<string, Map<string, string>>();

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
	connection.console.log('Kaitai Struct LSP: Initializing...');

	try {
		await Parser.init();
		const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-yaml.wasm');
		const yamlLang = await Parser.Language.load(wasmPath);
		parser = new Parser();
		parser.setLanguage(yamlLang);
		connection.console.log('Kaitai Struct LSP: tree-sitter-yaml loaded successfully');
	} catch (err) {
		connection.console.error(`Kaitai Struct LSP: Failed to load tree-sitter: ${err}`);
	}

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			hoverProvider: true,
			definitionProvider: true,
		},
	};
});

connection.onInitialized(() => {
	connection.console.log('Kaitai Struct LSP: Server initialized');
});

documents.onDidChangeContent((change) => {
	validateDocument(change.document);
});

connection.onDefinition((params: DefinitionParams): Location | null => {
	if (!parser) return null;
	const textDocument = documents.get(params.textDocument.uri);
	if (!textDocument) return null;

	const text = textDocument.getText();
	const tree = parser.parse(text);
	const offset = textDocument.offsetAt(params.position);
	return getDefinition(tree.rootNode, textDocument, offset);
});

connection.onHover((params: HoverParams): Hover | null => {
	if (!parser) return null;
	const textDocument = documents.get(params.textDocument.uri);
	if (!textDocument) return null;

	const text = textDocument.getText();
	const tree = parser.parse(text);
	const offset = textDocument.offsetAt(params.position);
	const symbolDocs = documentSymbolDocs.get(params.textDocument.uri) ?? new Map();
	const enumDocs = documentEnumDocs.get(params.textDocument.uri) ?? new Map();
	return getHover(tree.rootNode, textDocument, offset, symbolDocs, enumDocs);
});

async function validateDocument(textDocument: TextDocument): Promise<void> {
	if (!parser) {
		return;
	}

	const text = textDocument.getText();
	const tree = parser.parse(text);
	const diagnostics: Diagnostic[] = [];

	// Build symbol/enum doc tables eagerly (not debounced) so hover is always up to date
	try {
		const ksyObject = yaml.load(text);
		documentSymbolDocs.set(textDocument.uri, buildSymbolDocs(ksyObject));
		documentEnumDocs.set(textDocument.uri, buildEnumDocs(ksyObject));
	} catch {
		// YAML errors handled by tree-sitter; leave existing tables in place
	}

	collectErrors(tree.rootNode, textDocument, diagnostics);
	diagnostics.push(...validateKaitai(tree.rootNode, textDocument));

	// Send fast diagnostics immediately
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

	// Schedule heavy compiler validation debounced
	scheduleCompilerValidation(textDocument.uri, text, tree, textDocument, diagnostics);
}

function scheduleCompilerValidation(
	uri: string,
	text: string,
	tree: Parser.Tree,
	textDocument: TextDocument,
	baseDiagnostics: Diagnostic[]
): void {
	const existing = compilerTimers.get(uri);
	if (existing) clearTimeout(existing);

	const timer = setTimeout(async () => {
		compilerTimers.delete(uri);
		try {
			const compilerDiags = await compileAndGetDiagnostics(text, tree.rootNode, textDocument);
			connection.sendDiagnostics({
				uri,
				diagnostics: [...baseDiagnostics, ...compilerDiags],
			});
		} catch (err) {
			connection.console.error(`Kaitai compiler error: ${err}`);
		}
	}, COMPILER_DEBOUNCE_MS);

	compilerTimers.set(uri, timer);
}

function collectErrors(
	node: Parser.SyntaxNode,
	textDocument: TextDocument,
	diagnostics: Diagnostic[]
): void {
	if (node.type === 'ERROR') {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(node.startIndex),
				end: textDocument.positionAt(node.endIndex),
			},
			message: 'Syntax error',
			source: 'kaitai-struct',
		});
		return;
	}

	if (node.isMissing()) {
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(node.startIndex),
				end: textDocument.positionAt(node.endIndex),
			},
			message: `Missing ${node.type}`,
			source: 'kaitai-struct',
		});
	}

	for (const child of node.children) {
		collectErrors(child, textDocument, diagnostics);
	}
}

documents.listen(connection);
connection.listen();
