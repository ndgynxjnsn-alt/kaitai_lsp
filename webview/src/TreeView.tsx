import { useState, useCallback } from "react";
import type { TreeNode } from "./lib/kaitai.ts";
import { useHighlightStore } from "./lib/highlightStore.ts";

function rangesOverlap(
  a: { start: number; end: number } | undefined,
  b: { start: number; end: number } | null
): boolean {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function TreeNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = !!node.children?.length;
  const setHoveredRange = useHighlightStore((s) => s.setHoveredRange);
  const setSelectedRange = useHighlightStore((s) => s.setSelectedRange);
  const selectedRange = useHighlightStore((s) => s.selectedRange);

  const isHighlighted = rangesOverlap(node.range, selectedRange);

  const handleClick = useCallback(() => {
    if (hasChildren) setOpen((o) => !o);
    if (node.range) setSelectedRange(node.range);
  }, [hasChildren, node.range, setSelectedRange]);

  const handleMouseEnter = useCallback(() => {
    if (node.range) setHoveredRange(node.range);
  }, [node.range, setHoveredRange]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRange(null);
  }, [setHoveredRange]);

  return (
    <li className="tree-node">
      <div
        className={`tree-row ${hasChildren ? "expandable" : ""} ${isHighlighted ? "tree-row-highlighted" : ""}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {hasChildren && (
          <i className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-right'} tree-toggle`} />
        )}
        {!hasChildren && <span className="tree-toggle-spacer" />}
        <NodeLabel node={node} />
      </div>
      {hasChildren && open && (
        <ul className="tree-children">
          {node.children!.map((child, i) => (
            <TreeNodeRow key={child.name + i} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeLabel({ node }: { node: TreeNode }) {
  switch (node.type) {
    case "object":
      return (
        <span>
          <span className="node-name">{node.name}</span>
          {node.className && (
            <>
              {" ["}
              <span className="node-class">{node.className}</span>
              {"]"}
            </>
          )}
        </span>
      );

    case "array":
      return (
        <span>
          <span className="node-name">{node.name}</span>
          <span className="node-meta"> ({node.arrayLength})</span>
        </span>
      );

    case "bytes":
      return (
        <span>
          <span className="node-name">{node.name}</span>
          {" = "}
          <span className="node-bytes">[{node.bytesPreview}]</span>
          <span className="node-meta"> ({node.bytesLength} bytes)</span>
        </span>
      );

    case "primitive": {
      if (node.value === null || node.value === undefined) {
        return (
          <span>
            <span className="node-name">{node.name}</span>
            {" = "}
            <span className="node-null">null</span>
          </span>
        );
      }
      if (typeof node.value === "string") {
        return (
          <span>
            <span className="node-name">{node.name}</span>
            {" = "}
            <span className="node-string">"{node.value}"</span>
          </span>
        );
      }
      if (typeof node.value === "boolean") {
        return (
          <span>
            <span className="node-name">{node.name}</span>
            {" = "}
            <span className="node-bool">{String(node.value)}</span>
          </span>
        );
      }
      // number
      return (
        <span>
          <span className="node-name">{node.name}</span>
          {" = "}
          <span className="node-value">{node.hexValue ?? node.value}</span>
          {node.hexValue && (
            <span className="node-int"> = {node.value}</span>
          )}
        </span>
      );
    }
  }
}

export default function TreeView({ root }: { root: TreeNode }) {
  return (
    <div className="tree-view">
      <ul className="tree-children">
        <TreeNodeRow node={root} depth={0} />
      </ul>
    </div>
  );
}
