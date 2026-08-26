import http from "http";
import { readFile } from "fs/promises";
import { randomUUID, randomInt } from "crypto";
import { WebSocketServer } from "ws";

const PORT = 3000;
const MAX_PLAYERS_PER_ROOM = 50;
const rooms = new Map();

// ชุดคำถามเกี่ยวกับดาวในระบบสุริยะ
const QUESTIONS = [
    [
        "Which planet is known as the Red Planet?",
        ["Mercury", "Mars", "Venus", "Jupiter"],
        1,
        "Mars"
    ],
    [
        "Which planet is the largest in our solar system?",
        ["Saturn", "Jupiter", "Neptune", "Uranus"],
        1,
        "Jupiter"
    ],
    [
        "Which planet is famous for its bright and prominent rings?",
        ["Uranus", "Saturn", "Jupiter", "Neptune"],
        1,
        "Saturn"
    ],
    [
        "Which planet is closest to the Sun?",
        ["Mercury", "Venus", "Earth", "Mars"],
        0,
        "Mercury"
    ],
    [
        "Which is the hottest planet in our solar system?",
        ["Mercury", "Mars", "Venus", "Jupiter"],
        2,
        "Venus"
    ],
    [
        "Which planet is our home and the only known planet to support life?",
        ["Earth", "Mars", "Venus", "Neptune"],
        0,
        "Earth"
    ],
    [
        "Which ice giant planet has the strongest winds in the solar system?",
        ["Uranus", "Neptune", "Saturn", "Jupiter"],
        1,
        "Neptune"
    ],
    [
        "Which planet rotates on its side with an axial tilt of nearly 98 degrees?",
        ["Uranus", "Saturn", "Jupiter", "Neptune"],
        0,
        "Uranus"
    ]
];

// ด่านแผนที่ของ Level 2 — เซิร์ฟเวอร์เป็นผู้ควบคุมลำดับและคำตอบที่ถูกต้อง
const STAGE2_LEVELS = [
    { planet:"Mercury", badge:"Operation Scorched Advance", color:"#888888", timeLimit:12, correctSeq:["down"], optionSeqs:[["up"],["left"],["right"],["down"]], craters:["1,1","2,5","4,1","5,5"] },
    { planet:"Venus", badge:"Operation Acid Descent", color:"#c99a62", timeLimit:10, correctSeq:["down","right"], optionSeqs:[["left","down"],["down","down"],["right","up"],["down","right"]], craters:["1,1","1,5","2,1","5,1","5,5","6,3"] },
    { planet:"Mars", badge:"Operation Rust Frontier", color:"#c74b2b", timeLimit:9, correctSeq:["right","down","right"], optionSeqs:[["right","right","up"],["left","down","down"],["down","down","right"],["right","down","right"]], craters:["0,0","0,6","1,2","2,0","5,0","5,6","6,1","6,5"] },
    { planet:"Jupiter", badge:"Operation Storm Giant", color:"#d7a879", timeLimit:8, correctSeq:["up","right","right","down"], optionSeqs:[["down","down","left","left"],["right","right","right","up"],["left","up","up","right"],["up","right","right","down"]], craters:["0,1","0,3","0,5","1,0","1,6","4,0","4,6","6,0","6,3","6,6"] },
    { planet:"Saturn", badge:"Operation Ring Breaker", color:"#d8bd82", timeLimit:7, correctSeq:["down","down","down","right"], optionSeqs:[["right","right","down","down"],["up","right","right","right"],["left","down","down","down"],["down","down","down","right"]], craters:["0,0","0,2","0,4","0,6","1,3","2,0","2,6","4,6","5,0","5,6","6,0","6,6"] },
    { planet:"Uranus", badge:"Operation Sideways Tilt", color:"#7ddde8", timeLimit:6, correctSeq:["up","up","right","down","right"], optionSeqs:[["down","down","left","up","left"],["right","right","up","up","left"],["left","left","down","down","right"],["up","up","right","down","right"]], craters:["0,0","0,1","0,5","0,6","1,0","1,6","3,0","3,6","4,0","4,6","5,4","6,0","6,2","6,6"] },
    { planet:"Neptune", badge:"Operation Deep Blue", color:"#315dcc", timeLimit:5, correctSeq:["down","right","down","right","up","right"], optionSeqs:[["left","left","up","up","down","down"],["right","up","up","left","down","right"],["down","down","down","left","left","up"],["down","right","down","right","up","right"]], craters:["0,0","0,2","0,4","0,6","1,1","1,5","2,0","2,2","2,6","3,0","3,6","5,0","5,2","6,1","6,3","6,5"] }
];

