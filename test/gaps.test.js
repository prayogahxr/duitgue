/**
 * Deteksi celah antar bulan.
 *
 * Dipisahkan dari IndexedDB supaya bisa diuji tanpa browser. Yang diuji di
 * sini logikanya; penyimpanannya sendiri diverifikasi manual di browser
 * terhadap statement asli.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { cariCelah, kunciPeriode } from '../src/core/gaps.js';
import * as bca from '../src/parsers/bca.js';

const st = (accountId, month, year, openingBalance, closingBalance) => ({
  accountId, month, year, openingBalance, closingBalance,
});

describe('cariCelah', () => {
  it('bulan beruntun dengan saldo nyambung: tidak ada temuan', () => {
    expect(cariCelah([
      st('bca', 1, 2026, 100, 200),
      st('bca', 2, 2026, 200, 300),
      st('bca', 3, 2026, 300, 250),
    ])).toEqual([]);
  });

  it('bulan yang lompat dilaporkan dan menyebut bulan yang hilang', () => {
    const t = cariCelah([st('bca', 1, 2026, 100, 200), st('bca', 3, 2026, 900, 950)]);
    expect(t).toHaveLength(1);
    expect(t[0].jenis).toBe('bulan-hilang');
    expect(t[0].pesan).toContain('Februari 2026');
  });

  it('beberapa bulan hilang berturut-turut disebut semuanya', () => {
    const t = cariCelah([st('bca', 1, 2026, 100, 200), st('bca', 4, 2026, 900, 950)]);
    expect(t[0].pesan).toContain('Februari 2026');
    expect(t[0].pesan).toContain('Maret 2026');
  });

  // Ini kasus yang paling mudah lolos tanpa disadari: bulannya lengkap,
  // tapi angkanya membuktikan ada mutasi yang tidak ikut terunggah.
  it('saldo yang tidak nyambung dilaporkan beserta selisihnya', () => {
    const t = cariCelah([st('bca', 1, 2026, 100, 200), st('bca', 2, 2026, 250, 400)]);
    expect(t).toHaveLength(1);
    expect(t[0].jenis).toBe('saldo-tidak-nyambung');
    expect(t[0].selisih).toBe(50);
  });

  it('bulan yang bolong tidak dilaporkan dua kali sebagai saldo tidak nyambung', () => {
    const t = cariCelah([st('bca', 1, 2026, 100, 200), st('bca', 3, 2026, 999, 1000)]);
    expect(t.map((x) => x.jenis)).toEqual(['bulan-hilang']);
  });

  it('pergantian tahun dihitung benar', () => {
    expect(cariCelah([st('bca', 12, 2025, 100, 200), st('bca', 1, 2026, 200, 300)])).toEqual([]);
    const t = cariCelah([st('bca', 11, 2025, 100, 200), st('bca', 1, 2026, 200, 300)]);
    expect(t[0].pesan).toContain('Desember 2025');
  });

  it('sumber tanpa saldo hanya diperiksa bulannya', () => {
    expect(cariCelah([
      st('gopay', 1, 2026, null, null),
      st('gopay', 2, 2026, null, null),
    ])).toEqual([]);
    const t = cariCelah([st('gopay', 1, 2026, null, null), st('gopay', 3, 2026, null, null)]);
    expect(t.map((x) => x.jenis)).toEqual(['bulan-hilang']);
  });

  it('tiap akun diperiksa sendiri-sendiri', () => {
    const t = cariCelah([
      st('bca', 1, 2026, 100, 200), st('bca', 2, 2026, 200, 300),
      st('gopay', 1, 2026, null, null), st('gopay', 3, 2026, null, null),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].accountId).toBe('gopay');
  });

  it('bulan yang sama diunggah dua kali tidak jadi temuan palsu', () => {
    expect(cariCelah([
      st('bca', 1, 2026, 100, 200),
      st('bca', 1, 2026, 100, 200),
      st('bca', 2, 2026, 200, 300),
    ])).toEqual([]);
  });

  it('kunciPeriode bisa diurutkan sebagai teks', () => {
    expect(kunciPeriode(6, 2026)).toBe('2026-06');
    expect([kunciPeriode(12, 2025), kunciPeriode(2, 2026)].sort()).toEqual(['2025-12', '2026-02']);
  });
});

// Fixture BCA sekarang dirantai saat dibuat — saldo akhir bulan N jadi saldo
// awal bulan N+1, seperti statement sungguhan. Sebelum dirantai, tiap bulan
// mulai dari angka yang sama dan pemeriksaan ini selalu melaporkan celah.
describe('Fixture tiga bulan nyambung', () => {
  const statements = ['06', '07', '08'].map((m) => {
    const r = bca.parseItems(
      JSON.parse(fs.readFileSync(new URL(`./fixtures-anon/bca-2026-${m}.json`, import.meta.url), 'utf8')),
    );
    return st('bca', r.period.month, r.period.year, r.openingBalance, r.closingBalance);
  });

  it('tidak ada celah di Juni-Agustus', () => {
    expect(cariCelah(statements)).toEqual([]);
  });

  it('melepas Juli membuat celahnya ketahuan', () => {
    const t = cariCelah([statements[0], statements[2]]);
    expect(t).toHaveLength(1);
    expect(t[0].pesan).toContain('Juli 2026');
  });
});
