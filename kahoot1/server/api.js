// ===============================
// HTTP SERVER — เสิร์ฟไฟล์หน้าเว็บ + REST เล็กน้อย
// ===============================
import http from "http";
import { readFile } from "fs/promises";
import { statSync } from "fs";
import { extname, join, resolve, sep } from "path";
import { AVATARS, MIN_PASSWORD_LENGTH, ROLES, ROOT, SESSION_COOKIE, SIGNUP_ROLES } from "./config.js";
import {
    adminStats, allQuizzes, allSessions, allUsers, countAdmins, countUsers, createPin, deleteQuizByPin,
    deleteSession, externalizeMedia, insertQuiz, insertUser, persist, quizOwner, selectQuiz,
    sessionOwner, sessionQuestionStats, sessionStanding, studentHistory, studentStats,
    teacherQuizzes, teacherSessions, updateUserRole, userByEmail, userById
} from "./db.js";
import {
    canAuthor, currentUser, hashPassword, publicUser, readCookies, setSessionCookie, startSession, verifyPassword
} from "./auth.js";
import { rooms } from "./rooms.js";

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
        sessions: (isAdmin ? allSessions.all() : teacherSessions.all(user.id)).map(row => ({
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

export const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "POST") return handlePost(req, res, url.pathname);
    if (req.method === "GET") return handleGet(req, res, url);
    res.writeHead(405);
    res.end("Method Not Allowed");
});
