import * as crypto from 'crypto';
import * as vscode from 'vscode';

export class ConverterViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'kaitai.converter';
	private view?: vscode.WebviewView;
	private pendingBytes: number[] = [];

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		const nonce = crypto.randomBytes(16).toString('hex');
		view.webview.html = this.buildHtml(nonce);
		if (this.pendingBytes.length > 0) {
			view.webview.postMessage({ type: 'update', bytes: this.pendingBytes });
		}
	}

	updateBytes(bytes: number[]): void {
		this.pendingBytes = bytes;
		if (this.view) {
			this.view.webview.postMessage({ type: 'update', bytes });
		}
	}

	private buildHtml(nonce: string): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Converter</title>
<style nonce="${nonce}">
* {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}
body {
	background: var(--vscode-editor-background);
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--vscode-editor-font-size, 12px);
}
table {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
}
th, td {
	padding: 2px 6px;
	text-align: left;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
th {
	color: var(--vscode-descriptionForeground);
	border-bottom: 1px solid var(--vscode-panel-border);
	font-weight: normal;
	font-size: 0.9em;
}
tr:not(:first-child) td {
	border-top: 1px solid var(--vscode-panel-border, transparent);
}
td:first-child {
	color: var(--vscode-descriptionForeground);
	width: 72px;
}
td.num {
	color: var(--vscode-symbolIcon-numberForeground);
}
td.str {
	color: var(--vscode-symbolIcon-stringForeground);
}
span.str-val {
	display: block;
	text-overflow: ellipsis;
	overflow: hidden;
	max-width: 140px;
	white-space: nowrap;
}
</style>
</head>
<body>
<table>
<thead>
<tr><th>Type</th><th>Unsigned</th><th>Signed</th></tr>
</thead>
<tbody>
<tr><td>i8</td><td id="v-u8" class="num">-</td><td id="v-s8" class="num">-</td></tr>
<tr><td>i16le</td><td id="v-u16le" class="num">-</td><td id="v-s16le" class="num">-</td></tr>
<tr><td>i16be</td><td id="v-u16be" class="num">-</td><td id="v-s16be" class="num">-</td></tr>
<tr><td>i32le</td><td id="v-u32le" class="num">-</td><td id="v-s32le" class="num">-</td></tr>
<tr><td>i32be</td><td id="v-u32be" class="num">-</td><td id="v-s32be" class="num">-</td></tr>
<tr><td>i64le</td><td id="v-u64le" class="num">-</td><td id="v-s64le" class="num">-</td></tr>
<tr><td>i64be</td><td id="v-u64be" class="num">-</td><td id="v-s64be" class="num">-</td></tr>
<tr><td>f32le</td><td id="v-f32le" class="num" colspan="2">-</td></tr>
<tr><td>f32be</td><td id="v-f32be" class="num" colspan="2">-</td></tr>
<tr><td>f64le</td><td id="v-f64le" class="num" colspan="2">-</td></tr>
<tr><td>f64be</td><td id="v-f64be" class="num" colspan="2">-</td></tr>
<tr><td>unixts</td><td id="v-unixts" class="num" colspan="2">-</td></tr>
<tr><td>ascii</td><td id="v-ascii" class="str" colspan="2"><span class="str-val">-</span></td></tr>
<tr><td>utf-8</td><td id="v-utf8" class="str" colspan="2"><span class="str-val">-</span></td></tr>
<tr><td>utf-16le</td><td id="v-utf16le" class="str" colspan="2"><span class="str-val">-</span></td></tr>
<tr><td>utf-16be</td><td id="v-utf16be" class="str" colspan="2"><span class="str-val">-</span></td></tr>
</tbody>
</table>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

window.addEventListener('message', function(e) {
	if (e.data.type === 'update') {
		render(new Uint8Array(e.data.bytes));
	}
});

function set(id, value) {
	const el = document.getElementById(id);
	if (!el) return;
	const span = el.querySelector('span.str-val');
	if (span) {
		span.textContent = value;
		span.title = value;
	} else {
		el.textContent = value;
		el.title = value;
	}
}

function truncate(s, max) {
	if (s.length > max) return s.slice(0, max) + '\\u2026';
	return s;
}

function render(data) {
	const len = data.length;
	const dv = len > 0 ? new DataView(data.buffer, data.byteOffset, data.byteLength) : null;

	// i8
	set('v-u8',   len >= 1 ? dv.getUint8(0).toString() : '-');
	set('v-s8',   len >= 1 ? dv.getInt8(0).toString() : '-');

	// i16
	set('v-u16le', len >= 2 ? dv.getUint16(0, true).toString() : '-');
	set('v-s16le', len >= 2 ? dv.getInt16(0, true).toString() : '-');
	set('v-u16be', len >= 2 ? dv.getUint16(0, false).toString() : '-');
	set('v-s16be', len >= 2 ? dv.getInt16(0, false).toString() : '-');

	// i32
	set('v-u32le', len >= 4 ? dv.getUint32(0, true).toString() : '-');
	set('v-s32le', len >= 4 ? dv.getInt32(0, true).toString() : '-');
	set('v-u32be', len >= 4 ? dv.getUint32(0, false).toString() : '-');
	set('v-s32be', len >= 4 ? dv.getInt32(0, false).toString() : '-');

	// i64
	if (len >= 8) {
		try {
			set('v-u64le', dv.getBigUint64(0, true).toString());
			set('v-s64le', dv.getBigInt64(0, true).toString());
			set('v-u64be', dv.getBigUint64(0, false).toString());
			set('v-s64be', dv.getBigInt64(0, false).toString());
		} catch(_) {
			set('v-u64le', '-'); set('v-s64le', '-');
			set('v-u64be', '-'); set('v-s64be', '-');
		}
	} else {
		set('v-u64le', '-'); set('v-s64le', '-');
		set('v-u64be', '-'); set('v-s64be', '-');
	}

	// f32
	set('v-f32le', len >= 4 ? dv.getFloat32(0, true).toString() : '-');
	set('v-f32be', len >= 4 ? dv.getFloat32(0, false).toString() : '-');

	// f64
	set('v-f64le', len >= 8 ? dv.getFloat64(0, true).toString() : '-');
	set('v-f64be', len >= 8 ? dv.getFloat64(0, false).toString() : '-');

	// unix timestamp (u32le)
	if (len >= 4) {
		const secs = dv.getUint32(0, true);
		const iso = new Date(secs * 1000).toISOString().replace('T', ' ').slice(0, 19);
		set('v-unixts', iso);
	} else {
		set('v-unixts', '-');
	}

	// strings
	const encodings = [
		['v-ascii',   'ascii'],
		['v-utf8',    'utf-8'],
		['v-utf16le', 'utf-16le'],
		['v-utf16be', 'utf-16be'],
	];
	for (const [id, enc] of encodings) {
		if (len === 0) { set(id, '-'); continue; }
		try {
			const decoded = new TextDecoder(enc, { fatal: true }).decode(data);
			set(id, truncate(decoded, 40));
		} catch(_) {
			set(id, '(invalid)');
		}
	}
}
</script>
</body>
</html>`;
	}
}
