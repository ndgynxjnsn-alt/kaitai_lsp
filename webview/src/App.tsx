import { useState, useEffect, useRef } from 'react';
import HexViewer from './HexViewer.tsx';
import TreeView from './TreeView.tsx';
import { compileAndParse } from './lib/kaitai.ts';
import { useHighlightStore } from './lib/highlightStore.ts';
import { hexToArrayBuffer } from './lib/hexUtils.ts';
import type { ParseResult } from './lib/kaitai.ts';
import './viewer.css';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();
const panelType: 'hex' | 'tree' =
  (document.querySelector<HTMLMetaElement>('meta[name="kaitai-panel"]')?.content as 'hex' | 'tree') ?? 'hex';

type VsCodeMsg =
  | { type: 'update'; ksyYaml: string; bufferHex: string }
  | { type: 'binaryOnly'; bufferHex: string }
  | { type: 'setHover'; range: { start: number; end: number } | null }
  | { type: 'setSelect'; range: { start: number; end: number } | null };

export default function App() {
  const [hexData, setHexData] = useState<string>('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);

  // Prevents re-posting highlight events that arrived from the other panel
  const externalUpdate = useRef(false);

  // Signal to the extension host that this webview is ready to receive messages
  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, []);

  // Escape clears the selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useHighlightStore.getState().setSelectedRange(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Relay local highlight store changes to the extension host → other panel
  useEffect(() => {
    return useHighlightStore.subscribe((state, prev) => {
      if (externalUpdate.current) return;
      if (state.hoveredRange !== prev.hoveredRange) {
        vscode.postMessage({ type: 'setHover', range: state.hoveredRange });
      }
      if (state.selectedRange !== prev.selectedRange) {
        vscode.postMessage({ type: 'setSelect', range: state.selectedRange });
      }
    });
  }, []);

  // Handle messages from the extension host
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const msg = event.data as VsCodeMsg;

      if (msg.type === 'setHover') {
        externalUpdate.current = true;
        useHighlightStore.getState().setHoveredRange(msg.range);
        externalUpdate.current = false;
        return;
      }
      if (msg.type === 'setSelect') {
        externalUpdate.current = true;
        useHighlightStore.getState().setSelectedRange(msg.range);
        externalUpdate.current = false;
        return;
      }
      if (msg.type === 'update') {
        const { ksyYaml, bufferHex } = msg;
        setHexData(bufferHex);
        setResult(null);
        setParsing(true);
        try {
          const buffer = hexToArrayBuffer(bufferHex);
          const res = await compileAndParse(ksyYaml, buffer);
          setResult(res);
        } catch (e) {
          setResult({ success: false, error: String(e) });
        } finally {
          setParsing(false);
        }
        return;
      }
      if (msg.type === 'binaryOnly') {
        setHexData(msg.bufferHex);
        setResult(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const hasData = hexData.trim().length > 0;

  if (panelType === 'hex') {
    return (
      <div className="panel-full">
        {hasData
          ? <HexViewer hex={hexData} />
          : <div className="viewer-empty">No binary file selected.<br />Use <strong>Kaitai: Select Binary File</strong> to pick one.</div>
        }
      </div>
    );
  }

  // tree panel
  return (
    <div className="panel-full">
      {parsing && <div className="viewer-status">Parsing…</div>}
      {!parsing && result?.success && result.tree && <TreeView root={result.tree} />}
      {!parsing && result && !result.success && (
        <div className="viewer-error">{result.error}</div>
      )}
      {!parsing && !result && (
        <div className="viewer-empty">
          {hasData ? 'No .ksy file open.' : 'Open a .ksy file in the editor.'}
        </div>
      )}
    </div>
  );
}
