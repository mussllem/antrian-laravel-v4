/**
 * queue-audio.js
 * Pemutar suara panggilan antrian dengan menggabungkan potongan MP3 pra-rekam.
 *
 * File audio yang dipakai (sudah disertakan, hasil TTS bahasa Indonesia): /audio/
 *   - /audio/nomor-antrian.mp3  ("nomor antrian")
 *   - /audio/menuju.mp3         ("menuju")
 *   - /audio/loket.mp3          ("loket")
 *   - /audio/prefix/A.mp3 ...   (huruf awalan layanan)
 *   - /audio/digit/0.mp3 ... 9.mp3   (angka satuan 0-9)
 *
 * Nada pembuka ("bell") DISINTESIS via Web Audio API (tidak perlu file mp3).
 * Bila Anda punya bell.mp3 sendiri, letakkan di /audio/bell.mp3 dan set
 *   player.useBellFile = true;  untuk memakainya.
 *
 * Cara pakai:
 *   const player = new QueueAudio('/audio');
 *   player.announce({ code_prefix:'A', code_digits:['1','2'], counter_number:3 });
 *
 * Suara dibunyikan berurutan: bell -> "nomor antrian" -> [prefix] -> digit satu per satu
 *                              -> "menuju loket" -> digit nomor loket.
 */
class QueueAudio {
    constructor(basePath = '/audio') {
        this.base = basePath.replace(/\/$/, '');
        this.queue = [];       // antrian pengumuman (biar tidak tumpang tindih)
        this.playing = false;
        this.cache = {};
        this.useBellFile = false; // true = pakai /audio/bell.mp3; false = sintesis nada
        this.audioCtx = null;
    }

    /** Bangkitkan nada "ding-dong" via Web Audio API (tanpa file). */
    _playBellTone() {
        return new Promise((resolve) => {
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return resolve();
                this.audioCtx = this.audioCtx || new Ctx();
                const ctx = this.audioCtx;
                if (ctx.state === 'suspended') ctx.resume();

                const notes = [
                    { f: 988, t: 0.0,  d: 0.35 }, // "ding" (B5)
                    { f: 784, t: 0.32, d: 0.5  }, // "dong" (G5)
                ];
                let last = 0;
                notes.forEach(({ f, t, d }) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = f;
                    const start = ctx.currentTime + t;
                    gain.gain.setValueAtTime(0.0001, start);
                    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, start + d);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(start);
                    osc.stop(start + d);
                    last = Math.max(last, t + d);
                });
                setTimeout(resolve, (last + 0.1) * 1000);
            } catch (e) {
                resolve();
            }
        });
    }

    _load(src) {
        if (!this.cache[src]) {
            const a = new Audio(src);
            a.preload = 'auto';
            this.cache[src] = a;
        }
        // clone supaya bisa diputar beruntun tanpa menunggu reset
        return new Audio(src);
    }

    _playOne(src) {
        return new Promise((resolve) => {
            const a = this._load(src);
            a.onended = resolve;
            a.onerror = () => { console.warn('Audio tidak ditemukan:', src); resolve(); };
            const p = a.play();
            if (p && p.catch) p.catch(() => resolve());
        });
    }

    _buildSequence({ code_prefix, code_digits = [], counter_number }) {
        const seq = [];
        if (this.useBellFile) {
            seq.push(`${this.base}/bell.mp3`);
        }
        seq.push(`${this.base}/nomor-antrian.mp3`);

        if (code_prefix) {
            seq.push(`${this.base}/prefix/${code_prefix}.mp3`);
        }
        // baca setiap digit nomor antrian satu per satu (mis. 012 -> 0,1,2)
        String(code_digits.join('')).split('').forEach((d) => {
            seq.push(`${this.base}/digit/${d}.mp3`);
        });

        if (counter_number != null) {
            seq.push(`${this.base}/menuju.mp3`);
            seq.push(`${this.base}/loket.mp3`);
            String(counter_number).split('').forEach((d) => {
                seq.push(`${this.base}/digit/${d}.mp3`);
            });
        }
        return seq;
    }

    async announce(payload) {
        this.queue.push(payload);
        if (this.playing) return;
        this.playing = true;

        while (this.queue.length) {
            const item = this.queue.shift();
            // nada pembuka: sintesis (default) atau file bell.mp3
            if (!this.useBellFile) {
                await this._playBellTone();
            }
            const seq = this._buildSequence(item);
            for (const src of seq) {
                await this._playOne(src);
            }
            // jeda kecil antar-pengumuman
            await new Promise((r) => setTimeout(r, 400));
        }
        this.playing = false;
    }
}

window.QueueAudio = QueueAudio;
