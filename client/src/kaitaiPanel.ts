import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type WebviewMsg =
	| { type: 'update'; ksyYaml: string; bufferHex: string }
	| { type: 'binaryOnly'; bufferHex: string };

export class KaitaiPanel {
	static readonly viewType = 'kaitaiViewer';
	private static instance: KaitaiPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly context: vscode.ExtensionContext;
	private binaryPath: string | undefined;
	private disposables: vscode.Disposable[] = [];

	/** Open the panel (or focus it if already open). */
	static createOrShow(context: vscode.ExtensionContext): KaitaiPanel {
		if (KaitaiPanel.instance) {
			KaitaiPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
			return KaitaiPanel.instance;
		}

		const panel = vscode.window.createWebviewPanel(
			KaitaiPanel.viewType,
			'Kaitai Viewer',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist'),
				],
				retainContextWhenHidden: true,
			}
		);

		KaitaiPanel.instance = new KaitaiPanel(panel, context);
		return KaitaiPanel.instance;
	}

	static getInstance(): KaitaiPanel | undefined {
		return KaitaiPanel.instance;
	}

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
		this.panel = panel;
		this.context = context;
		this.panel.webview.html = this.buildHtml();

		this.panel.onDidDispose(() => {
			KaitaiPanel.instance = undefined;
			this.dispose();
		}, null, this.disposables);

		// Re-send when the active .ksy editor changes content
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.languageId === 'kaitai-struct') {
					this.send(e.document.getText());
				}
			})
		);

		// Re-send when the user switches to a .ksy editor
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor?.document.languageId === 'kaitai-struct') {
					this.send(editor.document.getText());
				}
			})
		);

		// Initial send if a .ksy is already open
		const activeKsy = vscode.window.activeTextEditor?.document;
		if (activeKsy?.languageId === 'kaitai-struct') {
			this.send(activeKsy.getText());
		}
	}

	/** Ask the user to pick a binary file, then re-parse. */
	async pickBinaryFile(): Promise<void> {
		const uris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			title: 'Select binary file to parse',
		});
		if (!uris?.[0]) return;
		this.binaryPath = uris[0].fsPath;

		const activeKsy = vscode.window.activeTextEditor?.document;
		if (activeKsy?.languageId === 'kaitai-struct') {
			this.send(activeKsy.getText());
		} else {
			// Show bytes even without a KSY
			this.postBinaryOnly();
		}
	}

	private send(ksyYaml: string): void {
		if (!this.binaryPath) return;
		let bufferHex: string;
		try {
			const buf = fs.readFileSync(this.binaryPath);
			bufferHex = Buffer.from(buf).toString('hex').replace(/(.{2})/g, '$1 ').trim();
		} catch (e) {
			vscode.window.showErrorMessage(`Kaitai Viewer: cannot read binary file — ${e}`);
			return;
		}
		const msg: WebviewMsg = { type: 'update', ksyYaml, bufferHex };
		this.panel.webview.postMessage(msg);
	}

	private postBinaryOnly(): void {
		if (!this.binaryPath) return;
		try {
			const buf = fs.readFileSync(this.binaryPath);
			const bufferHex = Buffer.from(buf).toString('hex').replace(/(.{2})/g, '$1 ').trim();
			const msg: WebviewMsg = { type: 'binaryOnly', bufferHex };
			this.panel.webview.postMessage(msg);
		} catch { /* ignore */ }
	}

	private buildHtml(): string {
		const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist');
		const indexPath = path.join(distUri.fsPath, 'index.html');
		let html = fs.readFileSync(indexPath, 'utf-8');

		// Replace all relative asset paths with proper webview URIs
		html = html.replace(/(src|href)="(\.\/[^"]+)"/g, (_, attr, relPath) => {
			const absUri = vscode.Uri.joinPath(distUri, relPath.replace(/^\.\//, ''));
			return `${attr}="${this.panel.webview.asWebviewUri(absUri)}"`;
		});

		// Inject Content-Security-Policy (unsafe-eval needed for kaitai new Function)
		const csp = [
			`default-src 'none'`,
			`script-src 'unsafe-eval' ${this.panel.webview.cspSource}`,
			`style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
			`font-src ${this.panel.webview.cspSource}`,
			`img-src ${this.panel.webview.cspSource} data:`,
		].join('; ');
		html = html.replace(
			'<head>',
			`<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
		);

		return html;
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
		this.disposables = [];
	}
}
