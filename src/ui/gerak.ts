/**
 * Gerak saat digulir.
 *
 * Satu pengamat untuk seluruh halaman: blok yang masuk layar dapat kelas
 * `tiba`, dan CSS yang menggeser posisinya. Tidak ada gerak yang dijalankan
 * dari sini — berkas ini cuma menambah kelas.
 *
 * Tiga hal yang membatasinya:
 *
 * 1. **Isinya tidak pernah disembunyikan.** Yang berubah cuma `translate`
 *    dan bayangan, tidak ada `opacity` dan tidak ada `display`. Kalau
 *    JavaScript mati, halaman tetap terbaca utuh — cuma tanpa gerak.
 * 2. **Sekali jalan.** Begitu tiba, elemennya berhenti diamati. Blok yang
 *    bergoyang tiap kali dilewati bukan gaya, itu gangguan.
 * 3. **Angka tidak ikut bergerak.** Yang diamati kartu dan kotak tabel,
 *    bukan angka besar di layar depan.
 */

const pengamat =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entri, o) => {
          for (const e of entri) {
            if (!e.isIntersecting) continue
            e.target.classList.add('tiba')
            o.unobserve(e.target)
          }
        },
        // Sedikit di dalam layar, bukan tepat di tepinya: blok yang baru
        // separuh kelihatan sudah selesai bergesernya saat benar-benar dibaca.
        { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
      )

/** Blok yang layak bergeser: kartu, kotak tabel, dan blok berwarna. */
const PILIH = '.stat, .belum, .catatan, .bungkus, details'

export function amatiGerak(akar: ParentNode = document) {
  if (!pengamat) return
  const semua = [...akar.querySelectorAll<HTMLElement>(PILIH), ...(akar instanceof Element && akar.matches('.slam') ? [akar] : [])]
  for (const el of semua) el.classList.add('slam')
  for (const el of akar.querySelectorAll<HTMLElement>('.slam')) {
    if (el.classList.contains('tiba')) continue
    pengamat.observe(el)
  }
}
