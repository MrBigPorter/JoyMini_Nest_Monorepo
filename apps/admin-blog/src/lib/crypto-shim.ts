/**
 * Browser shim for node:crypto
 * Only the methods actually used by @lucky/shared are shimmed.
 * Uses the Web Crypto API available in all modern browsers.
 */

export function createHash(algorithm: string) {
  return {
    update(data: string | Uint8Array) {
      // TextEncoder.encode() / slice() both produce an ArrayBuffer-backed Uint8Array
      // at runtime; we cast explicitly to satisfy crypto.subtle.digest (requires BufferSource).
      const bytes: Uint8Array =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : data.slice();
      this._data = bytes;
      return this;
    },
    _data: new Uint8Array(),
    async digestAsync() {
      const hashBuffer = await globalThis.crypto.subtle.digest(
        algorithm.toUpperCase().replace('SHA', 'SHA-'),
        this._data,
      );
      return Buffer.from(hashBuffer);
    },
    digest(encoding?: string) {
      // Synchronous fallback: use a simple hash for browser context
      // Note: OrderNoHelper is server-only; this path should never be hit on client
      const arr = this._data;
      let hash = 0;
      for (let i = 0; i < arr.length; i++) {
        hash = (Math.imul(31, hash) + arr[i]) | 0;
      }
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, hash >>> 0, false);
      if (encoding === 'hex')
        return Array.from(buf)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      return buf;
    },
    readUInt32BE(offset: number) {
      const arr = this._data;
      return (
        (arr[offset] << 24) |
        (arr[offset + 1] << 16) |
        (arr[offset + 2] << 8) |
        arr[offset + 3]
      );
    },
  };
}

export { createHash as default };
