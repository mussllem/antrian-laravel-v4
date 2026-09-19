/**
 * echo-setup.js
 * Inisialisasi Laravel Echo + Pusher-js untuk terhubung ke server Laravel Reverb.
 *
 * Dibutuhkan di <head> halaman:
 *   <script src="https://cdn.jsdelivr.net/npm/pusher-js@8.4.0/dist/web/pusher.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/laravel-echo@1.16.1/dist/echo.iife.js"></script>
 *
 * Nilai konfigurasi diambil dari <meta> yang dirender Blade (lihat layout tiap halaman).
 */
(function () {
    function meta(name, fallback) {
        const el = document.querySelector(`meta[name="${name}"]`);
        return el ? el.getAttribute('content') : fallback;
    }

    window.setupEcho = function () {
        if (typeof Echo === 'undefined' || typeof Pusher === 'undefined') {
            console.warn('Echo/Pusher belum dimuat — realtime dinonaktifkan.');
            return null;
        }

        window.Pusher = Pusher;

        const echo = new Echo({
            broadcaster: 'reverb',
            key: meta('reverb-key', 'local-key'),
            wsHost: meta('reverb-host', window.location.hostname),
            wsPort: Number(meta('reverb-port', 8080)),
            wssPort: Number(meta('reverb-port', 8080)),
            forceTLS: meta('reverb-scheme', 'http') === 'https',
            enabledTransports: ['ws', 'wss'],
        });

        return echo;
    };
})();
