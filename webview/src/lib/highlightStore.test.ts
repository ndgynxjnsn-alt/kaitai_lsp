import { describe, it, expect, beforeEach } from 'vitest';
import { useHighlightStore } from './highlightStore';

beforeEach(() => {
  useHighlightStore.setState({ hoveredRange: null, selectedRange: null });
});

describe('highlightStore', () => {
  it('initializes with null ranges', () => {
    const { hoveredRange, selectedRange } = useHighlightStore.getState();
    expect(hoveredRange).toBeNull();
    expect(selectedRange).toBeNull();
  });

  it('sets hovered range', () => {
    useHighlightStore.getState().setHoveredRange({ start: 4, end: 8 });
    expect(useHighlightStore.getState().hoveredRange).toEqual({ start: 4, end: 8 });
  });

  it('sets selected range', () => {
    useHighlightStore.getState().setSelectedRange({ start: 10, end: 20 });
    expect(useHighlightStore.getState().selectedRange).toEqual({ start: 10, end: 20 });
  });

  it('clears hovered range', () => {
    useHighlightStore.getState().setHoveredRange({ start: 4, end: 8 });
    useHighlightStore.getState().setHoveredRange(null);
    expect(useHighlightStore.getState().hoveredRange).toBeNull();
  });

  it('clears selected range', () => {
    useHighlightStore.getState().setSelectedRange({ start: 4, end: 8 });
    useHighlightStore.getState().setSelectedRange(null);
    expect(useHighlightStore.getState().selectedRange).toBeNull();
  });

  it('updates each range independently', () => {
    useHighlightStore.getState().setHoveredRange({ start: 0, end: 4 });
    useHighlightStore.getState().setSelectedRange({ start: 10, end: 20 });
    const { hoveredRange, selectedRange } = useHighlightStore.getState();
    expect(hoveredRange).toEqual({ start: 0, end: 4 });
    expect(selectedRange).toEqual({ start: 10, end: 20 });
  });

  it('notifies subscribers on hovered change', () => {
    const received: unknown[] = [];
    const unsub = useHighlightStore.subscribe((s) => received.push(s.hoveredRange));
    useHighlightStore.getState().setHoveredRange({ start: 0, end: 4 });
    useHighlightStore.getState().setHoveredRange(null);
    unsub();
    expect(received).toEqual([{ start: 0, end: 4 }, null]);
  });

  it('does not notify unsubscribed listeners', () => {
    const received: unknown[] = [];
    const unsub = useHighlightStore.subscribe((s) => received.push(s.selectedRange));
    unsub();
    useHighlightStore.getState().setSelectedRange({ start: 1, end: 5 });
    expect(received).toHaveLength(0);
  });
});
