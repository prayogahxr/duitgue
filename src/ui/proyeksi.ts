/**
 * Tampilan proyeksi (Tahap 9).
 *
 * Tidak menghitung apa pun. Seluruh angka datang dari
 * `src/analytics/projection.js`.
 *
 * Dua hal yang membentuk berkas ini:
 *
 * 1. **Kendalinya tidak ikut digambar ulang.** Slider yang di-innerHTML tiap
 *    kali nilainya berubah akan kehilangan fokus di tengah geseran, dan
 *    geserannya putus. Jadi kendali dibangun sekali, dan yang digambar ulang
 *    cuma blok hasilnya.
 *
 * 2. **Tidak ada kalimat yang menyuruh.** Batas di ROADMAP: tampilkan
 *    asumsinya terbuka, jangan pernah menyuruh user melakukan sesuatu dengan
 *    uangnya. Slidernya menjawab "kalau begini, hasilnya jadi apa" — bukan
 *    "kamu harus begini".
 */
import { proyeksi, HORIZON_MIN, HORIZON_MAX, GESER_MAKS } from '../analytics/projection.js'
import { rupiah } from '../core/ingest.js'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Bertahan antar penggambaran ulang. */
let setelan = { bulan: 6, geserPoin: 0, targetSen: null as number | null }
let terbangun = false

/** Ringkasan terakhir yang digambar, supaya slider punya bahan saat digeser. */
let ringkasanTerakhir: any = null

/** "5.000.000" atau "5000000" → sen. Kosong berarti tidak ada target. */
function bacaTarget(teks: string): number | null {
  const digit = teks.replace(/[^\d]/g, '')
  if (!digit) return null
  return parseInt(digit, 10) * 100
}

