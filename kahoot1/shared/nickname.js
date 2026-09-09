// สุ่มชื่อเล่น: คำขยาย + คำนาม + เลขท้ายกันชนกัน
window.KG = window.KG || {};

KG.nickname = (() => {
    // ชื่อเล่นจำกัดไว้ 10 ตัวอักษร (ดู MAX_NICKNAME_LENGTH ใน server.js) งบตัวอักษรจึงเป็น
    // คำขยาย 4 + คำนาม 4 + เลข 2 = 10 พอดี ถ้าจะเพิ่มคำใหม่ต้องยาวไม่เกิน 4 ตัว ไม่งั้นชื่อจะโดนตัดท้าย
    const ADJECTIVES = [
        'Mega', 'Neon', 'Cool', 'Fast', 'Wild', 'Bold', 'Zap', 'Sly',
        'Icy', 'Fun', 'Big', 'Sky', 'Ace', 'Jet', 'Pro', 'Odd'
    ];
    const NOUNS = [
        'Fox', 'Owl', 'Cat', 'Bee', 'Yak', 'Ant', 'Elf', 'Ray', 'Cub', 'Pup',
        'Bat', 'Koi', 'Orca', 'Puma', 'Wolf', 'Duck', 'Crab', 'Frog', 'Bear', 'Lion'
    ];

    const pick = list => list[Math.floor(Math.random() * list.length)];

    return {
        random() {
            return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 90) + 10}`;
        }
    };
})();
