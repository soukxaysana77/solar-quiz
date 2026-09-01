// MangosGo — server เดียวจบ: static + REST เล็กน้อย + WebSocket แบบ push
// สถานะเกมทั้งหมดอยู่ในหน่วยความจำและเซิร์ฟเวอร์เป็นคนตัดสิน (คะแนน/เวลา/ลำดับคำถาม)
// SQLite ใช้เก็บชุดคำถามจากหน้า Make และบันทึกผลย้อนหลังเท่านั้น
import http from "http";
import { readFile } from "fs/promises";
import { statSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, extname, sep } from "path";
import { randomUUID, randomInt, createHash } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(ROOT, "mangosgo.sqlite3");
const PORT = Number(process.env.PORT) || 8000;
const MAX_PLAYERS_PER_ROOM = 50;
const RECONNECT_GRACE_MS = 15000;
const DEFAULT_TIME_LIMIT = 20;
// ค้างหน้าเฉลย + อันดับไว้เท่านี้ แล้วเซิร์ฟเวอร์พาไปข้อถัดไปเอง ไม่ต้องรอ host กดปุ่ม
const LEADERBOARD_HOLD_MS = 6000;
// ปิดไว้: ต่อให้ทุกคนตอบครบก็ยังเดินครบเวลา
// ผู้เล่นจะได้เห็นจอ "รอคนอื่น" จริง ๆ ไม่ใช่เฉลยแวบเดียวจบ เปลี่ยนเป็น true ถ้าอยากได้แบบตัดจบเร็ว
const END_WHEN_ALL_ANSWERED = false;

// รูปในคำถามถูกดึงออกมาเก็บเป็นไฟล์ที่นี่ แทนการฝังเป็น data URL ไปกับทุก broadcast
const UPLOADS_DIR = join(ROOT, "uploads");
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg"
};

// ===============================
// GAME MODES
// ===============================
// ทุกโหมดใช้เอนจินเดิม ต่างกันที่กติกาให้คะแนนกับเงื่อนไขตกรอบ
// จอ host เอา label/desc/color ไปวาดการ์ดให้เลือกก่อนกด Start
const MODES = {
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

const DEFAULT_MODE = "classic";

// ระยะห่างจากหลุมดำ เริ่มที่ 5 ตอบถูกได้เพิ่ม ตอบไม่ได้ลด แตะ 0 เมื่อไหร่โดนดูด
const BLACKHOLE_START_LEAD = 5;
const BLACKHOLE_MAX_LEAD = 10;
// ตอบถูกภายในหนึ่งในสี่แรกของเวลา ถือว่าเร่งเครื่องหนี ได้ระยะสองช่วง
const BLACKHOLE_FAST_RATIO = 0.25;

function modeOf(room) {
    return MODES[room.mode] || MODES[DEFAULT_MODE];
}

// ส่งให้จอ host ไปวาดการ์ดเลือกโหมด (ไม่ต้องก๊อป list ไปไว้ฝั่ง client)
function modeCatalog() {
    return Object.entries(MODES).map(([id, mode]) => ({
        id,
        label: mode.label,
        desc: mode.desc,
        color: mode.color,
        icon: mode.icon
    }));
}

// ตอบถูกติดกันได้โบนัสเพิ่มขึ้นเรื่อย ๆ ข้อที่ 2 ของ streak ได้ 100 ไล่ขึ้นไปจนตัน 500
const STREAK_BONUS_STEP = 100;
const STREAK_BONUS_MAX = 500;

// อวตารเป็นนักบินอวกาศตัวเดียวกันหมด ต่างกันแค่สีชุด
// ฝั่ง client ส่งมาแค่ index เซิร์ฟเวอร์เป็นคนแปลงเป็นสี กันไม่ให้ยัดค่าอะไรก็ได้เข้าห้อง
const AVATARS = [
    "#ffffff", // white
    "#ff5b5b", // red
    "#ffa53d", // orange
    "#ffe14d", // yellow
    "#7ed957", // green
    "#3ad1c6", // teal
    "#4da6ff", // blue
    "#7b6cff", // indigo
    "#c77dff", // purple
    "#ff8fd0", // pink
    "#8d6e63", // brown
    "#9aa5b1"  // grey
];

function pickAvatar(index) {
    return AVATARS[Number.isInteger(index) && index >= 0 && index < AVATARS.length ? index : 0];
}

function streakBonus(streak) {
    return Math.min(STREAK_BONUS_MAX, Math.max(0, streak - 1) * STREAK_BONUS_STEP);
}

// ===============================
// MEDIA — เอารูปออกจาก payload
// ===============================
// หน้า Make ส่งรูปมาเป็น data URL ถ้าปล่อยไว้ รูปก้อนเดิมจะถูกยิงซ้ำให้ผู้เล่นทุกคนทุกครั้งที่ขึ้นคำถาม
// (50 คน × รูป 512KB = 25MB ต่อข้อ) จึงเขียนลงไฟล์แล้วส่งไปแค่ URL ให้เบราว์เซอร์โหลดเองและแคชได้
// ชื่อไฟล์เป็น hash ของเนื้อไฟล์ รูปเดิมที่ใช้ซ้ำจึงไม่กินที่เพิ่มและแคชได้ตลอดกาล
function storeDataUrl(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;

    const ext = MEDIA_EXT[match[1].toLowerCase()];
    if (!ext) return null;

    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) return null;

    const name = createHash("sha256").update(bytes).digest("hex").slice(0, 32) + ext;
    const target = join(UPLOADS_DIR, name);
    if (!existsSync(target)) writeFileSync(target, bytes);
    return `/uploads/${name}`;
}

