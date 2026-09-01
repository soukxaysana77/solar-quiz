// เสียงทั้งหมดสังเคราะห์สดด้วย Web Audio ไม่มีไฟล์เสียงให้โหลด หน้าเว็บเลยเบาเท่าเดิม
// เบราว์เซอร์ไม่ยอมให้เล่นเสียงก่อนผู้ใช้แตะหน้าจอ ทุกหน้าจึงต้องเรียก KG.sound.unlock() ตอนคลิกครั้งแรก
window.KG = window.KG || {};

KG.sound = (() => {
    const MUTE_KEY = 'mangosgo.muted';
    let ctx = null;
    let master = null;
    let musicGain = null;
    let musicTimer = null;
    let musicStep = 0;
    let muted = false;
    let unlocked = false;
    let wantMusic = false;

    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { muted = false; }

    function ensure() {
        if (!ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            ctx = new Ctor();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : 0.5;
            master.connect(ctx.destination);
            musicGain = ctx.createGain();
            musicGain.gain.value = 0.35;
            musicGain.connect(master);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // โน้ตหนึ่งตัว: oscillator + envelope กัน pop ตอนตัดเสียง
    // ก่อนผู้ใช้แตะหน้าจอ context ยังไม่เดิน ถ้าปล่อยให้จองคิวไว้ พอ resume เสียงจะระเบิดออกมาพร้อมกันหมด
    function tone({ freq, at = 0, dur = 0.15, type = 'square', gain = 0.2, glideTo = null, out = null }) {
        if (!unlocked || !ensure()) return;
        const start = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(env);
        env.connect(out || master);
        osc.start(start);
        osc.stop(start + dur + 0.02);
    }

    function noise({ at = 0, dur = 0.2, gain = 0.15 }) {
        if (!unlocked || !ensure()) return;
        const start = ctx.currentTime + at;
        const frames = Math.floor(ctx.sampleRate * dur);
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        const src = ctx.createBufferSource();
        const env = ctx.createGain();
        src.buffer = buffer;
        env.gain.value = gain;
        src.connect(env);
        env.connect(master);
        src.start(start);
    }

    // ลูปรอผู้เล่นในล็อบบี้ เบสเดินสลับกับอาร์เพจจิโอสั้น ๆ
    const BASS = [110, 110, 146.83, 130.81];
    const LEAD = [440, 523.25, 659.25, 523.25, 587.33, 523.25, 440, 392];

    function musicLoop() {
        const bar = Math.floor(musicStep / 4) % BASS.length;
        tone({ freq: BASS[bar], dur: 0.22, type: 'triangle', gain: 0.25, out: musicGain });
        tone({ freq: LEAD[musicStep % LEAD.length], at: 0.02, dur: 0.16, type: 'square', gain: 0.09, out: musicGain });
        musicStep++;
    }

    function beginMusic() {
        if (musicTimer || !unlocked || !ensure()) return;
        musicStep = 0;
        musicLoop();
        musicTimer = setInterval(musicLoop, 260);
    }

    return {
        unlock() {
            if (!ensure()) return;
            unlocked = true;
            if (wantMusic) beginMusic();
        },

        isMuted() { return muted; },

        setMuted(value) {
            muted = Boolean(value);
            try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
            if (master) master.gain.value = muted ? 0 : 0.5;
            return muted;
        },

        // ขอให้เล่นเพลงไว้ก่อนได้ ถ้ายังไม่ได้แตะหน้าจอจะรอจนกว่า unlock() ถูกเรียก
        startMusic() {
            wantMusic = true;
            beginMusic();
        },

        stopMusic() {
            wantMusic = false;
            clearInterval(musicTimer);
            musicTimer = null;
        },

        join() { tone({ freq: 660, dur: 0.1, type: 'sine', gain: 0.18, glideTo: 990 }); },

        start() {
            [392, 523.25, 659.25, 784].forEach((freq, i) => tone({ freq, at: i * 0.09, dur: 0.18, type: 'square', gain: 0.16 }));
        },

        // ติ๊กนับถอยหลัง ยิ่งเหลือน้อยยิ่งสูงและดัง
        tick(secondsLeft) {
            const urgency = Math.max(0, Math.min(5, secondsLeft));
            tone({ freq: 880 + (5 - urgency) * 90, dur: 0.06, type: 'square', gain: 0.07 + (5 - urgency) * 0.015 });
        },

        correct(streak = 1) {
            const steps = [523.25, 659.25, 783.99, 1046.5];
            steps.forEach((freq, i) => tone({ freq, at: i * 0.07, dur: 0.16, type: 'square', gain: 0.17 }));
            // ยิ่ง streak ยาว ยิ่งมีหางเสียงต่อท้าย
            for (let i = 1; i < Math.min(streak, 5); i++) {
                tone({ freq: 1046.5 + i * 130, at: 0.28 + i * 0.06, dur: 0.1, type: 'sine', gain: 0.12 });
            }
        },

        wrong() {
            tone({ freq: 220, dur: 0.32, type: 'sawtooth', gain: 0.16, glideTo: 110 });
            noise({ at: 0.02, dur: 0.18, gain: 0.06 });
        },

        timeUp() {
            tone({ freq: 330, dur: 0.4, type: 'triangle', gain: 0.2, glideTo: 130 });
        },

        podium() {
            const fanfare = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
            fanfare.forEach((freq, i) => tone({ freq, at: i * 0.14, dur: 0.3, type: 'square', gain: 0.2 }));
            [130.81, 196, 261.63].forEach((freq, i) => tone({ freq, at: i * 0.14, dur: 0.6, type: 'triangle', gain: 0.15 }));
            noise({ at: 0.85, dur: 0.5, gain: 0.08 });
        },

        // ปุ่มเปิด/ปิดเสียงมุมจอ ใช้ร่วมกันทุกหน้า
        mountToggle() {
            const button = document.createElement('button');
            button.className = 'sound-toggle';
            button.type = 'button';
            button.title = KG.i18n?.t('sound.toggle') ?? 'เปิด/ปิดเสียง';
            const paint = () => { button.textContent = muted ? '🔇' : '🔊'; };
            button.onclick = () => {
                KG.sound.unlock();
                KG.sound.setMuted(!muted);
                paint();
            };
            paint();
            document.body.appendChild(button);
            return button;
        }
    };
})();
