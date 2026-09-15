// ===============================
// ROOMS (in-memory, server-authoritative)
// ===============================
// ห้องทั้งหมดอยู่ในหน่วยความจำ เซิร์ฟเวอร์เป็นคนตัดสินคะแนน/เวลา/ลำดับคำถาม
// รวมฟังก์ชันส่งข้อความเข้าห้องไว้ที่นี่ด้วย เพราะทุกตัวทำงานบนโครงสร้าง room เดียวกัน
import { BLACKHOLE_MAX_LEAD, DEFAULT_TIME_LIMIT } from "./config.js";
import { externalizeMedia, persist, selectQuiz, updateProgress, updateSlides } from "./db.js";
import { DEFAULT_MODE } from "./modes.js";

export const rooms = new Map();

// ค่า "คะแนน" ในหน้า Make แปลงเป็นตัวคูณ ชุดคำถามเก่าที่ไม่มีค่านี้ถือเป็นคะแนนปกติ
const POINT_MULTIPLIERS = { "Double points": 2, "No points": 0 };

// แปลงสไลด์จากหน้า Make ให้เป็นรูปแบบที่เกมใช้จริง
// ตัวเลือกที่เว้นว่างถูกตัดทิ้ง แต่ยังพก index เดิมไว้เพื่อเทียบกับ correctIndex ที่บันทึกไว้
function normalizeSlide(slide, index) {
    // คำถามถูก/ผิด ส่งคีย์คำแปลไปด้วย ผู้เล่นแต่ละเครื่องจะเห็น "จริง/เท็จ" หรือ "True/False" ตามภาษาของตัวเอง
    // text ยังเก็บคำที่ครูบันทึกไว้ เผื่อหน้าเว็บที่ไม่รู้จักคีย์นี้
    const labelKeys = slide.type === "True/False" ? ["make.true", "make.false"] : [];
    const options = (slide.answers || [])
        .map((text, i) => ({
            index: i,
            text: String(text ?? "").trim(),
            ...(labelKeys[i] ? { labelKey: labelKeys[i] } : {})
        }))
        .filter(option => option.text !== "");
    const seconds = parseInt(String(slide.timeLimit ?? DEFAULT_TIME_LIMIT), 10);

    // "หลายคำตอบถูก" เก็บเป็น correctIndexes ตอบข้อไหนในนี้ก็ได้คะแนน
    // ตัดข้อที่ถูกเว้นว่างทิ้ง ถ้าไม่เหลือสักข้อให้กลับไปใช้ correctIndex เดิม (พฤติกรรมก่อนมีตัวเลือกนี้)
    const available = new Set(options.map(option => option.index));
    const picked = slide.answerOptions === "Multi-select" && Array.isArray(slide.correctIndexes)
        ? slide.correctIndexes
        : [slide.correctIndex];
    const valid = [...new Set(picked.map(Number))].filter(i => available.has(i));
    const correctIndexes = valid.length ? valid : [Number(slide.correctIndex) || 0];

    return {
        question: String(slide.question || "").trim() || `Question ${index + 1}`,
        options,
        correctIndex: correctIndexes[0],
        correctIndexes,
        points: POINT_MULTIPLIERS[slide.points] ?? 1,
        mediaUrl: slide.mediaUrl || null,
        duration: (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TIME_LIMIT) * 1000
    };
}

export function loadRoom(pin) {
    const existing = rooms.get(pin);
    if (existing) return existing;

    const quiz = selectQuiz.get(pin);
    if (!quiz) return null;

    let slides;
    try {
        const raw = JSON.parse(quiz.slides_json);
        // ชุดคำถามที่บันทึกไว้ก่อนมีระบบไฟล์รูป ยังฝัง data URL อยู่ แปลงทิ้งไว้ครั้งเดียวตอนเปิดห้อง
        if (externalizeMedia(raw)) persist(updateSlides, JSON.stringify(raw), pin);
        slides = raw.map(normalizeSlide);
    } catch {
        return null;
    }
    if (!slides.length) return null;

    const room = {
        pin,
        title: quiz.title,
        slides,
        phase: "lobby",
        questionIndex: 0,
        questionStartedAt: 0,
        questionTimer: null,
        leaderboardUntil: 0,
        mode: DEFAULT_MODE,
        hosts: new Set(),
        players: new Map(),
        answers: new Map()
    };
    rooms.set(pin, room);
    return room;
}

