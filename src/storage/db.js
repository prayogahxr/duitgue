/**
 * Penyimpanan lokal (IndexedDB).
 *
 * Semuanya di perangkat user. Tidak ada satu pun byte yang dikirim ke mana
 * pun — lihat aturan pertama di docs/ARCHITECTURE.md.
 *
 * Empat object store:
 *
 *   accounts      satu baris per rekening/dompet
 *   transactions  satu baris per transaksi, kunci = ID deterministik
 *   uploads       satu baris per berkas yang pernah diunggah
 *   corrections   koreksi kategori dari user, kunci = merchant
 *
 * **Deduplikasi datang dari kunci, bukan dari perbandingan.** ID transaksi
 * adalah hash dari isinya (lihat src/core/dedupe.js), jadi berkas yang sama
 * selalu menghasilkan kunci yang sama. Menyimpan ulang berkas yang sudah
 * pernah masuk menimpa baris yang identik — jumlahnya tidak bertambah. Yang
 * perlu dihitung manual hanya berapa yang benar-benar baru, supaya bisa
 * dilaporkan ke user.
 *
 * `uploads` bukan bagian dari deduplikasi. Gunanya supaya user tahu bulan
 * apa saja yang sudah ada, dan supaya celah antar bulan bisa dideteksi dari
 * saldo awal/akhir tiap statement tanpa membaca ulang seluruh transaksi.
 */
import { openDB } from 'idb';
import { kunciPeriode } from '../core/gaps.js';
import { terapkanKoreksi } from '../core/merchant.js';

const NAMA_DB = 'duitgue';
const VERSI = 2;

export function bukaDb() {
  return openDB(NAMA_DB, VERSI, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('accountId', 'accountId');
        s.createIndex('valueDate', 'valueDate');
      }
      if (!db.objectStoreNames.contains('uploads')) {
        const s = db.createObjectStore('uploads', { keyPath: 'id' });
        s.createIndex('accountId', 'accountId');
      }
      // Ditambahkan di versi 2. Koreksi disimpan per MERCHANT, bukan per
      // transaksi: itu yang membuat satu koreksi ikut memperbaiki transaksi
      // lain dari tempat yang sama, termasuk yang baru diunggah nanti.
      if (!db.objectStoreNames.contains('corrections')) {
        db.createObjectStore('corrections', { keyPath: 'merchantKey' });
      }
    },
  });
}

/**
 * Simpan hasil ingest. Hanya berkas yang lolos validasi yang masuk.
 * @returns {{ditambah: number, dilewati: number, berkasBaru: number, berkasDiulang: number}}
 */
export async function simpanHasil(hasil) {
  const db = await bukaDb();
  const tx = db.transaction(['accounts', 'transactions', 'uploads'], 'readwrite');
  const stAkun = tx.objectStore('accounts');
  const stTrx = tx.objectStore('transactions');
  const stUnggah = tx.objectStore('uploads');

  let ditambah = 0;
  let dilewati = 0;
  let berkasBaru = 0;
  let berkasDiulang = 0;

  for (const b of hasil.berkas) {
    if (!b.ok) continue;

    await stAkun.put({
      id: b.sumberId,
      institution: b.akun?.bank ?? b.sumber,
      type: b.akun?.type ?? null,
      accountNumber: b.akun?.accountNumber ?? null,
      name: b.akun?.name ?? null,
    });

    // Satu statement = satu akun + satu periode. Nama berkas sengaja TIDAK
    // ikut jadi kunci: berkas yang sama sering diunduh ulang dengan nama
    // berbeda, dan itu tetap statement yang sama.
    const idUnggah = `${b.sumberId}:${kunciPeriode(b.periode?.month, b.periode?.year)}`;
    const sudahAda = await stUnggah.get(idUnggah);
    if (sudahAda) berkasDiulang++;
    else berkasBaru++;

    await stUnggah.put({
      id: idUnggah,
      accountId: b.sumberId,
      nama: b.nama,
      sumber: b.sumber,
      month: b.periode?.month ?? null,
      year: b.periode?.year ?? null,
      openingBalance: b.pembukaan ?? null,
      closingBalance: b.penutupan ?? null,
      jumlahTransaksi: b.transactions.length,
      diunggahPada: new Date().toISOString(),
    });
  }

  // Transaksi diambil dari timeline gabungan, bukan dari per berkas: di situ
  // penandaan transfer dan kategorinya sudah terpasang.
  for (const t of hasil.transactions) {
    const lama = await stTrx.get(t.id);
    if (lama) dilewati++;
    else ditambah++;
    await stTrx.put(serialisasi(t));
  }

  await tx.done;
  return { ditambah, dilewati, berkasBaru, berkasDiulang };
}

/**
 * Date tidak bisa disimpan apa adanya di semua peramban lama, dan lebih
 * penting lagi: dibaca balik harus tetap Date supaya pengurutan dan
 * perbandingan di lapisan lain tidak diam-diam berubah jadi string.
 */
function serialisasi(t) {
  return {
    ...t,
    valueDate: t.valueDate instanceof Date ? t.valueDate.toISOString() : t.valueDate,
    postedDate: t.postedDate instanceof Date ? t.postedDate.toISOString() : t.postedDate,
  };
}

function deserialisasi(t) {
  return {
    ...t,
    valueDate: t.valueDate ? new Date(t.valueDate) : null,
    postedDate: t.postedDate ? new Date(t.postedDate) : null,
  };
}

/** Simpan satu koreksi kategori untuk sebuah merchant. */
export async function simpanKoreksi(merchantKey, category, categoryLabel) {
  const db = await bukaDb();
  await db.put('corrections', {
    merchantKey,
    category,
    categoryLabel,
    dikoreksiPada: new Date().toISOString(),
  });
}

/** Hapus koreksi sebuah merchant, kembali ke hasil aturan. */
export async function hapusKoreksi(merchantKey) {
  const db = await bukaDb();
  await db.delete('corrections', merchantKey);
}

export async function muatKoreksi() {
  const db = await bukaDb();
  return db.getAll('corrections');
}

/** Seluruh isi penyimpanan, siap dipakai lapisan tampilan. */
export async function muatSemua() {
  const db = await bukaDb();
  const [accounts, transactions, uploads, corrections] = await Promise.all([
    db.getAll('accounts'),
    db.getAll('transactions'),
    db.getAll('uploads'),
    db.getAll('corrections'),
  ]);
  return {
    accounts,
    // Koreksi diterapkan saat DIBACA, bukan ditulis ke baris transaksi.
    // Dengan begitu mengubah atau mencabut koreksi langsung berlaku untuk
    // seluruh riwayat tanpa perlu menulis ulang apa pun, dan kategori tetap
    // benar-benar field turunan.
    transactions: terapkanKoreksi(
      transactions.map(deserialisasi).sort((a, b) => a.valueDate - b.valueDate),
      corrections,
    ),
    uploads: uploads.sort((a, b) => (a.year - b.year) || (a.month - b.month)),
    corrections,
  };
}

/**
 * Hapus seluruh isi. Bukan sekadar mengosongkan tampilan — datanya memang
 * hilang dari perangkat. User yang mengunggah mutasi rekening harus punya
 * jalan keluar yang jelas dan tidak setengah-setengah.
 */
export async function hapusSemua() {
  const db = await bukaDb();
  const tx = db.transaction(['accounts', 'transactions', 'uploads', 'corrections'], 'readwrite');
  await Promise.all([
    tx.objectStore('accounts').clear(),
    tx.objectStore('transactions').clear(),
    tx.objectStore('uploads').clear(),
    tx.objectStore('corrections').clear(),
    tx.done,
  ]);
}