// คืนค่า true เมื่อมีการแปลงเกิดขึ้นจริง ผู้เรียกจะได้รู้ว่าต้องเขียนกลับลง DB ไหม
function externalizeMedia(slides) {
    let changed = false;
    for (const slide of slides) {
        if (typeof slide?.mediaUrl !== "string" || !slide.mediaUrl.startsWith("data:")) continue;
        slide.mediaUrl = storeDataUrl(slide.mediaUrl);
        changed = true;
    }
    return changed;
}

// ===============================
// DATABASE
// ===============================
const db = new DatabaseSync(DB_PATH);

function initDatabase() {
    // WAL + busy timeout กัน "database is locked" เวลามีอีกโปรเซสเปิดไฟล์เดียวกันอยู่
    try { db.exec("PRAGMA journal_mode = WAL"); } catch { /* ไฟล์อาจถูกล็อกอยู่ ใช้โหมดเดิมต่อได้ */ }
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`CREATE TABLE IF NOT EXISTS quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pin TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        slides_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'waiting',
        current_index INTEGER DEFAULT 0
    )`);
    const columns = new Set(db.prepare("PRAGMA table_info(quizzes)").all().map(row => row.name));
    if (!columns.has("status")) db.exec("ALTER TABLE quizzes ADD COLUMN status TEXT DEFAULT 'waiting'");
    if (!columns.has("current_index")) db.exec("ALTER TABLE quizzes ADD COLUMN current_index INTEGER DEFAULT 0");
    if (!columns.has("question_started_at")) db.exec("ALTER TABLE quizzes ADD COLUMN question_started_at REAL");
    db.exec(`CREATE TABLE IF NOT EXISTS answers (
        pin TEXT NOT NULL, player TEXT NOT NULL, question_index INTEGER NOT NULL,
        answer_index INTEGER NOT NULL, correct INTEGER NOT NULL, points INTEGER NOT NULL,
        PRIMARY KEY(pin, player, question_index)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS players (
        pin TEXT NOT NULL, player TEXT NOT NULL, joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(pin, player)
    )`);
}
initDatabase();
mkdirSync(UPLOADS_DIR, { recursive: true });

const selectQuiz = db.prepare("SELECT pin, title, slides_json FROM quizzes WHERE pin = ?");
const insertQuiz = db.prepare("INSERT INTO quizzes(pin, title, slides_json) VALUES (?, ?, ?)");
const pinExists = db.prepare("SELECT 1 FROM quizzes WHERE pin = ?");
const upsertPlayer = db.prepare("INSERT OR IGNORE INTO players(pin, player) VALUES (?, ?)");
const saveAnswer = db.prepare("INSERT OR REPLACE INTO answers VALUES (?, ?, ?, ?, ?, ?)");
const updateProgress = db.prepare("UPDATE quizzes SET status = ?, current_index = ?, question_started_at = ? WHERE pin = ?");
const updateSlides = db.prepare("UPDATE quizzes SET slides_json = ? WHERE pin = ?");

