import { describe, it, expect } from 'vitest';
import {
  parseHexBytes,
  addrHex,
  byteHex,
  bytesPerLineForWidth,
  hexToArrayBuffer,
} from './hexUtils';

describe('parseHexBytes', () => {
  it('parses space-separated hex', () => {
    expect(parseHexBytes('ca fe 00 04')).toEqual([0xca, 0xfe, 0x00, 0x04]);
  });
  it('parses no-separator hex', () => {
    expect(parseHexBytes('cafe0004')).toEqual([0xca, 0xfe, 0x00, 0x04]);
  });
  it('strips 0x prefixes', () => {
    expect(parseHexBytes('0xca 0xfe')).toEqual([0xca, 0xfe]);
  });
  it('is case-insensitive', () => {
    expect(parseHexBytes('CA FE')).toEqual([0xca, 0xfe]);
  });
  it('returns empty array for empty string', () => {
    expect(parseHexBytes('')).toEqual([]);
  });
  it('ignores trailing odd nibble', () => {
    // 3 hex chars → only 1 full byte
    expect(parseHexBytes('abe')).toEqual([0xab]);
  });
});

describe('addrHex', () => {
  it('pads zero to 8 digits', () => {
    expect(addrHex(0)).toBe('00000000');
  });
  it('pads a small number', () => {
    expect(addrHex(255)).toBe('000000ff');
  });
  it('formats a 32-bit address', () => {
    expect(addrHex(0xdeadbeef)).toBe('deadbeef');
  });
});

describe('byteHex', () => {
  it('pads single-digit hex', () => {
    expect(byteHex(0)).toBe('00');
    expect(byteHex(15)).toBe('0f');
  });
  it('formats full byte', () => {
    expect(byteHex(255)).toBe('ff');
    expect(byteHex(0xab)).toBe('ab');
  });
});

describe('bytesPerLineForWidth', () => {
  it('returns 8 below 488px', () => {
    expect(bytesPerLineForWidth(0)).toBe(8);
    expect(bytesPerLineForWidth(300)).toBe(8);
    expect(bytesPerLineForWidth(487)).toBe(8);
  });
  it('returns 16 at 488px', () => {
    expect(bytesPerLineForWidth(488)).toBe(16);
    expect(bytesPerLineForWidth(500)).toBe(16);
    expect(bytesPerLineForWidth(679)).toBe(16);
  });
  it('returns 24 at 680px', () => {
    expect(bytesPerLineForWidth(680)).toBe(24);
    expect(bytesPerLineForWidth(700)).toBe(24);
    expect(bytesPerLineForWidth(871)).toBe(24);
  });
  it('returns 32 at 872px', () => {
    expect(bytesPerLineForWidth(872)).toBe(32);
    expect(bytesPerLineForWidth(900)).toBe(32);
    expect(bytesPerLineForWidth(9999)).toBe(32);
  });
});

describe('hexToArrayBuffer', () => {
  it('converts hex string to ArrayBuffer', () => {
    const buf = hexToArrayBuffer('ca fe 00 04');
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([0xca, 0xfe, 0x00, 0x04]));
  });
  it('handles empty input', () => {
    expect(hexToArrayBuffer('').byteLength).toBe(0);
  });
  it('round-trips through parseHexBytes', () => {
    const original = [0x12, 0x34, 0xab, 0xcd];
    const hex = original.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const buf = hexToArrayBuffer(hex);
    expect(Array.from(new Uint8Array(buf))).toEqual(original);
  });
});
