import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'js-yaml';

/**
 * Resolve a KSY import name to an absolute filesystem path.
 *
 * KSC uses two styles:
 *  - `/common/dos_datetime` – "absolute from library root": KSC strips the
 *    leading slash before calling the importer, so we normalise either form
 *    identically. We then search upward from `fromDir` until a matching
 *    `<name>.ksy` file is found.
 *  - `./relative` or `../sibling` – explicitly relative: resolved directly
 *    from `fromDir` without any upward search.
 */
export function resolveImportPath(name: string, fromDir: string): string | null {
	const normalized = name.startsWith('/') ? name.slice(1) : name;
	const filePath = normalized + '.ksy';

	if (name.startsWith('./') || name.startsWith('../')) {
		const candidate = path.join(fromDir, filePath);
		return fs.existsSync(candidate) ? candidate : null;
	}

	// Non-relative: try fromDir first, then walk upward.
	let dir = fromDir;
	for (;;) {
		const candidate = path.join(dir, filePath);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break; // reached filesystem root
		dir = parent;
	}
	return null;
}

/**
 * Recursively load all KSY objects reachable via `meta.imports` from the given
 * root object.  Handles cycles and missing files gracefully.
 * Returns every imported object (not including `rootObject` itself).
 */
export function loadImportedObjects(rootObject: any, documentUri: string): any[] {
	const results: any[] = [];
	const visited = new Set<string>();

	function walk(obj: any, uri: string): void {
		const imports = obj?.meta?.imports;
		if (!Array.isArray(imports)) return;

		let fromDir: string;
		try {
			fromDir = path.dirname(fileURLToPath(uri));
		} catch {
			return;
		}

		for (const importName of imports) {
			if (typeof importName !== 'string') continue;
			const filePath = resolveImportPath(importName, fromDir);
			if (!filePath || visited.has(filePath)) continue;
			visited.add(filePath);

			try {
				const content = fs.readFileSync(filePath, 'utf-8');
				const imported = yaml.load(content);
				if (imported && typeof imported === 'object') {
					results.push(imported);
					walk(imported, pathToFileURL(filePath).href);
				}
			} catch {
				// Skip unreadable or unparseable files silently
			}
		}
	}

	walk(rootObject, documentUri);
	return results;
}

/**
 * Resolve an import name to a LSP Location URI (pointing to line 0:0 of the
 * target file).  Returns null when the import cannot be found or the document
 * URI is not a file:// URI.
 */
export function resolveImportToUri(name: string, documentUri: string): string | null {
	let fromDir: string;
	try {
		fromDir = path.dirname(fileURLToPath(documentUri));
	} catch {
		return null;
	}
	const filePath = resolveImportPath(name, fromDir);
	if (!filePath) return null;
	return pathToFileURL(filePath).href;
}
