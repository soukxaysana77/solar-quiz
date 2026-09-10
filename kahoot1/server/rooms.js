// ===============================
// ROOMS (in-memory, server-authoritative)
// ===============================
// ห้องทั้งหมดอยู่ในหน่วยความจำ เซิร์ฟเวอร์เป็นคนตัดสินคะแนน/เวลา/ลำดับคำถาม
// รวมฟังก์ชันส่งข้อความเข้าห้องไว้ที่นี่ด้วย เพราะทุกตัวทำงานบนโครงสร้าง room เดียวกัน
import { BLACKHOLE_MAX_LEAD, DEFAULT_TIME_LIMIT } from "./config.js";
import { externalizeMedia, persist, selectQuiz, updateSlides } from "./db.js";
import { DEFAULT_MODE } from "./modes.js";

export const rooms = new Map();

// แปลงสไลด์จากหน้า Make ให้เป็นรูปแบบที่เกมใช้จริง
// ตัวเลือกที่เว้นว่างถูกตัดทิ้ง แต่ยังพก index เดิมไว้เพื่อเทียบกับ correctIndex ที่บันทึกไว้
function normalizeSlide(slide, index) {
    const options = (slide.answers || [])
        .map((text, i) => ({ index: i, text: String(text ?? "").trim() }))
        .filter(option => option.text !== "");
    const seconds = parseInt(String(slide.timeLimit ?? DEFAULT_TIME_LIMIT), 10);
    return {
        question: String(slide.question || "").trim() || `Question ${index + 1}`,
        options,
        correctIndex: Number(slide.correctIndex) || 0,
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
