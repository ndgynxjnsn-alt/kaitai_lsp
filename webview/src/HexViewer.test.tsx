import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import HexViewer from './HexViewer';
import { useHighlightStore } from './lib/highlightStore';

// jsdom does not implement ResizeObserver
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  useHighlightStore.setState({ hoveredRange: null, selectedRange: null });
});

const HEX_16 = Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, '0')).join(' ');
const HEX_20 = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(2, '0')).join(' ');

describe('HexViewer', () => {
  it('renders one cell per byte', () => {
    const { container } = render(<HexViewer hex={HEX_20} />);
    expect(container.querySelectorAll('.hv-cell')).toHaveLength(20);
  });

  it('renders nothing for empty hex', () => {
    const { container } = render(<HexViewer hex="" />);
    expect(container.querySelectorAll('.hv-cell')).toHaveLength(0);
    expect(container.querySelectorAll('.hv-row')).toHaveLength(0);
  });

  it('renders correct byte values', () => {
    const { container } = render(<HexViewer hex="ca fe ba be" />);
    const cells = container.querySelectorAll('.hv-cell');
    expect(cells[0].textContent).toBe('ca');
    expect(cells[1].textContent).toBe('fe');
    expect(cells[2].textContent).toBe('ba');
    expect(cells[3].textContent).toBe('be');
  });

  it('renders the correct address for the first row', () => {
    const { container } = render(<HexViewer hex={HEX_16} />);
    const bodyAddrs = container.querySelectorAll('.hv-body .hv-addr');
    expect(bodyAddrs[0].textContent).toBe('00000000');
  });

  it('renders correct address for subsequent rows (default 16 bpl)', () => {
    // 32 bytes = 2 rows at 16 bpl
    const hex = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(' ');
    const { container } = render(<HexViewer hex={hex} />);
    const bodyAddrs = container.querySelectorAll('.hv-body .hv-addr');
    expect(bodyAddrs[0].textContent).toBe('00000000');
    expect(bodyAddrs[1].textContent).toBe('00000010');
  });

  it('stores data-offset attributes on cells', () => {
    const { container } = render(<HexViewer hex="aa bb cc" />);
    const cells = container.querySelectorAll('.hv-cell');
    expect(cells[0].getAttribute('data-offset')).toBe('0');
    expect(cells[1].getAttribute('data-offset')).toBe('1');
    expect(cells[2].getAttribute('data-offset')).toBe('2');
  });

  it('highlights cells in the selected range', () => {
    useHighlightStore.setState({ selectedRange: { start: 1, end: 3 }, hoveredRange: null });
    const { container } = render(<HexViewer hex="aa bb cc dd" />);
    const cells = container.querySelectorAll('.hv-cell');
    expect(cells[0].classList.contains('hv-highlighted')).toBe(false);
    expect(cells[1].classList.contains('hv-highlighted')).toBe(true);
    expect(cells[2].classList.contains('hv-highlighted')).toBe(true);
    expect(cells[3].classList.contains('hv-highlighted')).toBe(false);
  });

  it('highlights cells in the hovered range', () => {
    useHighlightStore.setState({ hoveredRange: { start: 0, end: 2 }, selectedRange: null });
    const { container } = render(<HexViewer hex="aa bb cc" />);
    const cells = container.querySelectorAll('.hv-cell');
    expect(cells[0].classList.contains('hv-highlighted')).toBe(true);
    expect(cells[1].classList.contains('hv-highlighted')).toBe(true);
    expect(cells[2].classList.contains('hv-highlighted')).toBe(false);
  });

  it('clicking a cell sets selectedRange in the store', () => {
    const { container } = render(<HexViewer hex="aa bb cc dd" />);
    const cells = container.querySelectorAll('.hv-cell');
    fireEvent.mouseDown(cells[2], { button: 0 });
    fireEvent.mouseUp(document);
    expect(useHighlightStore.getState().selectedRange).toEqual({ start: 2, end: 3 });
  });

  it('renders 16 column header labels by default', () => {
    const { container } = render(<HexViewer hex={HEX_16} />);
    expect(container.querySelectorAll('.hv-col-hdr')).toHaveLength(16);
  });
});
