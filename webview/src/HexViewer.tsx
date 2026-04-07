import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import { useHighlightStore } from "./lib/highlightStore.ts";
import type { ByteRange } from "./lib/highlightStore.ts";
import { parseHexBytes, addrHex, byteHex, bytesPerLineForWidth } from "./lib/hexUtils.ts";

function isInRange(byteIdx: number, range: ByteRange | null): boolean {
  if (!range) return false;
  return byteIdx >= range.start && byteIdx < range.end;
}

export default function HexViewer({ hex }: { hex: string }) {
  const hoveredRange = useHighlightStore((s) => s.hoveredRange);
  const selectedRange = useHighlightStore((s) => s.selectedRange);
  const setSelectedRange = useHighlightStore((s) => s.setSelectedRange);

  const bytes = useMemo(() => parseHexBytes(hex), [hex]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [bytesPerLine, setBytesPerLine] = useState<8 | 16 | 24 | 32>(16);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBytesPerLine(bytesPerLineForWidth(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const midpoint = bytesPerLine / 2;

  const rows = useMemo(() => {
    const result: number[][] = [];
    for (let i = 0; i < bytes.length; i += bytesPerLine) {
      result.push(bytes.slice(i, i + bytesPerLine));
    }
    return result;
  }, [bytes, bytesPerLine]);

  return (
    <div className="hex-viewer" ref={containerRef}>
      <div className="hv-header">
        <span className="hv-addr">&nbsp;</span>
        <span className="hv-hex-header">
          {Array.from({ length: bytesPerLine }, (_, i) => (
            <span key={i} className={`hv-col-hdr${i === midpoint ? " hv-col-gap" : ""}`}>
              {i.toString(16).toUpperCase()}
            </span>
          ))}
        </span>
      </div>
      <div className="hv-body">
        {rows.map((row, rowIdx) => {
          const rowOffset = rowIdx * bytesPerLine;
          return (
            <div className="hv-row" key={rowIdx}>
              <span className="hv-addr">{addrHex(rowOffset)}</span>
              <span className="hv-hex">
                {row.map((b, col) => {
                  const byteIdx = rowOffset + col;
                  const highlighted = isInRange(byteIdx, hoveredRange) || isInRange(byteIdx, selectedRange);
                  const cls =
                    "hv-cell" +
                    (col === midpoint ? " hv-col-gap" : "") +
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