// เปิดห้องที่เล่นจบไปแล้วอีกครั้ง (เช่นกด "เปิดห้องเล่น" ที่หน้ารวม) = เริ่มรอบใหม่
// ผลรอบก่อนถูกบันทึกลง game_sessions ไปแล้วตอนจบเกม ล้างสถานะในหน่วยความจำได้เลย
// รอบใหม่ทุกคนต้องกดเข้าห้องเองใหม่ ไม่พาผู้เล่นรอบก่อนติดมาอัตโนมัติ
// (แท็บที่เปิดหน้าสรุปผลทิ้งไว้จะไม่โผล่เป็นชื่อในล็อบบี้ทั้งที่ไม่มีใครดูอยู่)
// ใช้โค้ด sessionExpired ตัวเดียวกับ playerId หมดอายุ หน้าเกมจะพากลับไปหน้า lobby ที่กรอกชื่อไว้ให้แล้ว
export function reopenRoom(room) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
    room.phase = "lobby";
    room.questionIndex = 0;
    room.questionStartedAt = 0;
    room.leaderboardUntil = 0;
    room.answers.clear();
    room.sessionId = null;
    room.boss = null;
    for (const player of room.players.values()) {
        clearTimeout(player.disconnectTimer);
        send(player.ws, "ERROR", { code: "sessionExpired", message: "A new round started. Please join again." });
    }
    room.players.clear();
    persist(updateProgress, "waiting", 0, null, room.pin);
}

// ปิดห้องทิ้งเมื่อชุดคำถามถูกลบ: หยุดตัวจับเวลาทุกตัว ไม่งั้นเกมยังเดินข้อถัดไปเองทั้งที่ลบไปแล้ว
// แล้วบอกทุกจอว่าห้องปิด (ต่อใหม่ก็จะได้ pinNotFound เพราะชุดคำถามไม่อยู่แล้ว)
export function closeRoom(room) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
    for (const player of room.players.values()) clearTimeout(player.disconnectTimer);
    broadcast(room, "ERROR", { code: "roomClosed", message: "This game was deleted." });
    rooms.delete(room.pin);
}

// ครูแก้ชุดคำถามที่มีห้องค้างอยู่ในหน่วยความจำ: ห้องที่ยังไม่เริ่มหรือจบไปแล้วรับชุดใหม่ทันที
// ห้องที่กำลังถาม/เฉลยอยู่ไม่แตะ ไม่งั้นข้อที่ผู้เล่นกำลังตอบจะเปลี่ยนกลางคัน (รอบถัดไปค่อยได้ชุดใหม่)
export function refreshRoom(pin) {
    const room = rooms.get(pin);
    if (!room || room.phase === "question" || room.phase === "leaderboard") return;
    const quiz = selectQuiz.get(pin);
    if (!quiz) return;
    try {
        const slides = JSON.parse(quiz.slides_json).map(normalizeSlide);
        if (!slides.length) return;
        room.slides = slides;
        room.title = quiz.title;
    } catch {
        return;
    }
    sendLobby(room);
}

// รายการรูปทั้งชุด ส่งให้ตอนเข้าห้องเพื่อให้เบราว์เซอร์โหลดดักไว้ระหว่างรออยู่ในล็อบบี้
// พอถึงเวลาขึ้นคำถามจริง รูปอยู่ในแคชแล้ว ไม่ต้องรอโหลดกลางเกม
export function roomMedia(room) {
    return [...new Set(room.slides.map(slide => slide.mediaUrl).filter(Boolean))];
}

// ===============================
// SEND & BROADCAST
// ===============================
export function send(ws, type, data = {}) {
    if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

export function broadcast(room, type, data = {}) {
    for (const player of room.players.values()) send(player.ws, type, data);
    for (const host of room.hosts) send(host, type, data);
}

export function broadcastHosts(room, type, data = {}) {
    for (const host of room.hosts) send(host, type, data);
}

export function getPlayers(room) {
    return [...room.players.values()]
        .map(player => ({
            id: player.id,
            name: player.name,
            avatar: player.avatar,
            score: player.score,
            streak: player.streak,
            bestStreak: player.bestStreak,
            eliminated: player.eliminated,
            survived: player.survived,
            lead: player.lead,
            maxLead: BLACKHOLE_MAX_LEAD,
            connected: player.ws !== null
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function countActivePlayers(room) {
    return [...room.players.values()].filter(player => player.ws !== null).length;
}

// เหลือคนรอดไม่เกิน 1 คนก็ไม่ต้องถามต่อแล้ว
export function countAlive(room) {
    return [...room.players.values()].filter(player => !player.eliminated).length;
}

export function sendLobby(room) {
    broadcast(room, "ROOM_STATE", {
        pin: room.pin,
        title: room.title,
        phase: room.phase,
        mode: room.mode,
        total: room.slides.length,
        questionIndex: room.questionIndex,
        players: getPlayers(room)
    });
}
