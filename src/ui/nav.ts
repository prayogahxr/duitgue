/**
 * Bar atas: penanda seksi, bayangan saat digulung, tombol balik ke atas.
 *
 * Semua yang bisa diserahkan ke CSS sudah diserahkan ke CSS — garis kemajuan
 * memakai `animation-timeline: scroll()`, jadi tidak ada satu pun penangan
 * scroll di berkas ini untuk hal itu. Yang tersisa di JavaScript cuma dua
 * hal yang memang butuh tahu posisi: seksi mana yang sedang dibaca, dan
 * apakah halaman sudah cukup jauh digulung.
 *
 * Keduanya pakai IntersectionObserver, bukan event `scroll`. Penangan scroll
 * yang jalan di tiap piksel adalah cara paling gampang membuat halaman yang
 * isinya 4000px terasa berat.
 */

const puncak = document.querySelector<HTMLElement>('#puncak')
const keAtas = document.querySelector<HTMLElement>('#ke-atas')
const tautan = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[data-seksi]')]

/**
 * Tautan seksi cuma muncul kalau seksinya ada isinya. Nav yang menunjuk ke
 * tempat kosong lebih buruk daripada nav yang pendek.
 */
export function segarkanNav() {
  for (const a of tautan) {
    const seksi = document.getElementById(a.dataset.seksi!)
    a.hidden = !seksi || seksi.childElementCount === 0
  }
}

/** Bayangan bar + tombol balik ke atas, dipicu satu sentinel di puncak halaman. */
function pasangSentinel() {
  if (!puncak) return
  const tanda = document.createElement('div')
  tanda.setAttribute('aria-hidden', 'true')
  tanda.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:90vh;pointer-events:none;'
  document.body.prepend(tanda)

  new IntersectionObserver(
    ([e]) => {
      const jauh = !e.isIntersecting
      puncak.classList.toggle('tergulung', jauh)
      keAtas?.classList.toggle('terlihat', jauh)
    },
    { threshold: 0 },
  ).observe(tanda)
}

/**
 * Seksi yang sedang dibaca.
 *
 * Yang dipakai seksi paling atas yang masih kelihatan, bukan yang paling
 * banyak kelihatan: dengan tabel sepanjang layar, "paling banyak kelihatan"
 * membuat penandanya lompat-lompat di tengah gulungan.
 */
function pasangPenanda() {
  const seksi = tautan
    .map((a) => document.getElementById(a.dataset.seksi!))
    .filter((el): el is HTMLElement => !!el)
  if (!seksi.length) return

  const terlihat = new Set<Element>()
  const pengamat = new IntersectionObserver(
    (entri) => {
      for (const e of entri) {
        if (e.isIntersecting) terlihat.add(e.target)
        else terlihat.delete(e.target)
      }
      const teratas = seksi.find((el) => terlihat.has(el))
      for (const a of tautan) {
        a.classList.toggle('aktif', !!teratas && a.dataset.seksi === teratas.id)
      }
    },
    // Batas atas sejauh tinggi bar, batas bawah di tengah layar: seksi
    // dianggap "sedang dibaca" saat dia mengisi bagian atas layar.
    { rootMargin: '-72px 0px -55% 0px', threshold: 0 },
  )
  for (const el of seksi) pengamat.observe(el)
}

export function pasangNav() {
  pasangSentinel()
  pasangPenanda()
  segarkanNav()
}
