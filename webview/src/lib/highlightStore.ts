import { create } from "zustand";

export interface ByteRange {
  start: number;
  end: number; // exclusive
}

export interface HighlightState {
  /** Byte range highlighted by hovering a tree node */
  hoveredRange: ByteRange | null;
  /** Tree node path highlighted by selecting text in hex view */
  selectedRange: ByteRange | null;

  setHoveredRange: (range: ByteRange | null) => void;
  setSelectedRange: (range: ByteRange | null) => void;
}

export const useHighlightStore = create<HighlightState>((set) => ({
  hoveredRange: null,
  selectedRange: null,
  setHoveredRange: (range) => set({ hoveredRange: range }),
  setSelectedRange: (range) => set({ selectedRange: range }),
}));
