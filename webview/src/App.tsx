import { useState, useEffect } from 'react';
import HexViewer from './HexViewer.tsx';
import TreeView from './TreeView.tsx';
import { compileAndParse } from './lib/kaitai.ts';
import type { ParseResult } from './lib/kaitai.ts';
import './viewer.css';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

type VsCodeMsg =
  | { type: 'update'; ksyYaml: string; bufferHex: string }
  | { type: 'binaryOnly'; bufferHex: string };

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const cleaned = hex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

export default function App() {
  const [hexData, setHexData] = useState<string>('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const msg = event.data as VsCodeMsg;
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
      } else if (msg.type === 'binaryOnly') {
        setHexData(msg.bufferHex);
        setResult(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const hasData = hexData.trim().length > 0;

  return (
    <div className="viewer">
      <div className="viewer-layout">
        <section className="viewer-hex">
          <div className="pane-title">Hex</div>
          {hasData
            ? <HexViewer hex={hexData} />
            : <div className="viewer-empty">No binary file selected.<br />Use <strong>Kaitai: Select Binary File</strong> to pick one.</div>
          }
        </section>
        <section className="viewer-tree">
          <div className="pane-title">Parsed Structure</div>
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
        </section>
      </div>
    </div>
  );
}
