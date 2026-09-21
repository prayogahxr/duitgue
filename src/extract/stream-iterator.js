/**
 * Tambal `ReadableStream[Symbol.asyncIterator]` untuk Safari.
 *
 * Chrome dan Firefox mengizinkan `for await (const x of stream)`. WebKit
 * tidak — sampai sekarang Safari belum mengimplementasikannya, dan yang
 * terjadi bukan hasil kosong melainkan lemparan:
 *
 *     TypeError: undefined is not a function (near '...e of t...')
 *
 * pdf.js memakainya di `getTextContent()`, jalur yang dilewati SETIAP
 * pembacaan PDF. Akibatnya di iPhone tiap statement gagal dibaca, sementara
 * di Android dan desktop berjalan normal dari berkas dan situs yang sama
 * persis. Bug yang mustahil ditemukan dari pesan "tidak dikenali".
 *
 * Tambalannya mengikuti perilaku yang sudah dibakukan: `next()` membaca satu
 * potongan, `return()` membatalkan stream dan melepas kunci pembacanya.
 *
 * Kelas diterima sebagai argumen supaya bisa diuji tanpa browser.
 */
export function pasangIteratorStream(Kelas = globalThis.ReadableStream) {
  if (typeof Kelas !== 'function') return false;
  const proto = Kelas.prototype;
  if (proto[Symbol.asyncIterator]) return false;

  const nilai = function ({ preventCancel = false } = {}) {
    const pembaca = this.getReader();
    return {
      async next() {
        try {
          const { done, value } = await pembaca.read();
          if (done) pembaca.releaseLock();
          return { done, value };
        } catch (e) {
          // Kunci harus dilepas juga saat gagal; kalau tidak, stream-nya
          // tersangkut dan pembacaan berikutnya ikut mati.
          pembaca.releaseLock();
          throw e;
        }
      },
      async return(value) {
        if (preventCancel) {
          pembaca.releaseLock();
        } else {
          const batal = pembaca.cancel(value);
          pembaca.releaseLock();
          await batal;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };

  Object.defineProperty(proto, Symbol.asyncIterator, {
    value: nilai,
    writable: true,
    configurable: true,
  });
  if (!proto.values) {
    Object.defineProperty(proto, 'values', { value: nilai, writable: true, configurable: true });
  }
  return true;
}