function blokHasil(ringkasan: any): string {
  const p: any = proyeksi(ringkasan, setelan)

  if (!p.cukup) {
    return `<div class="catatan"><p>${esc(p.alasan)}</p></div>`
  }

  // Skala dipakai bersama seluruh baris, jadi panjang dan posisi pitanya bisa
  // dibandingkan antar bulan.
  //
  // Skalanya TIDAK dipaksa mulai dari nol. Dengan saldo ratusan juta dan
  // sebaran beberapa juta, memaksa nol membuat seluruh pita jadi garis
  // sepanjang belasan piksel yang tidak menunjukkan apa pun. Yang dijaga
  // bukan nol sebagai titik awal, tapi nol sebagai batas yang terlihat:
  // kalau ada jalur yang menembus ke bawah nol, garis nolnya digambar.
  const semua = p.jalur.flatMap((j: any) => [j.p10, j.p90])
  const bawah = Math.min(...semua)
  const atas = Math.max(...semua)
  const rentang = atas - bawah || 1
  const pos = (n: number) => ((n - bawah) / rentang) * 100
  const garisNol = bawah < 0 && atas > 0 ? pos(0) : null

  const baris = p.jalur
    .map(
      (j: any) => `<tr>
        <td>bulan ke-${j.bulanKe}</td>
        <td class="angka">${esc(rupiah(j.p10))}</td>
        <td class="angka">${esc(rupiah(j.p50))}</td>
        <td class="angka">${esc(rupiah(j.p90))}</td>
        <td class="pita-sel">
          <span class="pita">
            ${garisNol == null ? '' : `<span class="nol" style="left:${garisNol.toFixed(1)}%"></span>`}
            <span class="rentang" style="left:${pos(j.p10).toFixed(1)}%;width:${(pos(j.p90) - pos(j.p10)).toFixed(1)}%"></span>
            <span class="tengah" style="left:${pos(j.p50).toFixed(1)}%"></span>
          </span>
        </td>
      </tr>`,
    )
    .join('')

  const a = p.akhir
  const judul = p.dariNol
    ? `Tambahan tabungan ${p.horizon} bulan lagi`
    : `Saldo kelihatan ${p.horizon} bulan lagi`

  const blokTarget = p.target
    ? (() => {
        const t = p.target
        const persen = Math.round(t.porsiTercapai * 100)
        const bertahan = Math.round(t.porsiBertahan * 100)

        // Target yang saldo sekarang saja sudah di atasnya bukan soal "kapan
        // sampai" — itu soal apakah bertahan. Melaporkannya sebagai "belum
        // tercapai" akan benar menurut hitungan dan menyesatkan sebagai kalimat.
        if (t.sudahTercapai) {
          return `<div class="belum">
            <h3>${esc(rupiah(t.sen))} udah kelewat sama saldo sekarang</h3>
            <p>Tinggal soal tahan apa nggak: ${bertahan} dari 100 jalur masih di atasnya
            setelah ${p.horizon} bulan.</p>
          </div>`
        }

        if (persen === 0) {
          return `<div class="belum">
            <h3>${esc(rupiah(t.sen))} nggak kekejar dalam ${p.horizon} bulan</h3>
            <p>Nggak ada satu pun dari ${p.iterasi} jalur yang nyampe.</p>
          </div>`
        }
        return `<div class="belum">
          <h3>${esc(rupiah(t.sen))} kekejar di ${persen} dari 100 jalur</h3>
          <p>${
            t.tengah
              ? `Setengahnya nyampe di bulan ke-${t.tengah} atau lebih cepat.`
              : `Belum setengahnya dalam ${p.horizon} bulan.`
          }
          ${t.cepat ? `Paling ngebut bulan ke-${t.cepat}.` : ''}
          ${t.lambat ? `Paling lelet bulan ke-${t.lambat}.` : ''}
          ${bertahan < persen ? `Di akhir, ${bertahan} dari 100 masih di atasnya.` : ''}</p>
        </div>`
      })()
    : ''

  return `
    <div class="statistik">
      <div class="stat">
        <span class="label">${esc(judul)}, tengah</span>
        <span class="besar${a.p50 < 0 ? ' negatif' : ''}">${esc(rupiah(a.p50))}</span>
        <small>Setengah jalur mentok di atasnya, setengah di bawah.</small>
      </div>
      <div class="stat">
        <span class="label">Kalau bulannya lagi jelek</span>
        <span class="besar${a.p10 < 0 ? ' negatif' : ''}">${esc(rupiah(a.p10))}</span>
        <small>10 dari 100 jalur mentok di bawahnya.</small>
      </div>
      <div class="stat">
        <span class="label">Kalau bulannya lagi bagus</span>
        <span class="besar">${esc(rupiah(a.p90))}</span>
        <small>10 dari 100 jalur mentok di atasnya.</small>
      </div>
    </div>

    ${blokTarget}

    <div class="bungkus"><table>
      <thead><tr>
        <th>Bulan</th><th class="angka">Jelek</th><th class="angka">Tengah</th>
        <th class="angka">Bagus</th><th>Rentang</th>
      </tr></thead>
      <tbody>${baris}</tbody>
    </table></div>
    <p class="sekunder">Pita: ${esc(rupiah(bawah))} sampai ${esc(rupiah(atas))}, skala sama
    di semua baris. Garis item = jalur tengah${garisNol == null ? '' : ', garis tipis = nol'}.</p>

    <details>
      <summary>Asumsi</summary>
      <ul>
        <li>${p.dasarBulan} bulan penuh, ${esc(p.dariBulan)} sampai ${esc(p.sampaiBulan)}.
        Nggak ngitung inflasi, bunga, atau naik gaji.</li>
        <li>${p.iterasi} jalur, tiap bulan diambil acak dari bulan-bulan itu. Bulan yang
        minus ikut keambil.</li>
        <li>${
          p.dariNol
            ? 'Nggak ada saldo yang dicetak, jadi yang dihitung tambahan tabungan dari nol, bukan total duit lo.'
            : `Mulai dari ${esc(rupiah(p.mulaiDari))}, saldo tercetak paling akhir.`
        }${
          p.akunTanpaSaldo.length
            ? ` Saldo ${esc(p.akunTanpaSaldo.join(', '))} nggak dicetak, nggak ikut.`
            : ''
        }</li>
        <li>${
          p.geserPoin
            ? `Slider ${p.geserPoin} poin: pengeluaran dianggap turun ${p.geserPoin}% dari pemasukan tiap bulan. Ini pengandaian, bukan yang beneran kejadian.`
            : 'Slider nol: pengeluaran apa adanya.'
        }</li>
        <li>${p.dasarBulan} bulan itu dasar yang tipis. Rentangnya sebaran dari bulan-bulan
        itu doang, bukan semua yang mungkin kejadian.</li>
      </ul>
    </details>`
}

