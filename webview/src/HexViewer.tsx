import { useMemo, useCallback, useRef } from "react";
import { useHighlightStore } from "./lib/highlightStore.ts";
import type { ByteRange } from "./lib/highlightStore.ts";

const BYTES_PER_LINE = 16;

/** Parse a hex string (e.g. "ca fe 00 04") into byte values. */
function parseHexBytes(hex: string): number[] {
  const cleaned = hex.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

function addrHex(offset: number): string {
  return offset.toString(16).padStart(8, "0");
}

function byteHex(b: number): string {
  return b.toString(16).padStart(2, "0");
}

function isInRange(byteIdx: number, range: ByteRange | null): boolean {
  if (!range) return false;
  return byteIdx >= range.start && byteIdx < range.end;
}

export default function HexViewer({ hex }: { hex: string }) {
  const hoveredRange = useHighlightStore((s) => s.hoveredRange);
  const selectedRange = useHighlightStore((s) => s.selectedRange);
  const setSelectedRange = useHighlightStore((s) => s.setSelectedRange);

  const bytes = useMemo(() => parseHexBytes(hex), [hex]);

  const mouseDownByte = useRef<number | null>(null);

  const updateSelection = useCallback(
    (anchor: number, current: number) => {
      const start = Math.min(anchor, current);
      const end = Math.max(anchor, current) + 1;
      setSelectedRange({ start, end });
    },
    [setSelectedRange]
  );

  const handleCellMouseDown = useCallback(
    (byteIdx: number) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      mouseDownByte.current = byteIdx;
      setSelectedRange({ start: byteIdx, end: byteIdx + 1 });

      const handleMouseMove = (me: MouseEvent) => {
        const target = me.target as HTMLElement;
        const offset = target.dataset?.offset;
        if (offset != null && mouseDownByte.current != null) {
          updateSelection(mouseDownByte.current, parseInt(offset, 10));
        }
      };

      const handleMouseUp = () => {
        mouseDownByte.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [setSelectedRange, updateSelection]
  );

  const rows: number[][] = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
    rows.push(bytes.slice(i, i + BYTES_PER_LINE));
  }

  return (
    <div className="hex-viewer">
      <div className="hv-header">
        <span className="hv-addr">&nbsp;</span>
        <span className="hv-hex-header">
          {Array.from({ length: BYTES_PER_LINE }, (_, i) => (
            <span key={i} className={`hv-col-hdr${i === 8 ? " hv-col-gap" : ""}`}>
              {i.toString(16).toUpperCase()}
            </span>
          ))}
        </span>
      </div>
      <div className="hv-body">
        {rows.map((row, rowIdx) => {
          const rowOffset = rowIdx * BYTES_PER_LINE;
          return (
            <div className="hv-row" key={rowIdx}>
              <span className="hv-addr">{addrHex(rowOffset)}</span>
              <span className="hv-hex">
                {row.map((b, col) => {
                  const byteIdx = rowOffset + col;
                  const highlighted = isInRange(byteIdx, hoveredRange) || isInRange(byteIdx, selectedRange);
                  const cls =
                    "hv-cell" +
                    (col === 8 ? " hv-col-gap" : "") +
                    (highlighted ? " hv-highlighted" : "");
                  return (
                    <span
                      key={col}
                      className={cls}
                      data-offset={byteIdx}
                      onMouseDown={handleCellMouseDown(byteIdx)}
                    >
                      {byteHex(b)}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
