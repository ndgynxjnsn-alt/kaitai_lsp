const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function build() {
	// Bundle the server
	await esbuild.build({
		entryPoints: ['server/src/server.ts'],
		bundle: true,
		platform: 'node',
		target: 'node16',
		outfile: 'server/out/server.js',
		format: 'cjs',
		sourcemap: false,
		external: [],
		tsconfig: 'server/tsconfig.json',
	});

	// Bundle the client (vscode is provided by the host)
	await esbuild.build({
		entryPoints: ['client/src/extension.ts'],
		bundle: true,
		platform: 'node',
		target: 'node16',
		outfile: 'client/out/extension.js',
		format: 'cjs',
		sourcemap: false,
		external: ['vscode'],
		tsconfig: 'client/tsconfig.json',
	});

	// Copy tree-sitter.wasm next to the server bundle so web-tree-sitter can find it
	const treeSitterWasm = path.join(
		'server', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'
	);
	const dest = path.join('server', 'out', 'tree-sitter.wasm');
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(treeSitterWasm, dest);

	console.log('Build complete');
}

build().catch(err => {
	console.error(err);
	process.exit(1);
});
