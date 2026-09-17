// popup ตัวอย่างโหมดบนจอ host: กดการ์ดโหมดที่มีฉากพิเศษแล้วเล่นฉากจริงวนให้ดู
// ใช้ตัววาดฉากตัวเดียวกับในเกม (KG.run / KG.blocks / KG.boss) กับผู้เล่นปลอม 4 คน
// ข้อความมีแค่ป้ายสั้น ๆ พร้อมไอคอน ไฮไลต์ข้อที่ตรงกับภาพตอนนั้น คนดูเข้าใจได้โดยไม่ต้องอ่านคำอธิบายยาว
window.KG = window.KG || {};

KG.modeDemo = (() => {
    const t = (key, vars) => KG.i18n.t(key, vars);
    const STEP_MS = 2600;
    const CAST = [
        { id: 'a', name: 'Mango', avatar: '#ffa53d' },
        { id: 'b', name: 'Kiwi', avatar: '#7ed957' },
        { id: 'c', name: 'Berry', avatar: '#c77dff' },
        { id: 'd', name: 'Plum', avatar: '#4da6ff' }
    ];

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    // ---- ฉากตัวอย่างของแต่ละโหมด (สร้างใหม่ทุกขั้น แอนิเมชัน CSS จะเริ่มเล่นใหม่เอง) ----
    const runScene = (state) => (stage) => {
        const arena = KG.run.arena();
        stage.replaceChildren(arena);
        const fit = KG.run.layout(CAST.length, arena.clientHeight || 220);
        CAST.forEach((player, row) => {
            const s = state[player.id];
            arena.appendChild(KG.run.pilot({
                name: player.name, avatar: player.avatar, lead: s.lead, maxLead: 10,
                eliminated: Boolean(s.gone), delta: s.delta || 0,
                size: fit.size, tight: fit.tight, showDistance: fit.showDistance, showName: fit.showName,
                row, rows: CAST.length
            }));
        });
    };

    const BLOCKS_CORRECT = 1;
    const blocksScene = (picks) => (stage) => {
        const arena = KG.blocks.arena(4);
        stage.replaceChildren(arena);
        if (!picks) {
            const sky = arena.querySelector('.blocks-sky');
            CAST.forEach((player) => sky.appendChild(KG.blocks.rider({ avatar: player.avatar, name: player.name, mode: 'waiting' })));
            return;
        }
        const platforms = arena.querySelectorAll('.block-platform');
        platforms.forEach((platform, i) => { if (i !== BLOCKS_CORRECT) platform.classList.add('is-broken'); });
        CAST.forEach((player) => {
            const pick = picks[player.id];
            platforms[pick].querySelector('.block-riders').appendChild(KG.blocks.rider({
                avatar: player.avatar, name: player.name, mode: pick === BLOCKS_CORRECT ? 'safe' : 'fallen'
            }));
        });
    };

    // attackers = undefined คือช่วงถาม (ยังไม่เฉลย)
    const bossScene = (boss, attackers) => (stage) => {
        stage.replaceChildren(KG.boss.arena({
            boss: { maxHp: 12, maxHearts: 3, hearts: 3, lastDamage: 0, counter: false, result: null, ...boss },
            players: CAST,
            attackers: new Set(attackers || []),
            revealed: attackers !== undefined
        }));
    };

    // ฉากต่อตึกเป็น 3D ต่างจากฉากอื่นที่เป็น DOM ล้วน: ต้องโหลด three.js ก่อน (async) และคืน WebGL context ตอนปิด popup
    // จึงมี mount ของตัวเอง แต่ละขั้นแค่ส่งสถานะให้ฉากวาด (ฉากยังโหลดไม่เสร็จ scene เป็น null ก็ข้ามไป)
    // ข้อ 3 ของตัวอย่างคำตอบถูกคือตัวเลือก 0 · picks 1 = ตอบผิด
    const towerStep = (questionIndex, gainsById, picks = {}) => (stage, scene) => {
        scene?.show({
            players: CAST.map((player) => ({
                ...player,
                gains: gainsById[player.id],
                score: gainsById[player.id].reduce((sum, gain) => sum + gain, 0),
                answerIndex: picks[player.id] ?? 0
            })),
            questionIndex,
            reveal: true,
            correctIndexes: [0]
        });
    };

    const DEMOS = {
        blackhole: {
            captions: [['✅', 'demo.holeCorrect'], ['❌', 'demo.holeWrong'], ['🕳️', 'demo.holeGone']],
            steps: [
                { caption: 0, render: runScene({ a: { lead: 5 }, b: { lead: 5 }, c: { lead: 5 }, d: { lead: 5 } }) },
                { caption: 0, render: runScene({ a: { lead: 7, delta: 2 }, b: { lead: 6, delta: 1 }, c: { lead: 5 }, d: { lead: 5 } }) },
                { caption: 1, render: runScene({ a: { lead: 7 }, b: { lead: 6 }, c: { lead: 3, delta: -2 }, d: { lead: 2, delta: -3 } }) },
                { caption: 2, render: runScene({ a: { lead: 8, delta: 1 }, b: { lead: 7, delta: 1 }, c: { lead: 2, delta: -1 }, d: { lead: 0, gone: true } }) }
            ]
        },
        blocks: {
            captions: [['🧍', 'demo.blocksJump'], ['💥', 'demo.blocksBreak'], ['🔁', 'demo.blocksAgain']],
            steps: [
                { caption: 0, render: blocksScene(null) },
                { caption: 1, render: blocksScene({ a: 1, b: 1, c: 0, d: 3 }) },
                { caption: 2, render: blocksScene(null) }
            ]
        },
        boss: {
            captions: [['✅', 'demo.bossHit'], ['⚡', 'demo.bossFast'], ['💔', 'demo.bossCounter'], ['🏆', 'demo.bossTeam']],
            steps: [
                { caption: 0, render: bossScene({ hp: 12 }) },
                { caption: 0, render: bossScene({ hp: 9, lastDamage: 3 }, ['a', 'b', 'c']) },
                { caption: 1, render: bossScene({ hp: 5, lastDamage: 4 }, ['a', 'b']) },
                { caption: 2, render: bossScene({ hp: 4, lastDamage: 1, counter: true, hearts: 2 }, ['a']) },
                { caption: 3, render: bossScene({ hp: 0, lastDamage: 4, hearts: 2, result: 'win' }, ['a', 'b', 'c', 'd']) }
            ]
        },
        tower: {
            captions: [['✅', 'demo.towerCorrect'], ['⚡', 'demo.towerFast'], ['❌', 'demo.towerWrong'], ['🏆', 'demo.towerTop']],
            mount: async (stage) => {
                const { createTowerScene } = await import('/shared/tower3d.js');
                const scene = createTowerScene(stage);
                scene.setActive(true);
                return scene;
            },
            fallbackIcon: '🏗️',
            steps: [
                { caption: 0, render: towerStep(0, { a: [800], b: [600], c: [700], d: [500] }) },
                { caption: 1, render: towerStep(1, { a: [800, 1000], b: [600, 950], c: [700, 300], d: [500, 400] }) },
                { caption: 2, render: towerStep(2, { a: [800, 1000, 900], b: [600, 950, 0], c: [700, 300, 0], d: [500, 400, 850] }, { b: 1, c: 1 }) },
                { caption: 3, render: towerStep(3, { a: [800, 1000, 900, 1000], b: [600, 950, 0, 700], c: [700, 300, 0, 600], d: [500, 400, 850, 300] }) }
            ]
        }
    };

    let current = null;

    function close() {
        if (!current) return;
        clearInterval(current.timer);
        current.cleanup?.();
        document.removeEventListener('keydown', current.onKey);
        current.node.remove();
        current = null;
    }

    function open(id, { title, icon, color }) {
        const demo = DEMOS[id];
        if (!demo) return;
        close();

        const node = make('div', 'mode-demo');
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        const card = make('div', 'mode-demo-card');
        card.style.setProperty('--mode-color', color);

        const head = make('div', 'mode-demo-head');
        const closeBtn = make('button', 'mode-demo-close', '✕');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', t('demo.close'));
        head.append(make('span', 'mode-demo-icon', icon), make('h3', 'mode-demo-title', title), closeBtn);

        const stage = make('div', 'mode-demo-stage');
        const list = make('ol', 'mode-demo-steps');
        const ok = make('button', 'mode-demo-ok');
        ok.type = 'button';

        card.append(head, stage, list, ok);
        node.appendChild(card);
        // ต้องใส่ลงหน้าก่อนวาดฉาก ฉากหลุมดำวัดความสูงจริงของเวทีเพื่อจัดระยะผู้เล่น
        document.body.appendChild(node);

        let step = 0;
        // ฉาก 3D (ต่อตึก) โหลดแบบ async ระหว่างรอ scene เป็น null พอพร้อมแล้ววาดขั้นปัจจุบันใหม่
        let scene = null;
        let closed = false;
        const paint = () => {
            const current = demo.steps[step];
            current.render(stage, scene);
            list.replaceChildren(...demo.captions.map(([emoji, key], i) => {
                const item = make('li', i === current.caption ? 'is-active' : '');
                item.append(make('span', 'mode-demo-emoji', emoji), make('span', '', t(key)));
                return item;
            }));
            ok.textContent = t('demo.ok');
        };
        paint();

        if (demo.mount) {
            demo.mount(stage)
                .then((created) => {
                    // ปิด popup ไปก่อนโหลดเสร็จ: ทิ้งฉากทันที ไม่ปล่อย WebGL context ค้าง
                    if (closed) { created.dispose(); return; }
                    scene = created;
                    paint();
                })
                .catch((error) => {
                    console.error('โหลดฉากตัวอย่างไม่สำเร็จ:', error);
                    if (!closed) stage.replaceChildren(make('div', 'mode-demo-fallback', demo.fallbackIcon || '🎬'));
                });
        }

        const timer = setInterval(() => {
            step = (step + 1) % demo.steps.length;
            paint();
        }, STEP_MS);
        const onKey = (event) => { if (event.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        node.addEventListener('click', (event) => { if (event.target === node) close(); });
        closeBtn.onclick = close;
        ok.onclick = close;

        const cleanup = () => {
            closed = true;
            scene?.dispose();
            scene = null;
        };
        current = { node, timer, onKey, cleanup };
        ok.focus();
    }

    return { open, close, has: (id) => Boolean(DEMOS[id]) };
})();
