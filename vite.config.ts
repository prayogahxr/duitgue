import { defineConfig, type Plugin } from 'vite'

/**
 * Content-Security-Policy, disuntikkan ke hasil build.
 *
 * Ini bukan pengerasan generik. Aturan pertama proyek ini adalah tidak ada
 * apa pun yang keluar dari perangkat, dan sampai sekarang yang menjaganya
 * cuma disiplin: jangan menulis `fetch()`. CSP mengubahnya jadi sesuatu yang
 * ditegakkan browser.
 *
 * `connect-src 'none'` adalah barisnya. Dengan itu, fetch, XHR, WebSocket,
 * dan sendBeacon ke mana pun — termasuk ke asal sendiri — ditolak browser,
 * bukan oleh kode kita. Kalau suatu hari ada yang menambahkan pengiriman
 * data, entah sengaja, salah tempel, atau lewat dependensi, halaman ini
 * berhenti bekerja dan muncul pelanggaran di console. Gagal keras, bukan
 * diam-diam mengirim mutasi orang.
 *
 * Yang lain menutup jalur masuk yang biasa dipakai untuk menyelundupkan
 * skrip: tidak ada skrip dari luar, tidak ada `eval`, tidak ada plugin,
 * tidak ada `<base>` yang bisa membelokkan URL relatif, tidak ada form yang
 * bisa dikirim ke mana pun.
 *
 * Disuntikkan HANYA saat build. Vite dev butuh WebSocket untuk hot reload,
 * dan `connect-src 'none'` akan mematikannya.
 *
 * Catatan kenapa tiap izin ada:
 *   script-src  'self'               — cuma bundel kita sendiri
 *   worker-src  'self' blob:         — worker pdf.js
 *   style-src   'self' 'unsafe-inline' — atribut style= untuk lebar batang
 *                                        dan pita persentil, dihitung dari
 *                                        data, jadi tidak bisa dipindah ke
 *                                        berkas CSS statis
 *   img-src     'self' data:         — logo, elemen hias, favicon
 *   font-src    'self'               — huruf pixel yang dibundel lokal
 *   connect-src 'none'               — ini intinya
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // frame-ancestors sengaja TIDAK di sini: browser mengabaikannya kalau
  // datang lewat <meta>, dan hanya menambah pesan error di console. Yang
  // menjaga pembingkaian ada di public/_headers, sebagai header sungguhan.
].join('; ')

function suntikCsp(): Plugin {
  return {
    name: 'duitgue-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  // Jalur relatif, bukan absolut. Dengan ini hasil build bisa disajikan dari
  // akar domain MAUPUN dari subfolder — GitHub Pages menyajikan repo proyek
  // di https://<user>.github.io/<repo>/, dan jalur absolut akan mencari
  // /assets/... di akar domain, bukan di dalam subfoldernya.
  base: './',
  // Worker klasik, bukan module worker.
  //
  // Bawaannya Vite membangun worker sebagai modul dan memanggilnya dengan
  // `new Worker(url, { type: 'module' })`. Safari baru mendukung itu di iOS
  // 16.4; di bawah itu worker-nya gagal dijalankan, pdf.js kehilangan
  // mesinnya, dan tiap berkas berakhir sebagai "gagal dibaca" tanpa sebab
  // yang kelihatan.
  //
  // Berkas worker pdf.js yang dibundel tidak punya satu pun `import`, jadi
  // tidak ada yang hilang dengan menjadikannya klasik.
  worker: { format: 'iife' },
  plugins: [suntikCsp()],
  test: {
    // Sengaja tanpa passWithNoTests: kalau fixture atau berkas test hilang,
    // suite harus gagal keras, bukan hijau karena tidak ada yang diuji.
    include: ['src/**/*.test.{js,ts}', 'test/**/*.test.{js,ts}'],
  },
})