// ===============================
// COLOR ASSIGNMENT (server-authoritative, no collisions per room)
// ===============================
const COLOR_PALETTE = [
    "#ff4757", // red
    "#2ed573", // green
    "#1e90ff", // blue
    "#ffa502", // orange
    "#a55eea", // purple
    "#ff6b81", // pink
    "#2ecc71", // emerald
    "#00cec9", // teal
    "#f1c40f", // yellow
    "#fd79a8", // rose
];

function isHexColor(str) {
    return typeof str === "string" && /^#[0-9a-fA-F]{6}$/.test(str);
}

// คืนค่าสีที่ "ไม่ซ้ำ" กับผู้เล่นคนอื่นในห้องเดียวกัน
// - ถ้า preferredColor เป็น hex ที่ถูกต้อง และยังไม่มีใครใช้ในห้องนี้ -> ใช้สีนั้น
// - ไม่งั้น -> หยิบสีถัดไปจาก palette ที่ยังไม่มีคนใช้
// - ถ้า palette หมด (ผู้เล่นเกิน 10 คน) -> สุ่มสีใหม่จนกว่าจะไม่ซ้ำ
function assignColor(room, preferredColor, excludePlayerId = null) {
    const used = new Set(
        [...room.players.values()]
            .filter(p => p.id !== excludePlayerId)
            .map(p => p.color)
    );

    if (isHexColor(preferredColor) && !used.has(preferredColor)) {
        return preferredColor;
    }

    const free = COLOR_PALETTE.find(c => !used.has(c));
    if (free) return free;

    // palette หมด: สุ่ม hex สีจนกว่าจะไม่ซ้ำ
    let color;
    do {
        color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    } while (used.has(color));
    return color;
}

// ===============================
// CREATE GAME PIN
// ===============================
function createPin() {
    let pin;
    do {
        pin = String(randomInt(1000, 10000));
    } while (rooms.has(pin));
    return pin;
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
    for (const player of room.players.values()) {
        send(player.ws, type, data);
    }
}

function getPlayers(room) {
    return [...room.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        color: player.color, // เพิ่มส่ง color
        score: player.score,
        host: player.host
    }));
}

// ===============================
// HTTP SERVER
// ===============================
const server = http.createServer(async (req, res) => {
    let path = req.url === "/" ? "/index.html" : req.url;

    try {
        const file = await readFile(new URL("./public" + path, import.meta.url));

        let type = "text/html";
        if (path.endsWith(".js")) type = "text/javascript";
        if (path.endsWith(".css")) type = "text/css";

        res.writeHead(200, { "Content-Type": type });
        res.end(file);
    } catch {
        res.writeHead(404);
        res.end("Not Found");
    }
});