export function renderProyeksi(el: HTMLElement, ringkasan: any) {
  if (!ringkasan || !ringkasan.bulanan?.length) {
    el.innerHTML = ''
    terbangun = false
    return
  }

  if (!terbangun) {
    el.innerHTML = `
      <img class="hias hias-kilau el-kilau" src="./gambar/elemen-4.png" alt="" aria-hidden="true" />
      <h2>Proyeksi</h2>
      <p>Kalau bulan-bulan depan mirip yang udah kecatat. Bukan ramalan: ini ngulang
      acak bulan-bulan yang udah kejadian.</p>
      <div class="kartu setelan">
        <p>
          <label for="target">Lagi ngincer apa? Kosongin kalau nggak ada</label>
          <input id="target" type="text" inputmode="numeric" placeholder="misal 5.000.000" />
        </p>
        <p>
          <label for="horizon">Sejauh <strong id="horizon-nilai"></strong> ke depan</label>
          <input id="horizon" type="range" min="${HORIZON_MIN}" max="${HORIZON_MAX}" step="1" />
        </p>
        <p>
          <label for="geser">Gimana kalau pengeluaran turun
          <strong id="geser-nilai"></strong> dari pemasukan</label>
          <input id="geser" type="range" min="0" max="${GESER_MAKS}" step="1" />
        </p>
      </div>
      <div id="proyeksi-hasil"></div>`

    const elTarget = el.querySelector<HTMLInputElement>('#target')!
    const elHorizon = el.querySelector<HTMLInputElement>('#horizon')!
    const elGeser = el.querySelector<HTMLInputElement>('#geser')!
    const labelHorizon = el.querySelector<HTMLElement>('#horizon-nilai')!
    const labelGeser = el.querySelector<HTMLElement>('#geser-nilai')!
    const elHasil = el.querySelector<HTMLElement>('#proyeksi-hasil')!

    elHorizon.value = String(setelan.bulan)
    elGeser.value = String(setelan.geserPoin)
    if (setelan.targetSen != null) elTarget.value = String(setelan.targetSen / 100)

    const perbarui = () => {
      setelan = {
        bulan: parseInt(elHorizon.value, 10),
        geserPoin: parseInt(elGeser.value, 10),
        targetSen: bacaTarget(elTarget.value),
      }
      labelHorizon.textContent = `${setelan.bulan} bulan`
      labelGeser.textContent = `${setelan.geserPoin} poin`
      elHasil.innerHTML = blokHasil(ringkasanTerakhir)
    }

    // `input`, bukan `change`: proyeksinya ikut bergerak selama slider
    // digeser, bukan setelah dilepas. Itu yang membuat hubungan sebab-akibat
    // antara setelan dan hasilnya terlihat.
    elHorizon.addEventListener('input', perbarui)
    elGeser.addEventListener('input', perbarui)
    elTarget.addEventListener('input', perbarui)

    terbangun = true
    ringkasanTerakhir = ringkasan
    perbarui()
    return
  }

  // Sudah terbangun: datanya yang berubah (habis unggah), kendalinya tetap.
  ringkasanTerakhir = ringkasan
  const labelHorizon = el.querySelector<HTMLElement>('#horizon-nilai')!
  const labelGeser = el.querySelector<HTMLElement>('#geser-nilai')!
  labelHorizon.textContent = `${setelan.bulan} bulan`
  labelGeser.textContent = `${setelan.geserPoin} poin`
  el.querySelector<HTMLElement>('#proyeksi-hasil')!.innerHTML = blokHasil(ringkasan)
}
