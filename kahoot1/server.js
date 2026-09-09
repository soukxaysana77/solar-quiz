// MangosGo — server เดียวจบ: static + REST เล็กน้อย + WebSocket แบบ push
// สถานะเกมทั้งหมดอยู่ในหน่วยความจำและเซิร์ฟเวอร์เป็นคนตัดสิน (คะแนน/เวลา/ลำดับคำถาม)
// SQLite ใช้เก็บชุดคำถามจากหน้า Make และบันทึกผลย้อนหลังเท่านั้น
import http from "http";
import { readFile } from "fs/promises";
import { statSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve, extname, sep } from "path";
import { randomUUID, randomInt, createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";

const ROOT = dirname(fileURLToPath(import.meta.url));
// ตั้ง DB_PATH ได้ตอนรัน เอาไว้ทดสอบด้วยฐานข้อมูลเปล่าโดยไม่แตะของจริง
const DB_PATH = process.env.DB_PATH || join(ROOT, "mangosgo.sqlite3");
const PORT = Number(process.env.PORT) || 8000;
const MAX_PLAYERS_PER_ROOM = 50;
// ชื่อเล่นสั้น ๆ อ่านง่ายบนจอใหญ่และไม่ล้นป้ายชื่อใต้อวตาร (ฝั่งหน้าเว็บจำกัดไว้เท่ากันที่ lobby)
const MAX_NICKNAME_LENGTH = 10;
const RECONNECT_GRACE_MS = 15000;
const DEFAULT_TIME_LIMIT = 20;
// ค้างหน้าเฉลย + อันดับไว้เท่านี้ แล้วเซิร์ฟเวอร์พาไปข้อถัดไปเอง ไม่ต้องรอ host กดปุ่ม
const LEADERBOARD_HOLD_MS = 6000;
// ปิดไว้: ต่อให้ทุกคนตอบครบก็ยังเดินครบเวลา
// ผู้เล่นจะได้เห็นจอ "รอคนอื่น" จริง ๆ ไม่ใช่เฉลยแวบเดียวจบ เปลี่ยนเป็น true ถ้าอยากได้แบบตัดจบเร็ว
const END_WHEN_ALL_ANSWERED = false;

// รูปในคำถามถูกดึงออกมาเก็บเป็นไฟล์ที่นี่ แทนการฝังเป็น data URL ไปกับทุก broadcast
// ===============================
// บัญชีผู้ใช้และสิทธิ์
// ===============================
// student = เข้าเล่นเกมและดูประวัติของตัวเอง
// teacher = สร้าง/แก้ชุดคำถามและเปิดห้องเล่น
// admin   = ทำได้ทุกอย่าง คนที่สมัครเป็นคนแรกของระบบจะได้สิทธิ์นี้อัตโนมัติ
const ROLES = ["student", "teacher", "admin"];
// role ที่ผู้ใช้เลือกเองตอนสมัครได้ admin ต้องถูกตั้งให้เท่านั้น
const SIGNUP_ROLES = ["student", "teacher"];
const SESSION_COOKIE = "mangosgo_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

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

    db.exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    // เก็บ session ใน DB ไม่ใช่ในหน่วยความจำ รีสตาร์ตเซิร์ฟเวอร์แล้วผู้ใช้ไม่หลุด
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    // ชุดคำถามที่สร้างไว้ก่อนมีระบบบัญชีจะมี owner_id เป็น NULL ถือว่าไม่มีเจ้าของ
    if (!columns.has("owner_id")) db.exec("ALTER TABLE quizzes ADD COLUMN owner_id INTEGER");

    // ประวัติการเล่นแยกเป็น "รอบ" ไม่ผูกกับ PIN ตรง ๆ ชุดคำถามเดียวจึงเปิดเล่นซ้ำได้
    // และครูเห็นผลของแต่ละห้องแยกกัน ไม่ใช่ผลล่าสุดทับของเก่า
    db.exec(`CREATE TABLE IF NOT EXISTS game_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pin TEXT NOT NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        host_id INTEGER,
        owner_id INTEGER,
        question_count INTEGER NOT NULL DEFAULT 0,
        player_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT
    )`);
    // แถวละหนึ่งคนต่อหนึ่งรอบ user_id เป็น NULL ได้ เพราะเข้าเล่นด้วย PIN โดยไม่ล็อกอินก็ได้
    db.exec(`CREATE TABLE IF NOT EXISTS session_results (
        session_id INTEGER NOT NULL,
        player_key TEXT NOT NULL,
        user_id INTEGER,
        name TEXT NOT NULL,
        avatar INTEGER,
        score INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        place INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(session_id, player_key)
    )`);
    // เก็บรายข้อไว้ให้ครูดูว่าข้อไหนคนตอบผิดเยอะ
    db.exec(`CREATE TABLE IF NOT EXISTS session_answers (
        session_id INTEGER NOT NULL,
        player_key TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        answer_index INTEGER NOT NULL,
        correct INTEGER NOT NULL,
        points INTEGER NOT NULL,
        PRIMARY KEY(session_id, player_key, question_index)
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_results_user ON session_results(user_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_owner ON game_sessions(owner_id)");
}
initDatabase();
mkdirSync(UPLOADS_DIR, { recursive: true });

const selectQuiz = db.prepare("SELECT pin, title, slides_json FROM quizzes WHERE pin = ?");
const insertQuiz = db.prepare("INSERT INTO quizzes(pin, title, slides_json, owner_id) VALUES (?, ?, ?, ?)");
const pinExists = db.prepare("SELECT 1 FROM quizzes WHERE pin = ?");
const upsertPlayer = db.prepare("INSERT OR IGNORE INTO players(pin, player) VALUES (?, ?)");
const saveAnswer = db.prepare("INSERT OR REPLACE INTO answers VALUES (?, ?, ?, ?, ?, ?)");
const updateProgress = db.prepare("UPDATE quizzes SET status = ?, current_index = ?, question_started_at = ? WHERE pin = ?");
const updateSlides = db.prepare("UPDATE quizzes SET slides_json = ? WHERE pin = ?");

const insertSessionRow = db.prepare(`
    INSERT INTO game_sessions(pin, title, mode, host_id, owner_id, question_count, player_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const finishSessionRow = db.prepare("UPDATE game_sessions SET ended_at = CURRENT_TIMESTAMP, player_count = ? WHERE id = ?");
const insertResult = db.prepare(`
    INSERT OR REPLACE INTO session_results(session_id, player_key, user_id, name, avatar, score, correct_count, best_streak, place)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSessionAnswer = db.prepare(`
    INSERT OR REPLACE INTO session_answers(session_id, player_key, question_index, answer_index, correct, points)
    VALUES (?, ?, ?, ?, ?, ?)
`);
const quizOwner = db.prepare("SELECT owner_id FROM quizzes WHERE pin = ?");

// ---- คิวรีสำหรับหน้า dashboard ----
// นักเรียน: รอบที่ตัวเองเคยเล่น เรียงจากล่าสุด
const studentHistory = db.prepare(`
    SELECT g.id, g.pin, g.title, g.mode, g.started_at, g.question_count, g.player_count,
           r.score, r.correct_count, r.best_streak, r.place
    FROM session_results r JOIN game_sessions g ON g.id = r.session_id
    WHERE r.user_id = ? AND g.ended_at IS NOT NULL
    ORDER BY g.id DESC LIMIT 50
`);
const studentStats = db.prepare(`
    SELECT COUNT(*) AS played, COALESCE(SUM(r.score), 0) AS total_score,
           COALESCE(SUM(r.correct_count), 0) AS total_correct, MIN(r.place) AS best_place
    FROM session_results r JOIN game_sessions g ON g.id = r.session_id
    WHERE r.user_id = ? AND g.ended_at IS NOT NULL
`);

// ครู: ชุดคำถามของตัวเอง พร้อมจำนวนรอบที่เคยเปิดเล่น
const teacherQuizzes = db.prepare(`
    SELECT q.pin, q.title, q.created_at, q.slides_json,
           (SELECT COUNT(*) FROM game_sessions g WHERE g.pin = q.pin AND g.ended_at IS NOT NULL) AS times_played
    FROM quizzes q WHERE q.owner_id = ? ORDER BY q.id DESC
`);
const allQuizzes = db.prepare(`
    SELECT q.pin, q.title, q.created_at, q.slides_json, u.name AS owner_name,
           (SELECT COUNT(*) FROM game_sessions g WHERE g.pin = q.pin AND g.ended_at IS NOT NULL) AS times_played
    FROM quizzes q LEFT JOIN users u ON u.id = q.owner_id ORDER BY q.id DESC LIMIT 200
`);
const teacherSessions = db.prepare(`
    SELECT id, pin, title, mode, started_at, question_count, player_count
    FROM game_sessions WHERE owner_id = ? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT 50
`);
const sessionStanding = db.prepare(`
    SELECT name, avatar, score, correct_count, best_streak, place
    FROM session_results WHERE session_id = ? ORDER BY place
`);
const sessionOwner = db.prepare("SELECT owner_id, host_id, pin, title, mode, started_at, question_count FROM game_sessions WHERE id = ?");
// ข้อไหนคนตอบผิดเยอะ ครูจะได้รู้ว่าต้องกลับไปสอนซ้ำตรงไหน
const sessionQuestionStats = db.prepare(`
    SELECT question_index, COUNT(*) AS answered, SUM(correct) AS correct
    FROM session_answers WHERE session_id = ? GROUP BY question_index ORDER BY question_index
`);

// แอดมิน: รายชื่อผู้ใช้ทั้งหมด และตัวเลขรวมของระบบ
const allUsers = db.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY id");
const adminStats = db.prepare(`
    SELECT (SELECT COUNT(*) FROM users) AS users,
           (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS teachers,
           (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
           (SELECT COUNT(*) FROM quizzes) AS quizzes,
           (SELECT COUNT(*) FROM game_sessions WHERE ended_at IS NOT NULL) AS sessions
`);
const updateUserRole = db.prepare("UPDATE users SET role = ? WHERE id = ?");
const countAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
const deleteQuizByPin = db.prepare("DELETE FROM quizzes WHERE pin = ?");

const insertUser = db.prepare("INSERT INTO users(email, name, password_hash, role) VALUES (?, ?, ?, ?)");
const userByEmail = db.prepare("SELECT id, email, name, password_hash, role FROM users WHERE email = ?");
const userById = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?");
const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
const insertSession = db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const purgeSessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?");
const sessionUser = db.prepare(`
    SELECT users.id, users.email, users.name, users.role, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
`);

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
        // ผูก answerIndex ของข้อนี้เข้ากับแต่ละคน (ไม่ใส่ใน getPlayers() เพราะ room.answers มีความหมาย
        // เฉพาะข้อปัจจุบันเท่านั้น) โหมดแท่นคำตอบใช้ค่านี้รู้ว่าใครควรยืนบนแท่นไหนตอนเฉลย
        players: getPlayers(room).map(player => ({ ...player, answerIndex: room.answers.get(player.id)?.answer ?? null })),
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

// เปิดรอบใหม่: จำว่าใครเป็นคนกดเริ่ม เล่นชุดไหน โหมดอะไร
function openSession(room, hostUser) {
    try {
        const owner = quizOwner.get(room.pin)?.owner_id ?? null;
        const created = insertSessionRow.run(
            room.pin, room.title, room.mode, hostUser?.id ?? null, owner, room.slides.length, room.players.size
        );
        return Number(created.lastInsertRowid);
    } catch (error) {
        // บันทึกประวัติไม่ได้ต้องไม่ทำให้เกมที่กำลังจะเริ่มล้ม
        console.warn("ไม่สามารถเปิดรอบการเล่น:", error.message);
        return null;
    }
}

// ปิดรอบ: เก็บอันดับสุดท้ายของทุกคนไว้ให้ dashboard เอาไปแสดง
function closeSession(room) {
    if (!room.sessionId) return;
    const ranked = [...room.players.values()].sort((a, b) => b.score - a.score);
    ranked.forEach((player, index) => {
        persist(
            insertResult,
            room.sessionId, player.id, player.userId ?? null, player.name, player.avatar,
            player.score, player.correctCount ?? 0, player.bestStreak, index + 1
        );
    });
    persist(finishSessionRow, room.players.size, room.sessionId);
    room.sessionId = null;
}

function nextQuestion(room) {
    if (room.phase !== "leaderboard") return;
    clearTimeout(room.questionTimer);
    room.questionTimer = null;

    if (room.questionIndex >= room.slides.length - 1 || isSurvivalOver(room)) {
        room.phase = "final";
        persist(updateProgress, "finished", room.questionIndex, room.questionStartedAt / 1000, room.pin);
        closeSession(room);
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
    auth: "index.html",
    dashboard: "index.html",
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

// ===============================
// AUTH — รหัสผ่าน / คุกกี้ / session
// ===============================

// scrypt มากับ Node ไม่ต้องลงไลบรารีเพิ่ม เก็บ salt ไว้ในสตริงเดียวกับ hash
function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
    const [algo, salt, hash] = String(stored || "").split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const want = Buffer.from(hash, "hex");
    const got = scryptSync(password, salt, 64);
    // เทียบแบบเวลาคงที่ ไม่ให้เดารหัสจากเวลาที่ใช้ตอบ
    return got.length === want.length && timingSafeEqual(got, want);
}

function readCookies(req) {
    const jar = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
        const at = part.indexOf("=");
        if (at < 1) continue;
        jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    }
    return jar;
}

// HttpOnly กัน JS ในหน้าเว็บอ่านโทเคน SameSite=Lax กันถูกยิงข้ามเว็บ
function setSessionCookie(res, token, maxAgeSeconds) {
    const bits = [
        `${SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`
    ];
    res.setHeader("Set-Cookie", bits.join("; "));
}

function startSession(res, userId) {
    const token = randomBytes(32).toString("hex");
    persist(purgeSessions, Date.now());
    insertSession.run(token, userId, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
    return token;
}

// คืนผู้ใช้ที่ล็อกอินอยู่ หรือ null ถ้าไม่มี/หมดอายุ
function currentUser(req) {
    const token = readCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    let row;
    try {
        row = sessionUser.get(token);
    } catch {
        return null;
    }
    if (!row) return null;
    if (row.expires_at < Date.now()) {
        persist(deleteSession, token);
        return null;
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
}

const canAuthor = user => user?.role === "teacher" || user?.role === "admin";

const publicUser = user => (user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null);

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

    // สมัครสมาชิก คนแรกของระบบได้เป็น admin เพื่อจะได้มีคนดูแลตั้งแต่ต้น
    if (pathname === "/api/auth/register") {
        const name = String(data.name || "").trim().slice(0, 60);
        const email = String(data.email || "").trim().toLowerCase();
        const password = String(data.password || "");
        let role = String(data.role || "student");

        if (!name) return sendJson(res, 400, { code: "nameRequired" });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { code: "invalidEmail" });
        if (password.length < MIN_PASSWORD_LENGTH) return sendJson(res, 400, { code: "weakPassword", min: MIN_PASSWORD_LENGTH });
        if (!SIGNUP_ROLES.includes(role)) role = "student";
        if (countUsers.get().n === 0) role = "admin";

        if (userByEmail.get(email)) return sendJson(res, 409, { code: "emailTaken" });
        try {
            const created = insertUser.run(email, name, hashPassword(password), role);
            startSession(res, Number(created.lastInsertRowid));
            return sendJson(res, 201, { user: { id: Number(created.lastInsertRowid), name, email, role } });
        } catch (error) {
            return sendJson(res, 500, { code: "serverError", error: error.message });
        }
    }

    if (pathname === "/api/auth/login") {
        const email = String(data.email || "").trim().toLowerCase();
        const password = String(data.password || "");
        const row = userByEmail.get(email);
        // ตอบข้อความเดียวกันทั้งกรณีไม่มีอีเมลนี้และรหัสผิด จะได้ไม่บอกใบ้ว่ามีบัญชีไหน
        if (!row || !verifyPassword(password, row.password_hash)) return sendJson(res, 401, { code: "badCredentials" });
        startSession(res, row.id);
        return sendJson(res, 200, { user: { id: row.id, name: row.name, email: row.email, role: row.role } });
    }

    if (pathname === "/api/auth/logout") {
        const token = readCookies(req)[SESSION_COOKIE];
        if (token) persist(deleteSession, token);
        setSessionCookie(res, "", 0);
        return sendJson(res, 200, { ok: true });
    }

    // ครูลบชุดคำถามของตัวเอง แอดมินลบของใครก็ได้ ประวัติการเล่นเก่ายังอยู่
    if (pathname === "/api/quizzes/delete") {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { code: "notLoggedIn" });
        const pin = String(data.pin || "").trim();
        const row = quizOwner.get(pin);
        if (!row) return sendJson(res, 404, { code: "notFound" });
        if (user.role !== "admin" && row.owner_id !== user.id) return sendJson(res, 403, { code: "forbidden" });
        // ห้องที่ค้างอยู่ในหน่วยความจำต้องปิดด้วย ไม่งั้นยังเล่นต่อได้ทั้งที่ลบไปแล้ว
        rooms.delete(pin);
        persist(deleteQuizByPin, pin);
        return sendJson(res, 200, { ok: true });
    }

    // แอดมินเปลี่ยน role ของคนอื่น
    if (pathname === "/api/users/role") {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { code: "notLoggedIn" });
        if (user.role !== "admin") return sendJson(res, 403, { code: "forbidden" });
        const id = Number(data.id);
        const role = String(data.role || "");
        if (!ROLES.includes(role)) return sendJson(res, 400, { code: "badRole" });
        if (!userById.get(id)) return sendJson(res, 404, { code: "notFound" });
        // กันแอดมินคนสุดท้ายลดสิทธิ์ตัวเองจนไม่มีใครดูแลระบบได้อีก
        if (id === user.id && role !== "admin" && countAdmins.get().n <= 1) {
            return sendJson(res, 400, { code: "lastAdmin" });
        }
        persist(updateUserRole, role, id);
        return sendJson(res, 200, { ok: true, user: userById.get(id) });
    }

    // หน้า Make บันทึกชุดคำถามแล้วได้ PIN กลับไป
    if (pathname === "/api/quizzes") {
        // เฉพาะครูกับแอดมินเท่านั้นที่สร้างชุดคำถามได้
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { code: "notLoggedIn" });
        if (!canAuthor(user)) return sendJson(res, 403, { code: "forbidden" });

        const title = String(data.title || "").trim();
        const slides = data.slides;
        if (!title || !Array.isArray(slides) || !slides.length) {
            return sendJson(res, 400, { error: "title and at least one slide are required" });
        }
        try {
            // ดึงรูปออกไปเป็นไฟล์ตั้งแต่ตอนบันทึก ชุดคำถามใน DB จะได้เก็บแค่ URL
            externalizeMedia(slides);
            const pin = createPin();
            insertQuiz.run(pin, title, JSON.stringify(slides), user.id);
            return sendJson(res, 201, { pin, title });
        } catch (error) {
            return sendJson(res, 500, { error: `Unable to save quiz: ${error.message}` });
        }
    }

    // หน้าใส่ PIN ใช้ตรวจว่ามีเกมนี้จริงก่อนพาไป lobby
    if (pathname === "/api/join") {
        const quiz = selectQuiz.get(String(data.pin || "").trim());
        // ส่งรหัสไปด้วย หน้าเว็บจะได้แปลเป็นภาษาที่ผู้ใช้เลือก ไม่ใช่โชว์อังกฤษตายตัว
        if (!quiz) return sendJson(res, 404, { code: "pinNotFound", error: "Game PIN not found" });
        return sendJson(res, 200, { pin: quiz.pin, title: quiz.title });
    }

    return sendJson(res, 404, { error: "Not found" });
}

// จำนวนคำถามในชุด เก็บเป็น JSON เลยต้อง parse ก่อนนับ
function slideCount(json) {
    try {
        const list = JSON.parse(json);
        return Array.isArray(list) ? list.length : 0;
    } catch {
        return 0;
    }
}

// ข้อมูลของ dashboard ต่างกันตาม role หน้าเว็บใช้ตัวเดียวแล้ววาดคนละส่วน
function dashboardFor(user) {
    if (user.role === "student") {
        const stats = studentStats.get(user.id) || {};
        return {
            stats: {
                played: stats.played || 0,
                totalScore: stats.total_score || 0,
                totalCorrect: stats.total_correct || 0,
                bestPlace: stats.best_place || null
            },
            history: studentHistory.all(user.id).map(row => ({
                id: row.id, pin: row.pin, title: row.title, mode: row.mode,
                playedAt: row.started_at, questionCount: row.question_count, playerCount: row.player_count,
                score: row.score, correctCount: row.correct_count, bestStreak: row.best_streak, place: row.place
            }))
        };
    }

    // ครูเห็นเฉพาะของตัวเอง แอดมินเห็นทั้งระบบ
    const isAdmin = user.role === "admin";
    const quizRows = isAdmin ? allQuizzes.all() : teacherQuizzes.all(user.id);
    const payload = {
        quizzes: quizRows.map(row => ({
            pin: row.pin,
            title: row.title,
            createdAt: row.created_at,
            questionCount: slideCount(row.slides_json),
            timesPlayed: row.times_played,
            ownerName: row.owner_name ?? null
        })),
        sessions: (isAdmin ? db.prepare(`
            SELECT id, pin, title, mode, started_at, question_count, player_count
            FROM game_sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 50
        `).all() : teacherSessions.all(user.id)).map(row => ({
            id: row.id, pin: row.pin, title: row.title, mode: row.mode,
            playedAt: row.started_at, questionCount: row.question_count, playerCount: row.player_count
        }))
    };

    if (isAdmin) {
        payload.users = allUsers.all().map(row => ({
            id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at
        }));
        payload.stats = adminStats.get();
    } else {
        payload.stats = {
            quizzes: payload.quizzes.length,
            sessions: payload.sessions.length,
            players: payload.sessions.reduce((sum, row) => sum + row.playerCount, 0)
        };
    }
    return payload;
}

// หน้าไหนต้องล็อกอินด้วย role อะไรบ้าง เช็คที่เซิร์ฟเวอร์ ฝั่งหน้าเว็บซ่อนปุ่มให้สวยเฉย ๆ
const GUARDED_PAGES = [
    { prefix: "Make", roles: ["teacher", "admin"] },
    { prefix: "host", roles: ["teacher", "admin"] },
    // หน้ารวมเปิดได้ทุก role แต่ต้องล็อกอินก่อน
    { prefix: "dashboard", roles: ROLES }
];

async function handleGet(req, res, url) {
    if (url.pathname === "/") return redirect(res, "/page/");

    // หน้าเลือกอวตารดึงรายการจากที่นี่ จะได้ไม่ต้องก๊อป list ไปไว้สองที่
    if (url.pathname === "/api/avatars") return sendJson(res, 200, { avatars: AVATARS });

    // หน้าเว็บถามว่า "ตอนนี้ใครล็อกอินอยู่" ผ่านทางนี้
    // hasUsers ให้หน้าสมัครรู้ว่าคนแรกของระบบจะได้เป็นแอดมิน
    if (url.pathname === "/api/auth/me") {
        return sendJson(res, 200, { user: publicUser(currentUser(req)), hasUsers: countUsers.get().n > 0 });
    }

    // ---- ข้อมูลของหน้า dashboard ----
    if (url.pathname === "/api/dashboard") {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { code: "notLoggedIn" });
        try {
            return sendJson(res, 200, { user: publicUser(user), ...dashboardFor(user) });
        } catch (error) {
            return sendJson(res, 500, { code: "serverError", error: error.message });
        }
    }

    // รายงานของรอบเดียว ครูเจ้าของชุดคำถามกับแอดมินเท่านั้นที่เปิดดูได้
    if (url.pathname === "/api/session") {
        const user = currentUser(req);
        if (!user) return sendJson(res, 401, { code: "notLoggedIn" });
        const id = Number(url.searchParams.get("id"));
        const session = Number.isInteger(id) ? sessionOwner.get(id) : null;
        if (!session) return sendJson(res, 404, { code: "notFound" });
        if (user.role !== "admin" && session.owner_id !== user.id && session.host_id !== user.id) {
            return sendJson(res, 403, { code: "forbidden" });
        }
        return sendJson(res, 200, {
            session: { id, pin: session.pin, title: session.title, mode: session.mode, startedAt: session.started_at, questionCount: session.question_count },
            standing: sessionStanding.all(id),
            questions: sessionQuestionStats.all(id).map(row => ({
                index: row.question_index,
                answered: row.answered,
                correct: row.correct,
                percent: row.answered ? Math.round((row.correct / row.answered) * 100) : 0
            }))
        });
    }

    const raw = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (PAGE_ALIASES[raw]) return redirect(res, `/${PAGE_ALIASES[raw]}/${url.search}`);

    // ขอไฟล์ในโฟลเดอร์ที่ล็อกไว้ ต้องมีสิทธิ์ก่อน ไม่งั้นพาไปหน้าเข้าสู่ระบบ
    // พก next มาด้วยจะได้เด้งกลับมาที่เดิมหลังล็อกอินเสร็จ
    const guard = GUARDED_PAGES.find(rule => raw === rule.prefix || raw.startsWith(rule.prefix + "/"));
    if (guard) {
        const user = currentUser(req);
        if (!user) return redirect(res, `/auth/?next=${encodeURIComponent(url.pathname + url.search)}`);
        if (!guard.roles.includes(user.role)) return redirect(res, "/auth/?denied=1");
    }

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

wss.on("connection", (ws, req) => {
    let roomPin = null;
    let playerId = null;
    let isHost = false;
    // คุกกี้ session ติดมากับตอน upgrade อยู่แล้ว เก็บไว้ตรวจสิทธิ์ตอนขอเปิดห้อง
    // หน้าเว็บถูกกันไว้ชั้นหนึ่งแล้ว แต่ WebSocket เปิดตรง ๆ ได้ จึงต้องตรวจซ้ำที่นี่
    const socketUser = currentUser(req);

    const onMessage = raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        // HOST — จอใหญ่เข้าคุมห้องด้วย PIN ที่ได้จากหน้า Make
        if (message.type === "HOST_ROOM") {
            if (!socketUser) {
                send(ws, "ERROR", { code: "notLoggedIn", message: "Sign in first." });
                return;
            }
            if (!canAuthor(socketUser)) {
                send(ws, "ERROR", { code: "forbidden", message: "This account cannot host a game." });
                return;
            }
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

            const name = String(message.name || "").trim().slice(0, MAX_NICKNAME_LENGTH) || "Player";
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
                    // ล็อกอินอยู่ก็ผูกผลกับบัญชีไว้ ไม่ได้ล็อกอินก็เล่นได้ แค่ไม่มีประวัติเก็บให้
                    userId: socketUser?.id ?? null,
                    avatar: pickAvatar(message.avatar),
                    score: 0,
                    correctCount: 0,
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
            // เปิด "รอบ" ใหม่ทุกครั้งที่กดเริ่ม ผลของรอบก่อนจึงไม่ถูกทับ
            room.sessionId = openSession(room, socketUser);
            for (const each of room.players.values()) {
                each.score = 0;
                each.correctCount = 0;
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
            if (correct) player.correctCount = (player.correctCount ?? 0) + 1;
            const fast = elapsed <= duration * BLACKHOLE_FAST_RATIO;
            room.answers.set(player.id, { answer, correct, gain, base, bonus, fast });
            persist(saveAnswer, room.pin, player.name, room.questionIndex, answer, correct ? 1 : 0, gain);
            if (room.sessionId) {
                persist(insertSessionAnswer, room.sessionId, player.id, room.questionIndex, answer, correct ? 1 : 0, gain);
            }

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