// ===============================
// WEBSOCKET
// ===============================
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    let roomPin = null;
    let playerId = null;

    ws.on("message", raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        // CREATE ROOM
        if (message.type === "CREATE_ROOM") {
            const pin = createPin();
            const id = randomUUID();

            const room = {
                pin,
                phase: "lobby",
                questionIndex: 0,
                answers: new Map(),
                stage2Answers: new Map(),
                stage2Timer: null,
                players: new Map()
            };

            room.players.set(id, {
                id,
                name: message.name?.trim() || "Host",
                color: assignColor(room, message.color), // ห้องใหม่ ยังไม่มีใครใช้สีเลย เลยได้สีตามที่ขอ (ถ้า valid) หรือสีแรกจาก palette
                score: 0,
                host: true,
                ws
            });

            rooms.set(pin, room);
            roomPin = pin;
            playerId = id;

            send(ws, "ROOM_CREATED", { pin, playerId: id });
            sendLobby(room);
            return;
        }

        // JOIN ROOM
        // JOIN ROOM
        if (message.type === "JOIN_ROOM") {
            const pin = String(message.pin);
            const room = rooms.get(pin);

            if (!room) {
                send(ws, "ERROR", { message: "Game PIN not found." });
                return;
            }

            // ค้นหาว่าผู้เล่นชื่อนี้เคยอยู่ในห้องนี้แล้วหรือยัง (กรณีเปลี่ยนหน้ามาจาก Stage 1)
            const inputName = message.name?.trim() || "Player";
            let existingPlayer = [...room.players.values()].find(p => p.name === inputName);

            if (!existingPlayer && room.players.size >= MAX_PLAYERS_PER_ROOM) {
                send(ws, "ERROR", { message: `ห้องเต็มแล้ว (สูงสุด ${MAX_PLAYERS_PER_ROOM} คน)` });
                return;
            }

            let id;
            if (existingPlayer) {
                // ถ้าเป็นผู้เล่นเดิม ให้ใช้ ID และ Score เดิม แล้วอัปเดต ws ตัวใหม่
                id = existingPlayer.id;
                clearTimeout(existingPlayer.disconnectTimer);
                existingPlayer.disconnectTimer = null;
                existingPlayer.ws = ws;
                // หากมีการส่งสีใหม่มา ให้เช็คไม่ให้ชนกับผู้เล่นคนอื่นในห้อง (excludeSelf เพราะเป็นสีของตัวเอง)
                if (message.color) {
                    existingPlayer.color = assignColor(room, message.color, id);
                }
                // กรณีผู้เล่น Reconnect หรือย้ายหน้า ห้ามให้คะแนนที่ต่ำกว่าเดิมเขียนทับคะแนนสะสม
                const incomingScore = Number(message.score);
                if (Number.isFinite(incomingScore) && incomingScore > existingPlayer.score) {
                    existingPlayer.score = incomingScore;
                }
            } else {
                // ถ้าเป็นผู้เล่นใหม่ ให้สร้าง ID ใหม่ และให้เซิร์ฟเวอร์เป็นคนตัดสินสีที่ไม่ชนกับใครในห้อง
                id = randomUUID();
                room.players.set(id, {
                    id,
                    name: inputName,
                    color: assignColor(room, message.color),
                    score: Number(message.score) || 0, // รับคะแนนสะสมต่อเนื่อง
                    host: false,
                    ws
                });
            }

            roomPin = pin;
            playerId = id;

            // ส่งข้อมูลยืนยันพร้อม List รายชื่อผู้เล่น (ที่มี score และ color ล่าสุด) กลับไป
            send(ws, "ROOM_JOINED", { pin, playerId: id });
            sendLobby(room); // ฟังก์ชันนี้จะเรียก getPlayers(room) ซึ่งแปลง Map เป็น Array ให้แล้วแบบปลอดภัย
            if (room.phase === "stage2_question") {
                sendStage2QuestionState(room, ws);
            }
            return;
        }

        
        if (!roomPin) return;
        const room = rooms.get(roomPin);
        if (!room) return;
        const player = room.players.get(playerId);
        if (!player) return;

        // START GAME
        if (message.type === "START_GAME" && player.host) {
            room.phase = "question";
            room.questionIndex = 0;
            room.answers.clear();
            sendQuestion(room);
            return;
        }

        // ANSWER
        if (message.type === "ANSWER" && room.phase === "question") {
            const question = QUESTIONS[room.questionIndex];
            const answer = Number(message.answer);
            const correct = answer === question[2];
            const elapsed = Math.max(0, Number(message.elapsed) || 0);

            const totalTime = 10000;
            const remaining = Math.max(0, totalTime - elapsed);

            let gain = 0;
            if (correct) {
                gain = Math.round(100 + (900 * remaining / totalTime));
            }

            // บันทึก/อัปเดตคำตอบล่าสุด
            room.answers.set(playerId, { answer, correct, gain });

            send(ws, "ANSWER_RESULT", {
                correct,
                gain,
                correctAnswer: question[2],
                answer
            });
            return;
        }

        // START LEVEL 2 — เริ่มด่านเดียวกันให้ผู้เล่นทุกคนพร้อมกัน
        if (message.type === "START_STAGE2" && player.host) {
            room.phase = "stage2_question";
            room.questionIndex = 0;
            sendStage2Question(room);
            return;
        }

        // คำตอบของ Level 2 ตรวจจากเซิร์ฟเวอร์เท่านั้น
        if (message.type === "STAGE2_ANSWER" && room.phase === "stage2_question") {
            const level = STAGE2_LEVELS[room.questionIndex];
            const answer = Number(message.answer);
            if (!Number.isInteger(answer) || answer < 0 || answer >= level.optionSeqs.length) return;
            const elapsed = Math.max(0, Date.now() - room.stage2StartedAt);
            const correct = answer === level.optionSeqs.findIndex(seq => seq.join(",") === level.correctSeq.join(","));
            room.stage2Answers.set(playerId, { answer, correct, elapsed });
            send(ws, "STAGE2_ANSWER_RESULT", { correct, answer });
            return;
        }

        // รับคะแนนสะสมจากด่านต่อเนื่อง เช่น lvl2.html โดยเพิ่มได้อย่างเดียว ห้ามลดคะแนนเดิม
        if (message.type === "UPDATE_SCORE") {
            const nextScore = Number(message.score);
            if (Number.isFinite(nextScore) && nextScore > player.score) {
                player.score = nextScore;
                sendLobby(room);
            }
            return;
        }

        // TIME_UP (รับสัญญาณหมดเวลาจาก Host)
        if (message.type === "TIME_UP" && player.host && room.phase === "question") {
            finishQuestion(room);
            return;
        }

        // NEXT QUESTION / GO TO FINAL
        if (message.type === "NEXT_QUESTION" && player.host) {
            room.questionIndex++;

            // ตรวจสอบหลังจากดูเฉลยและ Leaderboard ของข้อนั้นเรียบร้อยแล้ว
            if (room.questionIndex >= QUESTIONS.length) {
                room.phase = "final";
                broadcast(room, "FINAL", { players: getPlayers(room) });
                return;
            }

            room.phase = "question";
            room.answers.clear();
            sendQuestion(room);
        }
    });

    // DISCONNECT
    ws.on("close", () => {
        if (!roomPin) return;
        const room = rooms.get(roomPin);
        if (!room) return;
        const player = room.players.get(playerId);
        if (!player) return;

        // เผื่อเวลา reconnect ตอนเปลี่ยนจาก index.html ไป lvl2.html
        if (player.ws !== ws) return;
        player.ws = null;
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = setTimeout(() => {
            if (player.ws !== null) return;
            const wasHost = player.host;
            room.players.delete(playerId);

            if (room.players.size === 0) {
                rooms.delete(roomPin);
                return;
            }

            if (wasHost) {
                const next = room.players.values().next().value;
                if (next) {
                    next.host = true;
                    send(next.ws, "HOST_TRANSFERRED");
                }
            }
            sendLobby(room);
        }, 15000);
    });
});

