// ===============================
// GAME MODES
// ===============================
// ทุกโหมดใช้เอนจินเดิม ต่างกันที่กติกาให้คะแนนกับเงื่อนไขตกรอบ
// จอ host เอา label/desc/color ไปวาดการ์ดให้เลือกก่อนกด Start
import { STREAK_BONUS_MAX, STREAK_BONUS_STEP } from "./config.js";

export const MODES = {
    classic: {
        label: { th: "คลาสสิก", en: "Classic" },
        desc: {
            th: "ตอบเร็วได้คะแนนเยอะ ตอบถูกติดกันได้โบนัส",
            en: "Answer fast for more points, streaks give a bonus"
        },
        color: "#8b5cf6",
        icon: "🎯"
    },
    accuracy: {
        // ตัดความเร็วออกทั้งหมด คนคิดช้าแต่คิดถูกไม่เสียเปรียบ
        label: { th: "แม่นยำ", en: "Accuracy" },
        desc: {
            th: "ตอบถูกได้ 1000 เท่ากันหมด ไม่วัดความเร็ว",
            en: "Every correct answer is worth 1000 — speed does not matter"
        },
        color: "#0ea5e9",
        icon: "🎓",
        flatScore: 1000,
        noSpeed: true,
        noStreak: true
    },
    survival: {
        // ตอบผิดหรือไม่ทันตอบ = ตกรอบ เหลือคนสุดท้ายเมื่อไหร่จบเกมทันที
        label: { th: "ตกรอบ", en: "Survival" },
        desc: {
            th: "ตอบผิดหรือไม่ทันตอบ ตกรอบทันที เหลือคนสุดท้ายชนะ",
            en: "One wrong answer and you are out — last one standing wins"
        },
        color: "#ef4444",
        icon: "💀",
        eliminate: true,
        endWhenAlive: 1
    },
    blackhole: {
        // นักบินวิ่งหนีหลุมดำ ตอบถูกได้ระยะห่าง ตอบไม่ได้หลุมดำคืบเข้ามา ระยะหมดเมื่อไหร่โดนดูด
        label: { th: "หนีหลุมดำ", en: "Black Hole Run" },
        desc: {
            th: "ตอบถูกได้ระยะหนี ตอบผิดหลุมดำคืบเข้ามา ระยะหมดคือโดนดูด",
            en: "Correct answers buy distance, wrong ones let the black hole close in"
        },
        color: "#4c1d95",
        icon: "🕳️",
        blackhole: true,
        endWhenAlive: 0
    },
    blocks: {
        // เลือกคำตอบแล้วโดดลงแท่นนั้นบนจอ host ตอบผิด = แท่นแตกตกหลุม แต่เป็นแค่ภาพ ไม่มีใครตกรอบจริง
        // ทุกคนได้เล่นครบทุกข้อ ตัดสินกันที่คะแนนรวมเหมือนคลาสสิก (จึงไม่ใส่ eliminate/endWhenAlive)
        label: { th: "แท่นคำตอบ", en: "Block Jump" },
        desc: {
            th: "เลือกคำตอบแล้วโดดไปยืนบนแท่น ตอบผิดแท่นแตกตกหลุม เล่นครบทุกข้อ",
            en: "Jump onto the block you pick — guess wrong and it crumbles, but you play every question"
        },
        color: "#0d8020",
        icon: "🧱",
        blocks: true
    },
    rush: {
        // บีบเวลาทุกข้อให้เหลือ 5 วิ คะแนนเป็นความเร็วล้วน
        label: { th: "เร่งรีบ", en: "Rush" },
        desc: {
            th: "ทุกข้อเหลือ 5 วิ คะแนนขึ้นกับความเร็วล้วน",
            en: "Every question is 5 seconds — pure speed"
        },
        color: "#f59e0b",
        icon: "⚡",
        duration: 5000,
        noStreak: true
    }
};

export const DEFAULT_MODE = "classic";

export function modeOf(room) {
    return MODES[room.mode] || MODES[DEFAULT_MODE];
}

// ส่งให้จอ host ไปวาดการ์ดเลือกโหมด (ไม่ต้องก๊อป list ไปไว้ฝั่ง client)
export function modeCatalog() {
    return Object.entries(MODES).map(([id, mode]) => ({
        id,
        label: mode.label,
        desc: mode.desc,
        color: mode.color,
        icon: mode.icon
    }));
}

export function streakBonus(streak) {
    return Math.min(STREAK_BONUS_MAX, Math.max(0, streak - 1) * STREAK_BONUS_STEP);
}
