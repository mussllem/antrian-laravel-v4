# Sistem Antrian — Laravel + MySQL + Reverb (WebSocket)

Sistem antrian dengan **loket dinamis** yang diatur dari panel admin, panggilan nomor
dengan **suara MP3 pra-rekam**, dan sinkronisasi **realtime** antar layar via Laravel Reverb.

## Fitur
- **Panel Admin** — CRUD Loket & Layanan; satu loket bisa melayani beberapa layanan (dinamis).
- **Login berbasis peran** — `admin` (kelola sistem) & `operator` (petugas loket).
- **Penguncian loket** — saat seorang operator memilih/menempati sebuah loket, operator lain
  **tidak bisa** memilih loket yang sama sampai dilepas (validasi transaksional anti-balapan).
- **Auto-release loket** — loket otomatis dibebaskan saat operator **logout**, dan bila
  operator idle/menghilang (tutup browser, koneksi putus) melebihi `LOKET_IDLE_TIMEOUT`
  menit (default 15). Panel operator mengirim *heartbeat* berkala agar loketnya tetap segar.
- **Kios Ambil Tiket** — pengunjung memilih layanan → dapat nomor (mis. `A012`).
- **Cetak tiket** — struk siap cetak (printer termal 58/80mm), otomatis membuka dialog print.
- **Panel Operator/Loket** — Panggil Berikutnya, Panggil Ulang, Lewati, Selesai, Lepas Loket.
- **Layar Display/Monitor** — menampilkan nomor + loket dan **memutar suara** panggilan (MP3 TTS ID).
- **Laporan** — ringkasan status, per layanan, per loket, rata-rata waktu layan, tren harian,
  filter rentang tanggal, dan **ekspor CSV**.
- **Realtime** — perubahan langsung tersiar ke semua layar lewat WebSocket (Reverb).

### Akun default (dari seeder)
| Peran | Email | Password |
|-------|-------|----------|
| Admin | `admin@antrian.test` | `password` |
| Operator | `operator1@antrian.test` | `password` |
| Operator | `operator2@antrian.test` | `password` |

---

## 1. Prasyarat
- PHP 8.2+, Composer
- MySQL 8+ (atau MariaDB)
- Node.js (opsional; frontend memakai CDN sehingga tanpa build pun bisa jalan)

## 2. Instalasi
Repo ini **sudah berisi proyek Laravel 11 lengkap** (composer.json, artisan, bootstrap,
config, migrasi bawaan, storage, dll). Cukup pasang dependensi:

```bash
# a) pasang dependensi PHP (mengunduh vendor/, termasuk laravel/reverb)
composer install

# b) konfigurasi environment
cp .env.example .env
php artisan key:generate
# edit .env -> sesuaikan DB_* (MySQL) dan REVERB_*

# c) buat database MySQL bernama sesuai DB_DATABASE (default: sistem_antrian)
#    lalu jalankan migrasi + data contoh (layanan, loket, akun admin)
php artisan migrate --seed

# d) (opsional) pasang dependensi frontend bila ingin build via Vite
npm install
```

> **Akun admin default** (dari seeder): `admin@antrian.test` / `password` — segera ganti.
> Login admin sudah tersedia bawaan di `/login` (tanpa perlu Laravel Breeze).

## 3. Menjalankan
Buka **3 terminal**:

```bash
php artisan serve          # 1) web app  -> http://localhost:8000
php artisan reverb:start   # 2) WebSocket -> port 8080
php artisan queue:work     # 3) worker (jika QUEUE_CONNECTION != sync)
```

## 4. URL
| Halaman | URL |
|--------|-----|
| Login admin | `/login` (admin@antrian.test / password) |
| Kios ambil tiket | `/kiosk` |
| Layar display | `/display` (klik sekali untuk mengaktifkan suara) |
| Operator | `/operator` → pilih loket |
| Admin loket | `/admin/counters` |
| Admin layanan | `/admin/services` |

## 5. Suara panggilan
Letakkan file MP3 sesuai **`public/audio/README-AUDIO.md`**. Tanpa file audio,
sistem tetap berjalan (hanya panggilan visual). Layar display perlu **satu klik**
di awal untuk membuka izin autoplay browser.

## 6. Alur singkat
1. Admin membuat Layanan (mis. Umum=A, Pembayaran=B) dan Loket, lalu mencentang layanan mana yang ditangani tiap loket.
2. Pengunjung ambil nomor di `/kiosk`.
3. Operator di `/operator/{loket}` menekan **Panggil Berikutnya** → event tersiar.
4. Layar `/display` menampilkan nomor & memutar suara; operator bisa **Panggil Ulang** untuk mengulang suara.

## Struktur utama
```
app/Models/{Service,Counter,Ticket}.php
app/Events/{TicketCalled,QueueUpdated}.php
app/Http/Controllers/{Kiosk,Operator,Display}Controller.php
app/Http/Controllers/Admin/{Counter,Service}Controller.php
routes/web.php, routes/channels.php
resources/views/{layouts,admin,operator,display,kiosk}/*.blade.php
public/js/{queue-audio.js,echo-setup.js}
public/audio/  (taruh MP3 di sini)
config/{broadcasting,reverb}.php
database/migrations/*, database/seeders/QueueSeeder.php
```

## Troubleshooting

### "cURL error 7: Failed to connect to localhost port 8080" saat ambil nomor
Artinya aplikasi mencoba menyiarkan event realtime tapi **server Reverb tidak berjalan**.

- Ambil nomor / panggilan **tetap berhasil** meski Reverb mati (penyiaran dibungkus
  `try/catch`; kegagalan hanya dicatat sebagai warning di `storage/logs`). Layar tetap
  tersinkron lewat polling fallback, hanya kehilangan update instan.
- Untuk mengaktifkan kembali realtime, jalankan server WebSocket-nya:
  ```bash
  php artisan reverb:start
  ```
  Pastikan `REVERB_HOST` / `REVERB_PORT` di `.env` cocok dengan tempat Reverb berjalan.
- Tidak ingin memakai realtime sama sekali? Set `BROADCAST_CONNECTION=log` (atau `null`)
  di `.env`, lalu `php artisan config:clear`. Sistem berjalan penuh dengan polling.