function sendLobby(room) {
    broadcast(room, "ROOM_STATE", {
        pin: room.pin,
        phase: room.phase,
        players: getPlayers(room)
    });
}

function sendQuestion(room) {
    const question = QUESTIONS[room.questionIndex];
    broadcast(room, "QUESTION", {
        index: room.questionIndex,
        total: QUESTIONS.length,
        question: question[0],
        answers: question[1],
        duration: 10000,
        targetPlanet: question[3] || null,
        correctAnswer: question[2]
    });
}

function getStage2Goal(level) {
    let row = 3, col = 3;
    for (const direction of level.correctSeq) {
        if (direction === "up") row--;
        if (direction === "down") row++;
        if (direction === "left") col--;
        if (direction === "right") col++;
    }
    return { row, col };
}

function sendStage2Question(room) {
    const level = STAGE2_LEVELS[room.questionIndex];
    room.stage2Answers.clear();
    room.stage2StartedAt = Date.now();
    broadcast(room, "STAGE2_QUESTION", getStage2QuestionState(room));
    clearTimeout(room.stage2Timer);
    room.stage2Timer = setTimeout(() => finishStage2Question(room), level.timeLimit * 1000);
}

function getStage2QuestionState(room) {
    const level = STAGE2_LEVELS[room.questionIndex];
    return {
        index: room.questionIndex,
        total: STAGE2_LEVELS.length,
        planet: level.planet,
        badge: level.badge,
        color: level.color,
        timeLimit: level.timeLimit,
        optionSeqs: level.optionSeqs,
        craters: level.craters,
        goal: getStage2Goal(level),
        startedAt: room.stage2StartedAt
    };
}

