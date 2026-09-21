/**
 * ID transaksi yang deterministik dari isinya.
 *
 * File yang sama selalu menghasilkan ID yang sama, jadi unggahan yang
 * tumpang tindih tidak menambah baris duplikat.
 *
 * PENTING — occurrenceIndex.
 * Transaksi yang benar-benar identik itu nyata dan tidak jarang. Di
 * statement BCA Juni 2026 ada dua top up GoPay Rp11.000 di tanggal 17
 * dengan keterangan persis sama. Tanpa indeks urutan, keduanya
 * menghasilkan ID yang sama dan sistem memperlakukannya sebagai satu
 * transaksi — satu baris hilang diam-diam, dan pencocokan transfer
 * ikut gagal karena menganggap pasangannya sudah terpakai.
 *
 * Indeks dihitung dari urutan kemunculan di dalam statement. Urutannya
 * tetap selama file yang sama diparsing ulang, jadi sifat deterministiknya
 * terjaga.
 */
/**
 * FUNGSINYA ASYNC karena Web Crypto `digest()` async, dan Web Crypto dipilih
 * supaya modul ini jalan sama persis di browser dan di Node tanpa cabang
 * khusus. `crypto` Node sebelumnya membuat modul ini tidak bisa dimuat Vite
 * sama sekali — Vite mengeksternalisasinya dan aplikasi mati saat dimuat.
 */
export async function assignIds(transactions, accountId) {
  const seen = new Map();
  const out = [];
  for (const t of transactions) {
    const base = [
      accountId,
      t.valueDate.toISOString(),
      t.amountCents,
      t.description,
      t.balanceAfterCents ?? '',
    ].join('|');

    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);

    out.push({ ...t, accountId, id: await sha256Hex(`${base}|${n}`), occurrenceIndex: n });
  }
  return out;
}

/** 16 heksadesimal pertama dari SHA-256. Cukup untuk membedakan transaksi. */
async function sha256Hex(teks) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(teks));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** Gabungkan transaksi baru ke yang sudah tersimpan, buang yang sudah ada. */
export function mergeUnique(existing, incoming) {
  const ids = new Set(existing.map((t) => t.id));
  const added = incoming.filter((t) => !ids.has(t.id));
  return { merged: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}
