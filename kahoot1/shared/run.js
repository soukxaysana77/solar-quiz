// ฉากไล่ล่าของโหมด Black Hole Run — ใช้เฉพาะจอ host (จอใหญ่)
// ผู้เล่นทุกคนอยู่ในเวทีเดียวกัน หลุมดำอยู่ซ้ายสุด ยิ่งอยู่ขวายิ่งปลอดภัย
// ตำแหน่งแนวนอนมาจากระยะที่เซิร์ฟเวอร์คำนวณ ส่วนแนวตั้งเกลี่ยให้ไม่ทับกัน
window.KG = window.KG || {};

KG.run = (() => {
    const MIN_LEFT = 10;   // ชิดปากหลุมดำสุด
    const SPAN = 74;       // ระยะวิ่งได้จนถึงขอบขวา

    function arena() {
        const arena = document.createElement('div');
        arena.className = 'run-arena';

        const stars = document.createElement('div');
        stars.className = 'run-stars';

        const hole = document.createElement('div');
        hole.className = 'run-hole';

        const floor = document.createElement('div');
        floor.className = 'run-floor';

        arena.append(stars, hole, floor);
        return arena;
    }

    // delta > 0 = เพิ่งได้ระยะ (เร่งเครื่อง), delta < 0 = เพิ่งโดนดึง
    function pilot({ name, avatar, lead, maxLead, eliminated, delta = 0, size = 54, row = 0, rows = 1 }) {
        const safe = Math.max(0, Math.min(lead ?? 0, maxLead || 10));
        const node = document.createElement('div');
        node.className = 'run-pilot';
        if (eliminated) node.classList.add('is-gone');
        else if (safe <= 2) node.classList.add('is-danger');

        node.style.left = `${MIN_LEFT + (safe / (maxLead || 10)) * SPAN}%`;
        // เกลี่ยแนวตั้งให้กระจายทั่วเวที ไม่ทับกันเวลาระยะเท่ากัน
        node.style.top = `${((row + 1) / (rows + 1)) * 100}%`;

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
        const leadLine = document.createElement('div');
        leadLine.className = safe <= 2 ? 'run-lead run-danger' : 'run-lead';
        leadLine.textContent = eliminated ? KG.i18n.t('run.gone') : KG.i18n.t('run.distance', { lead: safe });
        label.append(nameLine, leadLine);

        body.append(jet, KG.avatar.el(avatar, size), label);
        node.appendChild(body);
        return node;
    }

    return { arena, pilot };
})();
