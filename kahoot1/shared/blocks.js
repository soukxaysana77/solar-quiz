// ฉากแท่นคำตอบของโหมด Block Jump — ใช้เฉพาะจอ host (จอใหญ่)
// ผู้เล่นเลือกคำตอบแล้วอวตารโดดไปยืนบนแท่นของคำตอบนั้น ตอบผิด = แท่นแตก ตกรอบทันที
// (เอนจินตกรอบใช้ mode.eliminate เดียวกับ survival — ไฟล์นี้มีหน้าที่แค่วาดภาพ ไม่ตัดสินผลอะไรเอง)
window.KG = window.KG || {};

KG.blocks = (() => {
    // เวที: แถวแท่นตามจำนวนตัวเลือกของข้อนั้น (สีเรียงลำดับเดียวกับปุ่มตอบที่ผู้เล่นเห็นบนมือถือ
    // ผ่าน CSS nth-child ใน shared.css ไม่ต้องส่งสีมาจาก JS)
    // .blocks-sky ไว้ให้อวตารคนที่ยังไม่ตกรอบ "ลอยรอ" อยู่ด้านบนระหว่างยังไม่เฉลย
    function arena(optionCount) {
        const box = document.createElement('div');
        box.className = 'blocks-arena';

        const sky = document.createElement('div');
        sky.className = 'blocks-sky';

        const row = document.createElement('div');
        row.className = 'blocks-row';
        for (let i = 0; i < optionCount; i++) {
            // ทุกช่องมี "ปากหลุม" ซ่อนอยู่ใต้แท่นเสมอ พอแท่นผิดแตกร่วงไปจะเห็นหลุมแทนที่
            // เวทีเลยไม่แหว่งเวลาแท่นหายไปหลายอัน และยังอ่านออกว่าเดิมมีกี่ตัวเลือก
            const slot = document.createElement('div');
            slot.className = 'block-slot';

            const pit = document.createElement('div');
            pit.className = 'block-pit';

            const platform = document.createElement('div');
            platform.className = 'block-platform';
            platform.dataset.index = String(i);
            const riders = document.createElement('div');
            riders.className = 'block-riders';
            platform.appendChild(riders);

            slot.append(pit, platform);
            row.appendChild(slot);
        }

        box.append(sky, row);
        return box;
    }

    // mode: 'waiting' (ลอยรออยู่บนฟ้า ยังไม่เฉลย) / 'safe' (ตอบถูก ยืนรอด) / 'fallen' (ตอบผิด กำลังร่วงพร้อมแท่น)
    // ผู้เรียก (host.js) เป็นคนตัดสินว่าจะเอาไปแปะที่ .blocks-sky หรือ .block-riders ของแท่นไหน
    function rider({ avatar, name, mode = 'waiting', size = 36 }) {
        const node = document.createElement('div');
        node.className = `block-rider is-${mode}`;
        node.append(KG.avatar.el(avatar, size));
        const label = document.createElement('div');
        label.className = 'block-name';
        label.textContent = name;
        node.appendChild(label);
        return node;
    }

    // แท่นหนึ่งวางคนเรียงกันได้จำกัด คนที่เกินจากนั้นยุบเหลือป้าย "+N" ใบเดียว
    // (ใช้คลาส block-rider ร่วมด้วย ป้ายจะได้ร่วงตามแท่นเวลาแท่นแตกเหมือนคนอื่น)
    function more(count, mode = 'safe') {
        const node = document.createElement('div');
        node.className = `block-rider block-more is-${mode}`;
        node.textContent = `+${count}`;
        return node;
    }

    return { arena, rider, more };
})();
