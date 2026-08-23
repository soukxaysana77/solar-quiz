import http from "http";
import { readFile } from "fs/promises";
import { randomUUID, randomInt } from "crypto";
import { WebSocketServer } from "ws";

const PORT = 3000;
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
    if (ws.readyState === 1) {
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
                players: new Map()
            };

            room.players.set(id, {
                id,
                name: message.name?.trim() || "Host",
                color: message.color || "#ffffff", // บันทึกสี
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
        if (message.type === "JOIN_ROOM") {
            const pin = String(message.pin);
            const room = rooms.get(pin);

            if (!room) {
                send(ws, "ERROR", { message: "Game PIN not found." });
                return;
            }

            if (room.phase !== "lobby") {
                send(ws, "ERROR", { message: "Game already started." });
                return;
            }

            const id = randomUUID();

            room.players.set(id, {
                id,
                name: message.name?.trim() || "Player",
                color: message.color || "#ffffff", // บันทึกสี
                score: 0,
                host: false,
                ws
            });

            roomPin = pin;
            playerId = id;

            send(ws, "ROOM_JOINED", { pin, playerId: id });
            sendLobby(room);
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
