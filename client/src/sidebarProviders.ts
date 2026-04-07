import * as path from 'path';
import * as vscode from 'vscode';

interface DirNode { kind: 'dir'; fsPath: string; label: string; children: TreeNode[] }
interface FileNode { kind: 'file'; uri: vscode.Uri; label: string }
type TreeNode = DirNode | FileNode;

function buildTree(uris: readonly vscode.Uri[]): TreeNode[] {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return [];

	const sorted = [...uris].sort((a, b) => a.fsPath.localeCompare(b.fsPath));

	if (folders.length === 1) {
		return buildRooted(sorted, folders[0].uri.fsPath);
	}

	// Multiple workspace folders: one top-level DirNode per folder that has matches.
	const roots: TreeNode[] = [];
	for (const folder of folders) {
		const folderUris = sorted.filter(u => u.fsPath.startsWith(folder.uri.fsPath + path.sep) || u.fsPath === folder.uri.fsPath);
		if (folderUris.length === 0) continue;
		const children = buildRooted(folderUris, folder.uri.fsPath);
		roots.push({ kind: 'dir', fsPath: folder.uri.fsPath, label: folder.name, children });
	}
	return roots;
}

function buildRooted(uris: vscode.Uri[], wsRoot: string): TreeNode[] {
	const roots: TreeNode[] = [];
	const dirMap = new Map<string, DirNode>();

	function ensureDir(dirPath: string): DirNode {
		const existing = dirMap.get(dirPath);
		if (existing) return existing;
		const node: DirNode = { kind: 'dir', fsPath: dirPath, label: path.basename(dirPath), children: [] };
		dirMap.set(dirPath, node);
		const parent = path.dirname(dirPath);
		if (parent === dirPath || parent === wsRoot) {
			// Direct child of wsRoot — add to roots if not already there.
			if (!roots.includes(node)) roots.push(node);
		} else {
			const parentNode = ensureDir(parent);
			if (!parentNode.children.includes(node)) parentNode.children.push(node);
		}
		return node;
	}

	for (const uri of uris) {
		const fileNode: FileNode = { kind: 'file', uri, label: path.basename(uri.fsPath) };
		const dir = path.dirname(uri.fsPath);
		if (dir === wsRoot) {
			roots.push(fileNode);
		} else {
			const dirNode = ensureDir(dir);
			dirNode.children.push(fileNode);
		}
	}

	return roots;
}

export class KsyFilesProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(context: vscode.ExtensionContext) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*.ksy');
		watcher.onDidCreate(() => this._onDidChangeTreeData.fire(undefined));
		watcher.onDidDelete(() => this._onDidChangeTreeData.fire(undefined));
		context.subscriptions.push(watcher);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.resourceUri = node.uri;
			item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] };
			item.iconPath = new vscode.ThemeIcon('file-code');
			return item;
		}

		const state = node.children.length > 5
			? vscode.TreeItemCollapsibleState.Collapsed
			: vscode.TreeItemCollapsibleState.Expanded;
		const item = new vscode.TreeItem(node.label, state);
		item.resourceUri = vscode.Uri.file(node.fsPath);
		item.iconPath = vscode.ThemeIcon.Folder;
		return item;
	}

	async getChildren(node?: TreeNode): Promise<TreeNode[]> {
		if (!node) {
			const uris = await vscode.workspace.findFiles('**/*.ksy');
			return buildTree(uris);
		}
		if (node.kind === 'file') return [];
		return node.children;
	}
}

export class BinaryFilesProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private glob: string = '';

	setGlob(pattern: string): void {
		this.glob = pattern;
		this._onDidChangeTreeData.fire(undefined);
	}

	getGlob(): string {
		return this.glob;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.resourceUri = node.uri;
			item.command = {
				command: 'kaitai-struct.selectBinaryPath',
				title: 'Select Binary',
				arguments: [node.uri.fsPath],
			};
			item.iconPath = new vscode.ThemeIcon('file-binary');
			return item;
		}

		const state = node.children.length > 5
			? vscode.TreeItemCollapsibleState.Collapsed
			: vscode.TreeItemCollapsibleState.Expanded;
		const item = new vscode.TreeItem(node.label, state);
		item.resourceUri = vscode.Uri.file(node.fsPath);
		item.iconPath = vscode.ThemeIcon.Folder;
		return item;
	}

	async getChildren(node?: TreeNode): Promise<TreeNode[]> {
		if (!node) {
			if (!this.glob) return [];
			const uris = await vscode.workspace.findFiles(this.glob, '**/*.ksy');
			return buildTree(uris);
		}
		if (node.kind === 'file') return [];
		return node.children;
	}
}
