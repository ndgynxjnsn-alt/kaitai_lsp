/** Parse a hex string (e.g. "ca fe 00 04") into byte values. */
export function parseHexBytes(hex: string): number[] {
  const cleaned = hex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.substring(i, i + 2), 16));
  }
  return bytes;
}

export function addrHex(offset: number): string {
  return offset.toString(16).padStart(8, '0');
}

export function byteHex(b: number): string {
  return b.toString(16).padStart(2, '0');
}

/**
 * Snap available container width to the nearest supported bytes-per-line.
 * Cell width: 24px, address column: 72px, padding: 24px, mid-gap: 8px.
 *   8 bpl ≈ 296px   16 bpl ≈ 488px   24 bpl ≈ 680px   32 bpl ≈ 872px
 */
export function bytesPerLineForWidth(width: number): 8 | 16 | 24 | 32 {
  if (width >= 872) return 32;
  if (width >= 680) return 24;
  if (width >= 488) return 16;
  return 8;
}

export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const cleaned = hex.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}
