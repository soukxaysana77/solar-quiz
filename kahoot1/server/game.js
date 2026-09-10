// ===============================
// GAME FLOW
// ===============================
// วงจรหนึ่งข้อ: sendQuestion -> (หมดเวลา) finishQuestion -> (ค้างหน้าเฉลย) nextQuestion -> ข้อถัดไปหรือจบเกม
// เซิร์ฟเวอร์เดินเองด้วย timer ทั้งหมด host ไม่ต้องกดอะไรระหว่างเล่น
import { BLACKHOLE_MAX_LEAD, LEADERBOARD_HOLD_MS } from "./config.js";
import {
    finishSessionRow, insertResult, insertSessionRow, persist, quizOwner, updateProgress
} from "./db.js";
import { modeOf } from "./modes.js";
import { broadcast, broadcastHosts, countAlive, getPlayers, send } from "./rooms.js";

// โหมดที่บีบเวลา (เช่น Rush) ใช้เวลาของโหมดแทนเวลาที่ตั้งไว้ในสไลด์
export function questionDuration(room) {
    return modeOf(room).duration || room.slides[room.questionIndex].duration;
}

export function questionPayload(room) {
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

export function sendQuestion(room) {
    room.phase = "question";
    room.answers.clear();
    room.questionStartedAt = Date.now();
    persist(updateProgress, "started", room.questionIndex, room.questionStartedAt / 1000, room.pin);

    broadcast(room, "QUESTION", questionPayload(room));
    broadcastHosts(room, "ANSWER_COUNT", { answered: 0, total: room.players.size });

    clearTimeout(room.questionTimer);
    room.questionTimer = setTimeout(() => finishQuestion(room), questionDuration(room));
}

export function finishQuestion(room) {
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

// โหมดที่มีการตกรอบบอกไว้ว่าเหลือคนเท่าไหร่ถึงไม่ต้องถามต่อ
// survival เหลือคนเดียวก็รู้ผลแล้ว ส่วนหลุมดำต้องโดนดูดหมดห้องถึงจบ
function isSurvivalOver(room) {
    const limit = modeOf(room).endWhenAlive;
    return limit !== undefined && countAlive(room) <= limit;
}

// เปิดรอบใหม่: จำว่าใครเป็นคนกดเริ่ม เล่นชุดไหน โหมดอะไร
export function openSession(room, hostUser) {
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

export function personalResult(player, record) {
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

// ส่งหน้าเฉลยให้คนที่เพิ่งต่อเข้ามากลางช่วงเฉลย (นับเวลาที่เหลือจริงให้ด้วย)
export function sendLeaderboardTo(ws, room) {
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