// สถานะเกมจริงอยู่ในหน่วยความจำ การเขียนลงดิสก์เป็นแค่บันทึกย้อนหลัง
// ถ้าเขียนไม่ได้ (ไฟล์ถูกล็อก ฯลฯ) ต้องไม่ทำให้เกมที่กำลังเล่นอยู่ล้ม
function persist(statement, ...args) {
    try {
        statement.run(...args);
    } catch (error) {
        console.warn("sqlite write skipped:", error.message);
    }
}

function createPin() {
    let pin;
    do {
        pin = String(randomInt(100000, 1000000));
    } while (pinExists.get(pin));
    return pin;
}

// ===============================
// ROOMS (in-memory, server-authoritative)
// ===============================
const rooms = new Map();

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

function loadRoom(pin) {
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

// ===============================
// SEND & BROADCAST
// ===============================
function send(ws, type, data = {}) {
    if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function broadcast(room, type, data = {}) {
    for (const player of room.players.values()) send(player.ws, type, data);
    for (const host of room.hosts) send(host, type, data);
}

function broadcastHosts(room, type, data = {}) {
    for (const host of room.hosts) send(host, type, data);
}

function getPlayers(room) {
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

function countActivePlayers(room) {
    return [...room.players.values()].filter(player => player.ws !== null).length;
}

function sendLobby(room) {
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

// ===============================
// GAME FLOW
// ===============================
// รายการรูปทั้งชุด ส่งให้ตอนเข้าห้องเพื่อให้เบราว์เซอร์โหลดดักไว้ระหว่างรออยู่ในล็อบบี้
// พอถึงเวลาขึ้นคำถามจริง รูปอยู่ในแคชแล้ว ไม่ต้องรอโหลดกลางเกม
function roomMedia(room) {
    return [...new Set(room.slides.map(slide => slide.mediaUrl).filter(Boolean))];
}

// โหมดที่บีบเวลา (เช่น Rush) ใช้เวลาของโหมดแทนเวลาที่ตั้งไว้ในสไลด์
function questionDuration(room) {
    return modeOf(room).duration || room.slides[room.questionIndex].duration;
}

function questionPayload(room) {
    const slide = room.slides[room.questionIndex];
    const duration = questionDuration(room);
    return {
        index: room.questionIndex,
        total: room.slides.length,
        question: slide.question,
        options: slide.options,
        mediaUrl: slide.mediaUrl,
        mode: room.mode,
        duration,
        remaining: Math.max(0, duration - (Date.now() - room.questionStartedAt))
    };
}

function sendQuestion(room) {
    const slide = room.slides[room.questionIndex];
    room.phase = "question";
    room.answers.clear();
    room.questionStartedAt = Date.now();
    persist(updateProgress, "started", room.questionIndex, room.questionStartedAt / 1000, room.pin);

    broadcast(room, "QUESTION", questionPayload(room));
    broadcastHosts(room, "ANSWER_COUNT", { answered: 0, total: room.players.size });

    clearTimeout(room.questionTimer);
    room.questionTimer = setTimeout(() => finishQuestion(room), questionDuration(room));
}

function finishQuestion(room) {
    if (room.phase !== "question") return;
    clearTimeout(room.questionTimer);
    room.questionTimer = null;

    const slide = room.slides[room.questionIndex];
    room.phase = "leaderboard";

    const mode = modeOf(room);

    for (const player of room.players.values()) {
        if (player.eliminated) continue;
        const record = room.answers.get(player.id);
        // ไม่ตอบก็ถือว่า streak ขาด เหมือนตอบผิด
        if (!record) player.streak = 0;
        // โหมดตกรอบ: ตอบผิดหรือไม่ทันตอบ = จบเกมสำหรับคนนั้น
        if (mode.eliminate && !record?.correct) {
            player.eliminated = true;
            continue;
        }

        // โหมดหลุมดำ: ตอบถูกได้ระยะหนี (ตอบไวได้สองช่วง) ตอบไม่ได้หลุมดำคืบเข้ามาหนึ่งช่วง
        if (mode.blackhole) {
            player.lead = record?.correct
                ? Math.min(BLACKHOLE_MAX_LEAD, player.lead + (record.fast ? 2 : 1))
                : player.lead - 1;
            if (player.lead <= 0) {
                player.lead = 0;
                player.eliminated = true;
                continue;
            }
        }

        player.survived++;
    }

    // จำนวนคนที่เลือกแต่ละตัวเลือก เอาไว้โชว์บนจอ host
    const tally = slide.options.map(option =>
        [...room.answers.values()].filter(record => record.answer === option.index).length
    );

    // ผลรายคนถูกกั๊กไว้จนถึงตรงนี้ ทุกคนถึงได้รู้พร้อมกัน
    for (const [pId, record] of room.answers) {
        const player = room.players.get(pId);
        if (player) send(player.ws, "ANSWER_RESULT", personalResult(player, record));
    }

    broadcast(room, "LEADERBOARD", {
        players: getPlayers(room),
        questionIndex: room.questionIndex,
        correctIndex: slide.correctIndex,
        tally,
        mode: room.mode,
        alive: countAlive(room),
        isLastQuestion: room.questionIndex >= room.slides.length - 1 || isSurvivalOver(room),
        nextIn: LEADERBOARD_HOLD_MS
    });

    room.leaderboardUntil = Date.now() + LEADERBOARD_HOLD_MS;
    room.questionTimer = setTimeout(() => nextQuestion(room), LEADERBOARD_HOLD_MS);
}

// เหลือคนรอดไม่เกิน 1 คนก็ไม่ต้องถามต่อแล้ว
function countAlive(room) {
    return [...room.players.values()].filter(player => !player.eliminated).length;
}

// โหมดที่มีการตกรอบบอกไว้ว่าเหลือคนเท่าไหร่ถึงไม่ต้องถามต่อ
// survival เหลือคนเดียวก็รู้ผลแล้ว ส่วนหลุมดำต้องโดนดูดหมดห้องถึงจบ
function isSurvivalOver(room) {
    const limit = modeOf(room).endWhenAlive;
    return limit !== undefined && countAlive(room) <= limit;
}

function nextQuestion(room) {
    if (room.phase !== "leaderboard") return;
    clearTimeout(room.questionTimer);
    room.questionTimer = null;

    if (room.questionIndex >= room.slides.length - 1 || isSurvivalOver(room)) {
        room.phase = "final";
        persist(updateProgress, "finished", room.questionIndex, room.questionStartedAt / 1000, room.pin);
        broadcast(room, "FINAL", { players: getPlayers(room), mode: room.mode });
        return;
    }
    room.questionIndex++;
    sendQuestion(room);
}

function personalResult(player, record) {
    return {
        correct: record.correct,
        gain: record.gain,
        base: record.base,
        bonus: record.bonus,
        streak: player.streak,
        answer: record.answer,
        total: player.score
    };
}

// ===============================
// HTTP SERVER
// ===============================
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
};

const DIRECTORY_DEFAULTS = {
    page: "index.html",
    Make: "make.html",
    host: "host.html",
    game: "game.html",
    lobby: "lobby.html"
};

const PAGE_ALIASES = { "host.html": "host", "game.html": "game", "lobby.html": "lobby" };

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
}

function redirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function readBody(req) {
    return new Promise((done, fail) => {
        const chunks = [];
        let size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            // สไลด์ที่แนบรูปเป็น data URL ทำให้ payload ใหญ่ได้ จึงเผื่อไว้ 32MB
            if (size > 32 * 1024 * 1024) {
                fail(new Error("Payload too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                done(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
            } catch {
                fail(new Error("Invalid JSON"));
            }
        });
        req.on("error", fail);
    });
}

async function handlePost(req, res, pathname) {
    let data;
    try {
        data = await readBody(req);
    } catch (error) {
        return sendJson(res, 400, { error: error.message });
    }

    // หน้า Make บันทึกชุดคำถามแล้วได้ PIN กลับไป
    if (pathname === "/api/quizzes") {
        const title = String(data.title || "").trim();
        const slides = data.slides;
        if (!title || !Array.isArray(slides) || !slides.length) {
            return sendJson(res, 400, { error: "title and at least one slide are required" });
        }
        try {
            // ดึงรูปออกไปเป็นไฟล์ตั้งแต่ตอนบันทึก ชุดคำถามใน DB จะได้เก็บแค่ URL
            externalizeMedia(slides);
            const pin = createPin();
            insertQuiz.run(pin, title, JSON.stringify(slides));
            return sendJson(res, 201, { pin, title });
        } catch (error) {
            return sendJson(res, 500, { error: `Unable to save quiz: ${error.message}` });
        }
    }

    // หน้าใส่ PIN ใช้ตรวจว่ามีเกมนี้จริงก่อนพาไป lobby
    if (pathname === "/api/join") {
        const quiz = selectQuiz.get(String(data.pin || "").trim());
        if (!quiz) return sendJson(res, 404, { error: "Game PIN not found" });
        return sendJson(res, 200, { pin: quiz.pin, title: quiz.title });
    }

    return sendJson(res, 404, { error: "Not found" });
}

async function handleGet(req, res, url) {
    if (url.pathname === "/") return redirect(res, "/page/");

    // หน้าเลือกอวตารดึงรายการจากที่นี่ จะได้ไม่ต้องก๊อป list ไปไว้สองที่
    if (url.pathname === "/api/avatars") return sendJson(res, 200, { avatars: AVATARS });

    const raw = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (PAGE_ALIASES[raw]) return redirect(res, `/${PAGE_ALIASES[raw]}/${url.search}`);

    let target = resolve(ROOT, raw || "page/index.html");
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    let stats;
    try {
        stats = statSync(target);
    } catch {
        res.writeHead(404);
        return res.end("Not Found");
    }

    if (stats.isDirectory()) {
        // ไดเรกทอรีที่ไม่มี / ปิดท้ายต้อง redirect ก่อน ไม่งั้นลิงก์ css/js แบบ relative จะอ้าง base path ผิด
        if (!url.pathname.endsWith("/")) return redirect(res, `${url.pathname}/${url.search}`);
        target = join(target, DIRECTORY_DEFAULTS[raw.replace(/\/+$/, "")] || "index.html");
    }

    try {
        const file = await readFile(target);
        const headers = {
            "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
            "Content-Length": file.length
        };
        // ชื่อไฟล์ในโฟลเดอร์นี้เป็น hash ของเนื้อไฟล์ เนื้อหาเปลี่ยน = ชื่อเปลี่ยน จึงแคชได้ถาวร
        // เบราว์เซอร์ของผู้เล่นจะโหลดรูปแต่ละใบครั้งเดียวต่อเครื่อง ไม่ใช่ทุกครั้งที่ขึ้นคำถาม
        if (raw.startsWith("uploads/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
        res.writeHead(200, headers);
        res.end(file);
    } catch {
        res.writeHead(404);
        res.end("Not Found");
    }
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "POST") return handlePost(req, res, url.pathname);
    if (req.method === "GET") return handleGet(req, res, url);
    res.writeHead(405);
    res.end("Method Not Allowed");
});

// ===============================
// WEBSOCKET
// ===============================
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    let roomPin = null;
    let playerId = null;
    let isHost = false;

    const onMessage = raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        // HOST — จอใหญ่เข้าคุมห้องด้วย PIN ที่ได้จากหน้า Make
        if (message.type === "HOST_ROOM") {
            const room = loadRoom(String(message.pin || "").trim());
            if (!room) {
                send(ws, "ERROR", { code: "pinNotFound", message: "Game PIN not found." });
                return;
            }
            roomPin = room.pin;
            isHost = true;
            room.hosts.add(ws);

            send(ws, "HOST_READY", {
                pin: room.pin,
                title: room.title,
                total: room.slides.length,
                phase: room.phase,
                media: roomMedia(room),
                modes: modeCatalog(),
                mode: room.mode
            });
            sendLobby(room);
            if (room.phase === "question") {
                send(ws, "QUESTION", questionPayload(room));
                send(ws, "ANSWER_COUNT", { answered: room.answers.size, total: room.players.size });
            } else if (room.phase === "leaderboard") {
                sendLeaderboardTo(ws, room);
            } else if (room.phase === "final") {
                send(ws, "FINAL", { players: getPlayers(room), mode: room.mode });
            }
            return;
        }

        // PLAYER — เข้าห้อง
        // ต่อกลับใช้ playerId ที่เก็บไว้ใน sessionStorage เป็นหลัก (แน่นอนกว่าเทียบชื่อ)
        // ชื่อซ้ำกับคนที่ยังต่ออยู่ = คนละคน ต้องเปลี่ยนชื่อ ไม่ใช่เข้าไปสวมร่างกัน
        if (message.type === "JOIN_ROOM") {
            const room = loadRoom(String(message.pin || "").trim());
            if (!room) {
                send(ws, "ERROR", { code: "pinNotFound", message: "Game PIN not found." });
                return;
            }

            const name = String(message.name || "").trim().slice(0, 40) || "Player";
            const claimed = message.playerId ? room.players.get(String(message.playerId)) : null;
            const sameName = [...room.players.values()].find(p => p.name === name);
            let player = claimed || (sameName && sameName.ws === null ? sameName : null);

            if (!player && sameName) {
                send(ws, "ERROR", { code: "nameTaken", message: "That nickname is taken." });
                return;
            }
            if (!player && room.players.size >= MAX_PLAYERS_PER_ROOM) {
                send(ws, "ERROR", { code: "roomFull", max: MAX_PLAYERS_PER_ROOM, message: `Room is full (max ${MAX_PLAYERS_PER_ROOM}).` });
                return;
            }
            if (!player && room.phase === "final") {
                send(ws, "ERROR", { code: "gameOver", message: "This game has already ended." });
                return;
            }

            if (player) {
                clearTimeout(player.disconnectTimer);
                player.disconnectTimer = null;
                if (player.ws && player.ws !== ws) send(player.ws, "ERROR", { code: "openedElsewhere", message: "This game was opened somewhere else." });
                player.ws = ws;
                if (Number.isInteger(message.avatar)) player.avatar = pickAvatar(message.avatar);
            } else {
                player = {
                    id: randomUUID(),
                    name,
                    avatar: pickAvatar(message.avatar),
                    score: 0,
                    streak: 0,
                    bestStreak: 0,
                    eliminated: false,
                    survived: 0,
                    lead: BLACKHOLE_START_LEAD,
                    ws,
                    disconnectTimer: null
                };
                room.players.set(player.id, player);
                persist(upsertPlayer, room.pin, name);
            }

            roomPin = room.pin;
            playerId = player.id;

            send(ws, "JOINED", {
                pin: room.pin,
                title: room.title,
                playerId: player.id,
                name: player.name,
                avatar: player.avatar,
                score: player.score,
                streak: player.streak,
                lead: player.lead,
                maxLead: BLACKHOLE_MAX_LEAD,
                eliminated: player.eliminated,
                media: roomMedia(room)
            });
            sendLobby(room);

            // ต่อกลางเกม: ส่งสถานะที่กำลังเล่นอยู่ให้ทันที
            if (room.phase === "question") {
                send(ws, "QUESTION", questionPayload(room));
                const previous = room.answers.get(player.id);
                if (previous) send(ws, "ANSWER_ACCEPTED", { answer: previous.answer });
            } else if (room.phase === "leaderboard") {
                const previous = room.answers.get(player.id);
                if (previous) send(ws, "ANSWER_RESULT", personalResult(player, previous));
                sendLeaderboardTo(ws, room);
            } else if (room.phase === "final") {
                send(ws, "FINAL", { players: getPlayers(room), mode: room.mode });
            }
            return;
        }

        if (!roomPin) return;
        const room = rooms.get(roomPin);
        if (!room) return;
        const player = playerId ? room.players.get(playerId) : null;

        // START GAME (host)
        if (message.type === "START_GAME" && isHost && room.phase === "lobby") {
            room.mode = MODES[message.mode] ? message.mode : DEFAULT_MODE;
            room.questionIndex = 0;
            for (const each of room.players.values()) {
                each.score = 0;
                each.streak = 0;
                each.bestStreak = 0;
                each.eliminated = false;
                each.survived = 0;
                each.lead = BLACKHOLE_START_LEAD;
            }
            sendQuestion(room);
            return;
        }

        // ANSWER — ตรวจและให้คะแนนที่เซิร์ฟเวอร์เท่านั้น ตอบได้ครั้งเดียวต่อข้อ
        if (message.type === "ANSWER" && room.phase === "question" && player) {
            if (room.answers.has(player.id)) return;
            // ตกรอบแล้วดูได้อย่างเดียว ตอบไม่ได้
            if (player.eliminated) return;

            const slide = room.slides[room.questionIndex];
            const answer = Number(message.answer);
            if (!slide.options.some(option => option.index === answer)) return;

            const mode = modeOf(room);
            const duration = questionDuration(room);
            const elapsed = Math.max(0, Date.now() - room.questionStartedAt);
            if (elapsed > duration) return;

            const correct = answer === slide.correctIndex;
            player.streak = correct && !mode.noStreak ? player.streak + 1 : 0;
            player.bestStreak = Math.max(player.bestStreak, player.streak);

            let base = 0;
            if (correct) {
                // โหมดแม่นยำให้คะแนนเท่ากันหมด ไม่งั้นคิดตามเวลาที่เหลือ
                base = mode.noSpeed
                    ? mode.flatScore
                    : Math.round(100 + (900 * (duration - elapsed) / duration));
            }
            const bonus = correct && !mode.noStreak ? streakBonus(player.streak) : 0;
            const gain = base + bonus;

            player.score += gain;
            const fast = elapsed <= duration * BLACKHOLE_FAST_RATIO;
            room.answers.set(player.id, { answer, correct, gain, base, bonus, fast });
            persist(saveAnswer, room.pin, player.name, room.questionIndex, answer, correct ? 1 : 0, gain);

            // ตอบรับว่าได้รับคำตอบแล้วเท่านั้น ถูกหรือผิดต้องรอหมดเวลาถึงจะรู้
            send(ws, "ANSWER_ACCEPTED", { answer });
            broadcastHosts(room, "ANSWER_COUNT", { answered: room.answers.size, total: room.players.size });

            if (END_WHEN_ALL_ANSWERED && room.answers.size >= countActivePlayers(room)) finishQuestion(room);
            return;
        }


    };

    // ข้อความเดียวพังต้องไม่ทำให้เซิร์ฟเวอร์ล้มทั้งเครื่องและห้องอื่นหลุดตามไปด้วย
    ws.on("message", raw => {
        try {
            onMessage(raw);
        } catch (error) {
            console.error("message failed:", error);
            send(ws, "ERROR", { code: "serverError", message: "Server error. Please try again." });
        }
    });

    ws.on("close", () => {
        if (!roomPin) return;
        const room = rooms.get(roomPin);
        if (!room) return;

        if (isHost) {
            room.hosts.delete(ws);
            return;
        }

        const player = room.players.get(playerId);
        // ต่อใหม่มาก่อนแล้ว (เช่นเปลี่ยนหน้า lobby -> game) การปิดของ ws เก่าไม่ต้องทำอะไร
        if (!player || player.ws !== ws) return;

        player.ws = null;
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = setTimeout(() => {
            if (player.ws !== null) return;
            room.players.delete(player.id);
            if (room.players.size === 0 && room.hosts.size === 0) {
                clearTimeout(room.questionTimer);
                rooms.delete(room.pin);
                return;
            }
            sendLobby(room);
        }, RECONNECT_GRACE_MS);

        sendLobby(room);
        if (room.phase === "question") {
            broadcastHosts(room, "ANSWER_COUNT", { answered: room.answers.size, total: room.players.size });
        }
    });
});

function sendLeaderboardTo(ws, room) {
    const slide = room.slides[room.questionIndex];
    send(ws, "LEADERBOARD", {
        players: getPlayers(room),
        questionIndex: room.questionIndex,
        correctIndex: slide.correctIndex,
        tally: slide.options.map(option => [...room.answers.values()].filter(record => record.answer === option.index).length),
        isLastQuestion: room.questionIndex >= room.slides.length - 1,
        nextIn: Math.max(0, room.leaderboardUntil - Date.now())
    });
}

server.listen(PORT, () => {
    console.log(`MangosGo running at http://localhost:${PORT}`);
});