function sendStage2QuestionState(room, ws) {
    send(ws, "STAGE2_QUESTION", getStage2QuestionState(room));
}

function finishStage2Question(room) {
    if (room.phase !== "stage2_question") return;
    const level = STAGE2_LEVELS[room.questionIndex];
    for (const [pId, answer] of room.stage2Answers) {
        const player = room.players.get(pId);
        if (player && answer.correct) {
            const remaining = Math.max(0, level.timeLimit * 1000 - answer.elapsed);
            player.score += Math.round(100 + (900 * remaining / (level.timeLimit * 1000)));
        }
    }

    room.phase = "stage2_leaderboard";
    broadcast(room, "STAGE2_LEADERBOARD", {
        players: getPlayers(room),
        questionIndex: room.questionIndex,
        correctIndex: level.optionSeqs.findIndex(seq => seq.join(",") === level.correctSeq.join(",")),
        isLastQuestion: room.questionIndex >= STAGE2_LEVELS.length - 1
    });

    clearTimeout(room.stage2Timer);
    room.stage2Timer = setTimeout(() => {
        if (room.questionIndex >= STAGE2_LEVELS.length - 1) {
            room.phase = "final";
            broadcast(room, "STAGE2_FINAL", { players: getPlayers(room) });
        } else {
            room.questionIndex++;
            room.phase = "stage2_question";
            sendStage2Question(room);
        }
    }, 5000);
}

function finishQuestion(room) {
    // รวมคะแนนคำตอบล่าสุดของผู้เล่นทุกคน
    for (const [pId, ansData] of room.answers.entries()) {
        const p = room.players.get(pId);
        if (p && ansData.gain > 0) {
            p.score += ansData.gain;
        }
    }

    const isLastQuestion = room.questionIndex >= QUESTIONS.length - 1;

    // ส่งสถานะ LEADERBOARD เสมอ แม้จะเป็นข้อสุดท้าย เพื่อให้แสดงเฉลยคำตอบก่อน
    room.phase = "leaderboard";
    broadcast(room, "LEADERBOARD", {
        players: getPlayers(room),
        questionIndex: room.questionIndex,
        isLastQuestion
    });
}

server.listen(PORT, () => {
    console.log(`Solar System Quiz running on http://localhost:${PORT}`);
});
