import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import { loadImportedObjects } from './kaitai-imports';
import { buildSymbolDocs, buildEnumDocs } from './kaitai-compiler';

let tmpDir: string;

beforeAll(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaitai-imports-test-'));
	fs.mkdirSync(path.join(tmpDir, 'common'));
	fs.mkdirSync(path.join(tmpDir, 'archive'));

	// common/point.ksy — a simple type with doc strings and an enum
	fs.writeFileSync(path.join(tmpDir, 'common', 'point.ksy'), [
		'meta:',
		'  id: point',
		'seq:',
		'  - id: x',
		'    type: s4',
		'    doc: X coordinate',
		'  - id: y',
		'    type: s4',
		'    doc: Y coordinate',
		'enums:',
		'  axis:',
		'    0: x_axis',
		'    1: y_axis',
	].join('\n'));

	// common/color.ksy — imports point.ksy (transitive)
	fs.writeFileSync(path.join(tmpDir, 'common', 'color.ksy'), [
		'meta:',
		'  id: color',
		'  imports:',
		'    - /common/point',
		'seq:',
		'  - id: r',
		'    type: u1',
		'    doc: Red channel',
	].join('\n'));

	// archive/shape.ksy — imports color (which imports point)
	fs.writeFileSync(path.join(tmpDir, 'archive', 'shape.ksy'), [
		'meta:',
		'  id: shape',
		'  imports:',
		'    - /common/color',
		'seq:',
		'  - id: kind',
		'    type: u1',
	].join('\n'));

	// self_cycle.ksy — imports itself
	fs.writeFileSync(path.join(tmpDir, 'self_cycle.ksy'), [
		'meta:',
		'  id: self_cycle',
		'  imports:',
		'    - self_cycle',
	].join('\n'));
});

afterAll(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function uri(relPath: string): string {
	return pathToFileURL(path.join(tmpDir, relPath)).href;
}

function loadKsy(relPath: string): any {
	return yaml.load(fs.readFileSync(path.join(tmpDir, relPath), 'utf-8'));
}

describe('loadImportedObjects', () => {
	it('loads a directly imported file', () => {
		const root = { meta: { id: 'test', imports: ['/common/point'] } };
		const imported = loadImportedObjects(root, uri('archive/test.ksy'));
		expect(imported).toHaveLength(1);
		expect(imported[0].meta.id).toBe('point');
	});

	it('loads transitively imported files', () => {
		// shape → color → point
		const root = loadKsy('archive/shape.ksy');
		const imported = loadImportedObjects(root, uri('archive/shape.ksy'));
		const ids = imported.map((o: any) => o.meta.id);
		expect(ids).toContain('color');
		expect(ids).toContain('point');
	});

	it('visits each file at most once even when imported from multiple paths', () => {
		// Both shape.ksy and another file import common/point — it should appear once
		const root = {
			meta: { id: 'test', imports: ['/common/color', '/common/point'] },
		};
		const imported = loadImportedObjects(root, uri('archive/test.ksy'));
		const ids = imported.map((o: any) => o.meta.id);
		// point appears as direct import and as transitive via color — must be exactly once
		expect(ids.filter((id: string) => id === 'point')).toHaveLength(1);
	});

	it('handles self-referencing imports without looping', () => {
		const root = loadKsy('self_cycle.ksy');
		// Should not throw or loop; the file is loaded once but not re-entered
		expect(() => loadImportedObjects(root, uri('self_cycle.ksy'))).not.toThrow();
		const imported = loadImportedObjects(root, uri('self_cycle.ksy'));
		// The self-import is resolved once, then the cycle is detected
		expect(imported.every((o: any) => o.meta?.id === 'self_cycle')).toBe(true);
	});

	it('returns empty array when there are no imports', () => {
		const root = { meta: { id: 'plain' } };
		expect(loadImportedObjects(root, uri('archive/test.ksy'))).toHaveLength(0);
	});

	it('skips unresolvable imports silently', () => {
		const root = { meta: { id: 'test', imports: ['/nonexistent/module'] } };
		expect(() => loadImportedObjects(root, uri('archive/test.ksy'))).not.toThrow();
		expect(loadImportedObjects(root, uri('archive/test.ksy'))).toHaveLength(0);
	});

	it('merging imported docs makes cross-file symbols available', () => {
		const root = {
			meta: { id: 'test', imports: ['/common/point'] },
			seq: [{ id: 'local_field', type: 'u1', doc: 'A local field' }],
		};

		const symbolDocs = buildSymbolDocs(root);
		const enumDocs = buildEnumDocs(root);
		for (const imported of loadImportedObjects(root, uri('archive/test.ksy'))) {
			for (const [k, v] of buildSymbolDocs(imported)) symbolDocs.set(k, v);
			for (const [k, v] of buildEnumDocs(imported)) enumDocs.set(k, v);
		}

		expect(symbolDocs.get('local_field')).toBe('A local field');
		expect(symbolDocs.get('x')).toBe('X coordinate');
		expect(symbolDocs.get('y')).toBe('Y coordinate');
		expect(enumDocs.has('axis')).toBe(true);
	});

	it('merging transitively imported docs surfaces all symbols', () => {
		// shape imports color imports point — all three layers' docs must be present
		const root = loadKsy('archive/shape.ksy');

		const symbolDocs = buildSymbolDocs(root);
		const enumDocs = buildEnumDocs(root);
		for (const imported of loadImportedObjects(root, uri('archive/shape.ksy'))) {
			for (const [k, v] of buildSymbolDocs(imported)) symbolDocs.set(k, v);
			for (const [k, v] of buildEnumDocs(imported)) enumDocs.set(k, v);
		}

		expect(symbolDocs.get('r')).toBe('Red channel');    // from color
		expect(symbolDocs.get('x')).toBe('X coordinate');   // from point (transitive)
		expect(enumDocs.has('axis')).toBe(true);             // enum from point (transitive)
	});
});
