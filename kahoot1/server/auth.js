// ===============================
// AUTH — รหัสผ่าน / คุกกี้ / session
// ===============================
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./config.js";
import { deleteSession, insertSession, persist, purgeSessions, sessionUser } from "./db.js";

// scrypt มากับ Node ไม่ต้องลงไลบรารีเพิ่ม เก็บ salt ไว้ในสตริงเดียวกับ hash
export function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password, stored) {
    const [algo, salt, hash] = String(stored || "").split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const want = Buffer.from(hash, "hex");
    const got = scryptSync(password, salt, 64);
    // เทียบแบบเวลาคงที่ ไม่ให้เดารหัสจากเวลาที่ใช้ตอบ
    return got.length === want.length && timingSafeEqual(got, want);
}

export function readCookies(req) {
    const jar = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
        const at = part.indexOf("=");
        if (at < 1) continue;
        jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    }
    return jar;
}

// HttpOnly กัน JS ในหน้าเว็บอ่านโทเคน SameSite=Lax กันถูกยิงข้ามเว็บ
export function setSessionCookie(res, token, maxAgeSeconds) {
    const bits = [
        `${SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`
    ];
    res.setHeader("Set-Cookie", bits.join("; "));
}

export function startSession(res, userId) {
    const token = randomBytes(32).toString("hex");
    persist(purgeSessions, Date.now());
    insertSession.run(token, userId, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
    return token;
}

// คืนผู้ใช้ที่ล็อกอินอยู่ หรือ null ถ้าไม่มี/หมดอายุ
export function currentUser(req) {
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

export const canAuthor = user => user?.role === "teacher" || user?.role === "admin";

export const publicUser = user => (user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null);
