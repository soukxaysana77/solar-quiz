// ฉากโหมดบอสรวมพลัง — ใช้เฉพาะจอ host (จอใหญ่)
// องค์ประกอบแบบฉากบอสปราสาท: บอสยักษ์เต็มฉากด้านหลัง ผู้เล่นตัวเล็กยืนบนสะพานด้านล่าง
// วาดอย่างเดียว ไม่ตัดสินอะไร เลือด/หัวใจ/ผลแพ้ชนะเซิร์ฟเวอร์คิดมาให้แล้วใน room.boss
window.KG = window.KG || {};

KG.boss = (() => {
    // บอสออกแบบเอง (ไม่ใช่ตัวละครของเกมอื่น): มังกรหนามโกรธ มีกระดอง ลำตัว แขนและกรงเล็บ
    // มือแต่ละข้างเป็น <g class="boss-hand"> แยกไว้ให้ CSS ขยับได้ ข้างขวาวาดจากรูปเดียวกันแล้วกลับด้าน
    // ส่วนหัวคือรูปหน้าเดิม (พิกัด 240×200) ย่อแล้ววางบนไหล่ ส่วนล่างของตัวเลยขอบเวทีไปเพื่อให้ดูเหมือนยืนในหลุม
    const HAND = `
        <path d="M-34 10 C-40 -18 -20 -36 0 -34 C24 -32 38 -14 34 12 C30 34 12 44 -6 42 C-26 40 -30 26 -34 10 Z"
              fill="url(#boss-skin)" stroke="#000" stroke-width="4"/>
        <path d="M-26 -22 L-40 -54 L-12 -32 Z M-4 -32 L-6 -70 L12 -34 Z M18 -28 L36 -60 L30 -18 Z"
              fill="#f3e6c4" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
        <path d="M-18 14 Q-4 22 12 14" fill="none" stroke="#1f4d14" stroke-width="3" stroke-linecap="round"/>`;

    const BOSS = `
        <svg viewBox="0 0 400 320" preserveAspectRatio="xMidYMin meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <radialGradient id="boss-skin" cx="50%" cy="42%" r="62%">
                    <stop offset="0" stop-color="#9be36d"/><stop offset="1" stop-color="#2f7a24"/>
                </radialGradient>
                <radialGradient id="boss-snout" cx="50%" cy="35%" r="65%">
                    <stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#d99a2b"/>
                </radialGradient>
                <radialGradient id="boss-iris" cx="50%" cy="50%" r="50%">
                    <stop offset="0" stop-color="#ff7a52"/><stop offset=".55" stop-color="#c0001d"/><stop offset="1" stop-color="#3d0007"/>
                </radialGradient>
            </defs>

            <!-- กระดองหนามด้านหลัง -->
            <path d="M20 320 C20 200 100 150 200 150 C300 150 380 200 380 320 Z" fill="#2f5e1c" stroke="#000" stroke-width="4"/>
            <path d="M58 214 L42 176 L82 198 Z M108 174 L100 132 L138 162 Z M292 174 L300 132 L262 162 Z M342 214 L358 176 L318 198 Z"
                  fill="#f3e6c4" stroke="#000" stroke-width="3" stroke-linejoin="round"/>

            <!-- ลำตัว + ท้องเป็นปล้อง -->
            <ellipse cx="200" cy="265" rx="120" ry="90" fill="url(#boss-skin)" stroke="#000" stroke-width="4"/>
            <ellipse cx="200" cy="282" rx="72" ry="66" fill="url(#boss-snout)" stroke="#000" stroke-width="3"/>
            <path d="M136 262 H264 M134 290 H266 M146 318 H254" stroke="#b07a1e" stroke-width="3" stroke-linecap="round"/>

            <!-- แขน -->
            <path d="M152 198 C110 186 80 202 60 220 L80 246 C98 232 122 226 158 238 Z" fill="url(#boss-skin)" stroke="#000" stroke-width="4" stroke-linejoin="round"/>
            <path d="M248 198 C290 186 320 202 340 220 L320 246 C302 232 278 226 242 238 Z" fill="url(#boss-skin)" stroke="#000" stroke-width="4" stroke-linejoin="round"/>

            <!-- มือ -->
            <g class="boss-hand is-left"><g transform="translate(60 214)">${HAND}</g></g>
            <g class="boss-hand is-right"><g transform="translate(340 214) scale(-1 1)">${HAND}</g></g>

            <!-- หัว -->
            <g transform="translate(110 4) scale(0.75)">
                <path d="M40 112 L16 94 L44 88 L26 60 L58 72 L54 36 L84 58 L96 24 L112 54 L120 16 L128 54 L144 24 L156 58 L186 36 L182 72 L214 60 L196 88 L224 94 L200 112 Z"
                      fill="#b3141b" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
                <path d="M60 74 C32 46 22 22 28 6 C46 24 66 40 86 58 Z M180 74 C208 46 218 22 212 6 C194 24 174 40 154 58 Z"
                      fill="#f3e6c4" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
                <path d="M52 102 C52 60 84 42 120 42 C156 42 188 60 188 102 L186 142 C180 178 152 196 120 196 C88 196 60 178 54 142 Z"
                      fill="url(#boss-skin)" stroke="#000" stroke-width="4"/>
                <path d="M58 86 L112 104 L108 114 L56 100 Z M182 86 L128 104 L132 114 L184 100 Z" fill="#6b1414" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
                <path d="M68 106 Q90 97 108 117 Q90 130 70 120 Z M172 106 Q150 97 132 117 Q150 130 170 120 Z" fill="#fff" stroke="#000" stroke-width="3"/>
                <circle class="boss-eye" cx="93" cy="115" r="7.5" fill="url(#boss-iris)"/>
                <circle class="boss-eye" cx="147" cy="115" r="7.5" fill="url(#boss-iris)"/>
                <path d="M80 138 C80 120 100 113 120 113 C140 113 160 120 160 138 C160 160 142 170 120 170 C98 170 80 160 80 138 Z"
                      fill="url(#boss-snout)" stroke="#000" stroke-width="3"/>
                <ellipse cx="108" cy="132" rx="4.5" ry="3"/>
                <ellipse cx="132" cy="132" rx="4.5" ry="3"/>
                <path d="M90 154 Q120 174 150 154 Q142 188 120 188 Q98 188 90 154 Z" fill="#3b0a0a" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
                <path d="M100 158 L106 175 L113 162 Z M127 162 L134 175 L140 158 Z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
            </g>
        </svg>`;

    // คนเยอะเกินจะวาดไม่ไหว วาดเท่านี้แล้วที่เหลือเป็นป้าย +N
    const MAX_FIGHTERS = 30;
    const EMBERS = 14;

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    // revealed = ช่วงเฉลย: เล่นแอนิเมชันตีบอส/บอสสวนกลับของข้อที่เพิ่งจบ
    // attackers = id ของคนที่ตอบถูกข้อนี้ (กระโดดตีบอส)
    function arena({ boss, players, attackers = new Set(), revealed = false }) {
        const box = make('div', 'boss-arena');

        // ---- ฉากหลัง: เสาอิฐสองข้าง + ประกายไฟลอยขึ้น ----
        box.append(make('div', 'boss-pillar is-left'), make('div', 'boss-pillar is-right'));
        const embers = make('div', 'boss-embers');
        for (let i = 0; i < EMBERS; i++) {
            const ember = make('span', 'boss-ember');
            // ตำแหน่ง/จังหวะกระจายแบบคงที่ตาม i ฉากจะไม่กระตุกเปลี่ยนทุกครั้งที่วาดใหม่
            ember.style.left = `${(i * 53) % 100}%`;
            ember.style.animationDelay = `${-(i * 0.37) % 4}s`;
            ember.style.animationDuration = `${3 + (i % 4) * 0.6}s`;
            embers.appendChild(ember);
        }

        // ---- บอสยักษ์ ----
        const face = make('div', 'boss-face');
        face.innerHTML = BOSS;
        if (revealed && boss.result === 'win') face.classList.add('is-defeated');
        else if (revealed && boss.lastDamage > 0 && boss.counter) face.classList.add('is-hit', 'then-counter');
        else if (revealed && boss.lastDamage > 0) face.classList.add('is-hit');
        else if (revealed && boss.counter) face.classList.add('is-counter');
        box.append(embers, face);
        if (revealed && boss.lastDamage > 0) box.appendChild(make('div', 'boss-damage', `-${boss.lastDamage}`));

        // ---- HUD: หัวใจทีมมุมซ้าย เลือดบอสมุมขวา ----
        const hud = make('div', 'boss-hud');
        const hearts = make('div', 'boss-hearts');
        const lostNow = revealed && boss.counter;
        for (let i = 0; i < boss.maxHearts; i++) {
            const breaking = lostNow && i === boss.hearts;
            const heart = make('span', 'boss-heart', i < boss.hearts || breaking ? '❤️' : '🖤');
            if (breaking) heart.classList.add('is-breaking');
            hearts.appendChild(heart);
        }

        const hp = make('div', 'boss-hp');
        hp.appendChild(make('div', 'boss-hp-label', `HP ${boss.hp}/${boss.maxHp}`));
        const track = make('div', 'boss-hp-track');
        const fill = make('div', 'boss-hp-fill');
        const percent = (value) => `${Math.max(0, Math.min(100, (value / boss.maxHp) * 100))}%`;
        // หลอดเลือดลดจากค่าก่อนโดนตีไปค่าใหม่ ตอนเฉลยคนดูจะเห็นว่าข้อนี้ตีไปเท่าไหร่
        fill.style.setProperty('--from', percent(revealed ? boss.hp + boss.lastDamage : boss.hp));
        fill.style.setProperty('--to', percent(boss.hp));
        track.appendChild(fill);
        hp.appendChild(track);
        hud.append(hearts, hp);

        // ---- สะพาน + ผู้เล่นยืนอยู่บนสะพาน ----
        const bridge = make('div', 'boss-bridge');
        const team = make('div', 'boss-team');
        players.slice(0, MAX_FIGHTERS).forEach((player) => {
            const fighter = make('div', 'boss-fighter');
            if (revealed) fighter.classList.add(attackers.has(player.id) ? 'is-attacking' : 'is-idle');
            fighter.append(make('div', 'boss-name', player.name), KG.avatar.el(player.avatar, 40));
            team.appendChild(fighter);
        });
        if (players.length > MAX_FIGHTERS) team.appendChild(make('div', 'boss-more', `+${players.length - MAX_FIGHTERS}`));

        box.append(hud, team, bridge);
        return box;
    }

    return { arena };
})();
