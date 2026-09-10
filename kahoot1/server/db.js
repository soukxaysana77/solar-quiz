// ===============================
// DATABASE + ไฟล์รูป
// ===============================
// SQLite เก็บชุดคำถามจากหน้า Make กับบันทึกผลย้อนหลังเท่านั้น สถานะเกมจริงอยู่ในหน่วยความจำ
// รวมเรื่องรูปไว้ที่นี่ด้วย เพราะเป็นการเก็บของลงดิสก์เหมือนกัน (แค่คนละที่เก็บ)
import { createHash, randomInt } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, MAX_MEDIA_BYTES, MEDIA_EXT, UPLOADS_DIR } from "./config.js";

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

export const selectQuiz = db.prepare("SELECT pin, title, slides_json FROM quizzes WHERE pin = ?");
export const insertQuiz = db.prepare("INSERT INTO quizzes(pin, title, slides_json, owner_id) VALUES (?, ?, ?, ?)");
const pinExists = db.prepare("SELECT 1 FROM quizzes WHERE pin = ?");
export const upsertPlayer = db.prepare("INSERT OR IGNORE INTO players(pin, player) VALUES (?, ?)");
export const saveAnswer = db.prepare("INSERT OR REPLACE INTO answers VALUES (?, ?, ?, ?, ?, ?)");
export const updateProgress = db.prepare("UPDATE quizzes SET status = ?, current_index = ?, question_started_at = ? WHERE pin = ?");
export const updateSlides = db.prepare("UPDATE quizzes SET slides_json = ? WHERE pin = ?");

export const insertSessionRow = db.prepare(`
    INSERT INTO game_sessions(pin, title, mode, host_id, owner_id, question_count, player_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);
export const finishSessionRow = db.prepare("UPDATE game_sessions SET ended_at = CURRENT_TIMESTAMP, player_count = ? WHERE id = ?");
export const insertResult = db.prepare(`
    INSERT OR REPLACE INTO session_results(session_id, player_key, user_id, name, avatar, score, correct_count, best_streak, place)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
export const insertSessionAnswer = db.prepare(`
    INSERT OR REPLACE INTO session_answers(session_id, player_key, question_index, answer_index, correct, points)
    VALUES (?, ?, ?, ?, ?, ?)
`);
export const quizOwner = db.prepare("SELECT owner_id FROM quizzes WHERE pin = ?");

// ---- คิวรีสำหรับหน้า dashboard ----
// นักเรียน: รอบที่ตัวเองเคยเล่น เรียงจากล่าสุด
export const studentHistory = db.prepare(`
    SELECT g.id, g.pin, g.title, g.mode, g.started_at, g.question_count, g.player_count,
           r.score, r.correct_count, r.best_streak, r.place
    FROM session_results r JOIN game_sessions g ON g.id = r.session_id
    WHERE r.user_id = ? AND g.ended_at IS NOT NULL
    ORDER BY g.id DESC LIMIT 50
`);
export const studentStats = db.prepare(`
    SELECT COUNT(*) AS played, COALESCE(SUM(r.score), 0) AS total_score,
           COALESCE(SUM(r.correct_count), 0) AS total_correct, MIN(r.place) AS best_place
    FROM session_results r JOIN game_sessions g ON g.id = r.session_id
    WHERE r.user_id = ? AND g.ended_at IS NOT NULL
`);

// ครู: ชุดคำถามของตัวเอง พร้อมจำนวนรอบที่เคยเปิดเล่น
export const teacherQuizzes = db.prepare(`
    SELECT q.pin, q.title, q.created_at, q.slides_json,
           (SELECT COUNT(*) FROM game_sessions g WHERE g.pin = q.pin AND g.ended_at IS NOT NULL) AS times_played
    FROM quizzes q WHERE q.owner_id = ? ORDER BY q.id DESC
`);
export const allQuizzes = db.prepare(`
    SELECT q.pin, q.title, q.created_at, q.slides_json, u.name AS owner_name,
           (SELECT COUNT(*) FROM game_sessions g WHERE g.pin = q.pin AND g.ended_at IS NOT NULL) AS times_played
    FROM quizzes q LEFT JOIN users u ON u.id = q.owner_id ORDER BY q.id DESC LIMIT 200
`);
export const teacherSessions = db.prepare(`
    SELECT id, pin, title, mode, started_at, question_count, player_count
    FROM game_sessions WHERE owner_id = ? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT 50
`);
export const allSessions = db.prepare(`
    SELECT id, pin, title, mode, started_at, question_count, player_count
    FROM game_sessions WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 50
`);
export const sessionStanding = db.prepare(`
    SELECT name, avatar, score, correct_count, best_streak, place
    FROM session_results WHERE session_id = ? ORDER BY place
`);
export const sessionOwner = db.prepare("SELECT owner_id, host_id, pin, title, mode, started_at, question_count FROM game_sessions WHERE id = ?");
// ข้อไหนคนตอบผิดเยอะ ครูจะได้รู้ว่าต้องกลับไปสอนซ้ำตรงไหน
export const sessionQuestionStats = db.prepare(`
    SELECT question_index, COUNT(*) AS answered, SUM(correct) AS correct
    FROM session_answers WHERE session_id = ? GROUP BY question_index ORDER BY question_index
`);

// แอดมิน: รายชื่อผู้ใช้ทั้งหมด และตัวเลขรวมของระบบ
export const allUsers = db.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY id");
export const adminStats = db.prepare(`
    SELECT (SELECT COUNT(*) FROM users) AS users,
           (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS teachers,
           (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
           (SELECT COUNT(*) FROM quizzes) AS quizzes,
           (SELECT COUNT(*) FROM game_sessions WHERE ended_at IS NOT NULL) AS sessions
`);
export const updateUserRole = db.prepare("UPDATE users SET role = ? WHERE id = ?");
export const countAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
export const deleteQuizByPin = db.prepare("DELETE FROM quizzes WHERE pin = ?");

export const insertUser = db.prepare("INSERT INTO users(email, name, password_hash, role) VALUES (?, ?, ?, ?)");
export const userByEmail = db.prepare("SELECT id, email, name, password_hash, role FROM users WHERE email = ?");
export const userById = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?");
export const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
export const insertSession = db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)");
export const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
export const purgeSessions = db.prepare("DELETE FROM sessions WHERE expires_at < ?");
export const sessionUser = db.prepare(`
    SELECT users.id, users.email, users.name, users.role, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
`);

// สถานะเกมจริงอยู่ในหน่วยความจำ การเขียนลงดิสก์เป็นแค่บันทึกย้อนหลัง
// ถ้าเขียนไม่ได้ (ไฟล์ถูกล็อก ฯลฯ) ต้องไม่ทำให้เกมที่กำลังเล่นอยู่ล้ม
export function persist(statement, ...args) {
    try {
        statement.run(...args);
    } catch (error) {
        console.warn("sqlite write skipped:", error.message);
    }
}

export function createPin() {
    let pin;
    do {
        pin = String(randomInt(100000, 1000000));
    } while (pinExists.get(pin));
    return pin;
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
export function externalizeMedia(slides) {
    let changed = false;
    for (const slide of slides) {
        if (typeof slide?.mediaUrl !== "string" || !slide.mediaUrl.startsWith("data:")) continue;
        slide.mediaUrl = storeDataUrl(slide.mediaUrl);
        changed = true;
    }
    return changed;
}
