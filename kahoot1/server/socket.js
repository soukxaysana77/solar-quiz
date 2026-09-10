// ===============================
// WEBSOCKET — ข้อความทั้งหมดระหว่างจอ host / มือถือผู้เล่น กับเซิร์ฟเวอร์
// ===============================
import { randomUUID } from "crypto";
import { WebSocketServer } from "ws";
import {
    BLACKHOLE_FAST_RATIO, BLACKHOLE_MAX_LEAD, BLACKHOLE_START_LEAD, END_WHEN_ALL_ANSWERED,
    MAX_NICKNAME_LENGTH, MAX_PLAYERS_PER_ROOM, RECONNECT_GRACE_MS, pickAvatar
} from "./config.js";
import { insertSessionAnswer, persist, saveAnswer, upsertPlayer } from "./db.js";
import { canAuthor, currentUser } from "./auth.js";
import { DEFAULT_MODE, MODES, modeCatalog, modeOf, streakBonus } from "./modes.js";
import {
    broadcastHosts, countActivePlayers, getPlayers, loadRoom, roomMedia, rooms, send, sendLobby
} from "./rooms.js";
import {
    finishQuestion, openSession, personalResult, questionDuration, questionPayload,
    sendLeaderboardTo, sendQuestion
} from "./game.js";

export function attachWebSocket(server) {
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

    return wss;
}
