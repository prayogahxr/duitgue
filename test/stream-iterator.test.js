/**
 * Test tambalan `ReadableStream[Symbol.asyncIterator]` untuk Safari.
 *
 * Node punya implementasi aslinya, jadi yang diuji di sini kelas tiruan yang
 * SENGAJA tidak punya iterator asinkron — persis keadaan Safari. Tanpa itu,
 * testnya cuma menguji Node, bukan tambalannya.
 */
import { describe, it, expect } from 'vitest';
import { pasangIteratorStream } from '../src/extract/stream-iterator.js';

/** Stream ala Safari: punya getReader(), tidak punya Symbol.asyncIterator. */
function bikinKelas(potongan, { gagalDi = -1 } = {}) {
  return class StreamPalsu {
    constructor() {
      this.i = 0;
      this.dibatalkan = false;
      this.kunciDilepas = 0;
    }
    getReader() {
      const stream = this;
      return {
        async read() {
          if (stream.i === gagalDi) throw new Error('bacaan gagal');
          if (stream.i >= potongan.length) return { done: true, value: undefined };
          return { done: false, value: potongan[stream.i++] };
        },
        releaseLock() {
          stream.kunciDilepas++;
        },
        async cancel() {
          stream.dibatalkan = true;
        },
      };
    }
  };
}

describe('pasangIteratorStream', () => {
  it('membuat for await bisa jalan di kelas yang tidak punya iterator', async () => {
    const Kelas = bikinKelas(['a', 'b', 'c']);
    expect(Kelas.prototype[Symbol.asyncIterator]).toBe(undefined);
    expect(pasangIteratorStream(Kelas)).toBe(true);

    const keluar = [];
    for await (const v of new Kelas()) keluar.push(v);
    expect(keluar).toEqual(['a', 'b', 'c']);
  });

  it('tidak menimpa implementasi yang sudah ada', () => {
    const Kelas = bikinKelas(['a']);
    const asli = function () {};
    Kelas.prototype[Symbol.asyncIterator] = asli;
    expect(pasangIteratorStream(Kelas)).toBe(false);
    expect(Kelas.prototype[Symbol.asyncIterator]).toBe(asli);
  });

  it('membatalkan stream saat perulangan diputus di tengah', async () => {
    const Kelas = bikinKelas(['a', 'b', 'c']);
    pasangIteratorStream(Kelas);
    const s = new Kelas();
    for await (const v of s) {
      if (v === 'b') break;
    }
    expect(s.dibatalkan).toBe(true);
    expect(s.kunciDilepas).toBe(1);
  });

  it('melepas kunci pembaca walau bacaannya gagal', async () => {
    const Kelas = bikinKelas(['a', 'b'], { gagalDi: 1 });
    pasangIteratorStream(Kelas);
    const s = new Kelas();
    await expect(
      (async () => {
        for await (const v of s) void v;
      })(),
    ).rejects.toThrow('bacaan gagal');
    expect(s.kunciDilepas).toBeGreaterThan(0);
  });

  it('melepas kunci setelah stream habis', async () => {
    const Kelas = bikinKelas(['a']);
    pasangIteratorStream(Kelas);
    const s = new Kelas();
    for await (const v of s) void v;
    expect(s.kunciDilepas).toBe(1);
  });

  it('aman dipanggil saat ReadableStream tidak ada sama sekali', () => {
    expect(pasangIteratorStream(undefined)).toBe(false);
  });
});
