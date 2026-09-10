// ค่าคงที่ทั้งระบบรวมไว้ที่เดียว ไฟล์นี้ไม่ import ใครเลย จึงเป็นชั้นล่างสุดที่ไฟล์อื่นดึงไปใช้ได้หมด
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ไฟล์นี้อยู่ในโฟลเดอร์ server/ แต่ ROOT ต้องชี้ที่รากโปรเจกต์ (ที่เก็บ page/ host/ game/ ฯลฯ)
// ถ้าลืม ".." การเสิร์ฟไฟล์หน้าเว็บจะหาไม่เจอทั้งหมด
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ตั้ง DB_PATH ได้ตอนรัน เอาไว้ทดสอบด้วยฐานข้อมูลเปล่าโดยไม่แตะของจริง
export const DB_PATH = process.env.DB_PATH || join(ROOT, "mangosgo.sqlite3");
export const PORT = Number(process.env.PORT) || 8000;

export const MAX_PLAYERS_PER_ROOM = 50;
// ชื่อเล่นสั้น ๆ อ่านง่ายบนจอใหญ่และไม่ล้นป้ายชื่อใต้อวตาร (ฝั่งหน้าเว็บจำกัดไว้เท่ากันที่ lobby)
export const MAX_NICKNAME_LENGTH = 10;
export const RECONNECT_GRACE_MS = 15000;
export const DEFAULT_TIME_LIMIT = 20;
// ค้างหน้าเฉลย + อันดับไว้เท่านี้ แล้วเซิร์ฟเวอร์พาไปข้อถัดไปเอง ไม่ต้องรอ host กดปุ่ม
export const LEADERBOARD_HOLD_MS = 6000;
// ปิดไว้: ต่อให้ทุกคนตอบครบก็ยังเดินครบเวลา
// ผู้เล่นจะได้เห็นจอ "รอคนอื่น" จริง ๆ ไม่ใช่เฉลยแวบเดียวจบ เปลี่ยนเป็น true ถ้าอยากได้แบบตัดจบเร็ว
export const END_WHEN_ALL_ANSWERED = false;

// ===============================
// บัญชีผู้ใช้และสิทธิ์
// ===============================
// student = เข้าเล่นเกมและดูประวัติของตัวเอง
// teacher = สร้าง/แก้ชุดคำถามและเปิดห้องเล่น
// admin   = ทำได้ทุกอย่าง คนที่สมัครเป็นคนแรกของระบบจะได้สิทธิ์นี้อัตโนมัติ
export const ROLES = ["student", "teacher", "admin"];
// role ที่ผู้ใช้เลือกเองตอนสมัครได้ admin ต้องถูกตั้งให้เท่านั้น
export const SIGNUP_ROLES = ["student", "teacher"];
export const SESSION_COOKIE = "mangosgo_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

// รูปในคำถามถูกดึงออกมาเก็บเป็นไฟล์ที่นี่ แทนการฝังเป็น data URL ไปกับทุก broadcast
export const UPLOADS_DIR = join(ROOT, "uploads");
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MEDIA_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg"
};

// ตอบถูกติดกันได้โบนัสเพิ่มขึ้นเรื่อย ๆ ข้อที่ 2 ของ streak ได้ 100 ไล่ขึ้นไปจนตัน 500
export const STREAK_BONUS_STEP = 100;
export const STREAK_BONUS_MAX = 500;

// ระยะห่างจากหลุมดำ เริ่มที่ 5 ตอบถูกได้เพิ่ม ตอบไม่ได้ลด แตะ 0 เมื่อไหร่โดนดูด
export const BLACKHOLE_START_LEAD = 5;
export const BLACKHOLE_MAX_LEAD = 10;
// ตอบถูกภายในหนึ่งในสี่แรกของเวลา ถือว่าเร่งเครื่องหนี ได้ระยะสองช่วง
export const BLACKHOLE_FAST_RATIO = 0.25;

// อวตารเป็นนักบินอวกาศตัวเดียวกันหมด ต่างกันแค่สีชุด
// ฝั่ง client ส่งมาแค่ index เซิร์ฟเวอร์เป็นคนแปลงเป็นสี กันไม่ให้ยัดค่าอะไรก็ได้เข้าห้อง
export const AVATARS = [
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

export function pickAvatar(index) {
    return AVATARS[Number.isInteger(index) && index >= 0 && index < AVATARS.length ? index : 0];
}
