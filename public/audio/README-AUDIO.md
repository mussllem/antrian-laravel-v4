# File Suara Antrian (MP3)

Panggilan suara dibentuk dengan **menggabungkan potongan MP3** secara berurutan.
File di bawah ini **SUDAH DISERTAKAN** (hasil Text-to-Speech bahasa Indonesia).

## Sudah tersedia

| File | Isi ucapan |
|------|-----------|
| `digit/0.mp3` … `digit/9.mp3` | "nol", "satu", … "sembilan" |
| `nomor-antrian.mp3` | "nomor antrian" |
| `menuju.mp3` | "menuju" |
| `loket.mp3` | "loket" |
| `prefix/A.mp3` … `prefix/J.mp3` | huruf awalan layanan (A–J tersedia) |

> Butuh prefix lain (K, L, …)? Tambahkan `prefix/<HURUF>.mp3` dengan nama sama.

## Nada pembuka (bell)

Nada "ding-dong" pembuka **disintesis otomatis di browser** (Web Audio API),
jadi **tidak perlu file `bell.mp3`**. Jika Anda ingin memakai nada sendiri:

1. Letakkan `bell.mp3` di folder ini.
2. Di halaman display, set `player.useBellFile = true;` sebelum memanggil `announce()`.

## Contoh urutan yang dibunyikan

Nomor **A012** menuju **Loket 3** diputar sebagai:

```
(ding-dong) → nomor-antrian.mp3 → prefix/A.mp3
→ digit/0.mp3 → digit/1.mp3 → digit/2.mp3
→ menuju.mp3 → loket.mp3 → digit/3.mp3
```

## Mengganti/merekam ulang suara

- File ini dibuat via TTS. Untuk hasil lebih natural, rekam suara resepsionis
  dan timpa file dengan nama yang sama (format MP3).
- Jaga volume & jeda antar-potongan seragam agar sambungannya halus.

> Logika penggabungan ada di `public/js/queue-audio.js` (fungsi `_buildSequence()`).
