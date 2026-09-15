// ฉากไล่ล่าของโหมด Black Hole Run — ใช้เฉพาะจอ host (จอใหญ่)
// ผู้เล่นทุกคนอยู่ในเวทีเดียวกัน หลุมดำอยู่ซ้ายสุด ยิ่งอยู่ขวายิ่งปลอดภัย
// ตำแหน่งแนวนอนมาจากระยะที่เซิร์ฟเวอร์คำนวณ ส่วนแนวตั้งเกลี่ยให้ไม่ทับกัน
window.KG = window.KG || {};

KG.run = (() => {
    const MIN_LEFT = 10;   // ชิดปากหลุมดำสุด
    const SPAN = 74;       // ระยะวิ่งได้จนถึงขอบขวา
    const SHIP_ID = 'run-ship';

    // ยานลำเดียวใช้ร่วมกันทุกคน (ตกลงกันว่าไม่ย้อมสีรายคน) จึงนิยามรูปทรงครั้งเดียวเป็น <symbol>
    // แล้วให้ผู้เล่นทุกคนอ้างด้วย <use> — 50 คนเหลือ 2 element ต่อลำ แทนที่จะก๊อป SVG เต็ม ๆ 50 ชุด
    // สำคัญเพราะ host วาดเวทีใหม่ทั้งหมดทุกครั้งที่ขึ้นคำถามและตอนเฉลย
    //
    // ต้นฉบับวาดหันซ้าย แต่ในเกมหลุมดำอยู่ซ้ายและผู้เล่นหนีไปขวา
    // จึงพลิกด้วย transform ครอบทั้งชุด ไม่แก้พิกัดใน path เพื่อให้รูปทรงตรงกับที่ออกแบบมาเป๊ะ
    //
    // ตัดของที่มองไม่เห็นตอนย่อเหลือ 54px ออกแล้ว: เส้นแบ่งแผง บันได ถังเชื้อเพลิง ช่องกลม ไล่เฉดสี
    function shipDefs() {
        const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        holder.setAttribute('class', 'run-ship-defs');
        holder.setAttribute('aria-hidden', 'true');
        holder.innerHTML = `
            <symbol id="${SHIP_ID}" viewBox="0 0 410 300">
                <clipPath id="${SHIP_ID}-clip">
                    <path d="M 20 160 C 32 136 74 121 130 115 L 296 103 C 328 100 350 110 353 128
                             L 355 174 C 354 190 338 197 314 197 L 122 193 C 66 191 30 178 20 160 Z"/>
                </clipPath>
                <g transform="translate(410,0) scale(-1,1)">
                    <path d="M 282 116 L 350 26 L 392 26 L 368 116 Z"
                          fill="var(--ship-navy)" stroke="var(--ship-navy)" stroke-width="5" stroke-linejoin="round"/>
                    <path d="M 320 96 L 353 42 L 371 42 L 346 96 Z" fill="var(--ship-red)"/>
                    <path d="M 246 186 L 318 252 L 366 252 L 300 186 Z"
                          fill="var(--ship-navy-deep)" stroke="var(--ship-navy-deep)" stroke-width="5" stroke-linejoin="round"/>
                    <g fill="var(--ship-nozzle)" stroke="var(--ship-navy)" stroke-width="4">
                        <rect x="344" y="104" width="48" height="28" rx="13"/>
                        <rect x="344" y="136" width="48" height="28" rx="13"/>
                        <rect x="344" y="168" width="48" height="28" rx="13"/>
                    </g>
                    <path d="M 20 160 C 32 136 74 121 130 115 L 296 103 C 328 100 350 110 353 128
                             L 355 174 C 354 190 338 197 314 197 L 122 193 C 66 191 30 178 20 160 Z"
                          fill="var(--ship-shell)"/>
                    <g clip-path="url(#${SHIP_ID}-clip)">
                        <path d="M 0 168 L 60 176 L 208 182 L 208 215 L 0 215 Z" fill="var(--ship-red)"/>
                        <path d="M 0 88 L 52 88 L 66 215 L 0 215 Z" fill="var(--ship-navy)"/>
                        <path d="M 322 88 L 400 88 L 400 215 L 336 215 Z" fill="var(--ship-navy)"/>
                        <g transform="rotate(-7.4 84 140)">
                            <rect x="84" y="131" width="93" height="27" rx="6" fill="var(--ship-navy)"/>
                            <rect x="92" y="137" width="77" height="15" rx="4" fill="var(--ship-glass)"/>
                        </g>
                    </g>
                    <path d="M 20 160 C 32 136 74 121 130 115 L 296 103 C 328 100 350 110 353 128
                             L 355 174 C 354 190 338 197 314 197 L 122 193 C 66 191 30 178 20 160 Z"
                          fill="none" stroke="var(--ship-navy)" stroke-width="5" stroke-linejoin="round"/>
                </g>
            </symbol>`;
        return holder;
    }

    function arena() {
        const arena = document.createElement('div');
        arena.className = 'run-arena';

        const stars = document.createElement('div');
        stars.className = 'run-stars';

        const hole = document.createElement('div');
        hole.className = 'run-hole';

        const floor = document.createElement('div');
        floor.className = 'run-floor';

        arena.append(shipDefs(), stars, hole, floor);
        return arena;
    }

    // ยานสัดส่วน 410:300 ไม่ใช่สี่เหลี่ยมจัตุรัสเหมือนนักบินอวกาศ
    // ยึดความสูงเท่าเดิมแล้วให้ความกว้างยืดตามสัดส่วน ระยะห่างแนวตั้งของผู้เล่นจะได้ไม่เปลี่ยน
    function ship(height) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'run-ship');
        svg.setAttribute('viewBox', '0 0 410 300');
        svg.setAttribute('width', String(Math.round(height * (410 / 300))));
        svg.setAttribute('height', String(height));
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#${SHIP_ID}`);
        svg.appendChild(use);
        return svg;
    }

    // delta > 0 = เพิ่งได้ระยะ (เร่งเครื่อง), delta < 0 = เพิ่งโดนดึง
    // แต่ละคนมีที่ในแนวตั้งเท่ากับ ความสูงเวที / (จำนวนคน + 1)
    // ถ้าปล่อยขนาดตายตัว 54px พอคนเยอะระยะห่างจะเหลือไม่กี่ px แล้วยานกับป้ายชื่อทับกันมั่ว
    // จึงย่อยานลงตามที่ว่าง และลดขนาด/ตัดบรรทัดของป้ายชื่อเป็นขั้น ๆ เมื่อที่ไม่พอจริง ๆ
    // ค่าที่วัดจากของจริงบนหน้าเว็บ ไม่ใช่ค่าที่เดา
    // ยานสูงเท่า size และนักบินโผล่พ้นขอบบนอีกราว 15% ของ size
    const CRAFT_RATIO = 1.15;      // ยาน + หัวนักบินที่โผล่พ้นขอบบน
    const PAD = 6;                 // ระยะหายใจระหว่างแถว
    const MIN_SHIP = 14;

    // ป้ายชื่อถูกวางไว้ "ข้างยาน" ไม่ใช่ใต้ยาน ความสูงที่ต้องใช้ต่อคนจึงเป็นค่าที่มากกว่า
    // ระหว่างความสูงยานกับความสูงป้าย ไม่ใช่เอามาบวกกัน
    // ถ้าวางใต้ยาน พอถึง 15 คน (ที่ว่าง 31px ต่อคน) ป้ายจะกินที่จนยานเหลือ 14px แทบมองไม่เห็น
    const LABEL_FULL = 49;         // ชื่อ + ระยะ ขนาดปกติ
    const LABEL_TIGHT = 32;        // ชื่อ + ระยะ แบบย่อ
    const LABEL_NAME_ONLY = 14;    // เหลือแต่ชื่อแบบย่อ

    function layout(count, arenaHeight) {
        const rowGap = arenaHeight / Math.max(count, 1);

        // ไล่จากแบบที่อ่านง่ายที่สุดลงมา เลือกอันแรกที่ป้ายยังไม่สูงเกินที่ว่างต่อคน
        let plan;
        if (rowGap >= LABEL_FULL + PAD) plan = { tight: false, showDistance: true, showName: true };
        else if (rowGap >= LABEL_TIGHT + PAD) plan = { tight: true, showDistance: true, showName: true };
        else if (rowGap >= LABEL_NAME_ONLY + PAD) plan = { tight: true, showDistance: false, showName: true };
        else plan = { tight: true, showDistance: false, showName: false };

        const size = Math.max(MIN_SHIP, Math.min(54, Math.round((rowGap - PAD) / CRAFT_RATIO)));
        return { size, ...plan };
    }

    function pilot({ name, avatar, lead, maxLead, eliminated, delta = 0, size = 54,
                     tight = false, showDistance = true, showName = true, row = 0, rows = 1 }) {
        const safe = Math.max(0, Math.min(lead ?? 0, maxLead || 10));
        const node = document.createElement('div');
        node.className = 'run-pilot';
        if (eliminated) node.classList.add('is-gone');
        else if (safe <= 2) node.classList.add('is-danger');
        if (tight) node.classList.add('is-tight');

        node.style.left = `${MIN_LEFT + (safe / (maxLead || 10)) * SPAN}%`;
        // เกลี่ยแนวตั้งให้กระจายทั่วเวที ไม่ทับกันเวลาระยะเท่ากัน
        // ใช้ (row + 0.5) / rows แทน (row + 1) / (rows + 1) เพราะแบบเดิมเหลือขอบบนล่างว่างไป
        // หนึ่งช่วงเต็ม ๆ ทั้งที่เอามาแบ่งให้ทุกคนได้ แบบใหม่ได้ที่ต่อคนเพิ่มอีกราว 20%
        node.style.top = `${((row + 0.5) / Math.max(rows, 1)) * 100}%`;

        const body = document.createElement('div');
        body.className = 'run-body';
        if (!eliminated && delta > 0) body.classList.add('is-boost');
        if (!eliminated && delta < 0) body.classList.add('is-pulled');

        const jet = document.createElement('div');
        jet.className = 'run-jet';

        const label = document.createElement('div');
        label.className = 'run-label';
        const nameLine = document.createElement('div');
        nameLine.className = 'run-name';
        nameLine.textContent = name;
        if (showName) label.appendChild(nameLine);
        // คนเยอะจนที่ไม่พอ ตัดบรรทัดระยะทิ้ง เหลือชื่อไว้ให้รู้ว่าใครเป็นใคร
        // ยกเว้นคนที่โดนดูดไปแล้ว ต้องบอกเสมอเพราะเป็นข้อมูลสำคัญกว่าระยะ
        if (showDistance || (eliminated && showName)) {
            const leadLine = document.createElement('div');
            leadLine.className = safe <= 2 ? 'run-lead run-danger' : 'run-lead';
            leadLine.textContent = eliminated ? KG.i18n.t('run.gone') : KG.i18n.t('run.distance', { lead: safe });
            label.appendChild(leadLine);
        }

        // นักบินอยู่ layer หลัง ยานบังอยู่ข้างหน้า — เห็นสีประจำตัวโผล่พ้นยานขึ้นมา
        // ห่อไว้ในกล่องของตัวเอง จะได้ไม่ไปเปลี่ยนจุดอ้างอิงของ .run-jet ที่เกาะ .run-pilot อยู่
        const craft = document.createElement('div');
        craft.className = 'run-craft';
        const rider = KG.avatar.el(avatar, Math.round(size * 0.62));
        rider.classList.add('run-rider');
        craft.append(rider, ship(size), label);

        body.append(jet, craft);
        node.appendChild(body);
        return node;
    }

    return { arena, pilot, layout };
})();
