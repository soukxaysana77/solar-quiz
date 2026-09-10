// MangosGo — จุดเริ่มของเซิร์ฟเวอร์: ประกอบชิ้นส่วนใน server/ แล้วเปิดพอร์ต
// สถานะเกมทั้งหมดอยู่ในหน่วยความจำและเซิร์ฟเวอร์เป็นคนตัดสิน (คะแนน/เวลา/ลำดับคำถาม)
// SQLite ใช้เก็บชุดคำถามจากหน้า Make และบันทึกผลย้อนหลังเท่านั้น
//
// ลำดับการพึ่งพาของโมดูลไล่จากล่างขึ้นบน ไม่มีวงวน:
//   config -> modes -> db -> rooms -> game -> auth/api/socket
import { PORT } from "./server/config.js";
import { server } from "./server/api.js";
import { attachWebSocket } from "./server/socket.js";

attachWebSocket(server);

server.listen(PORT, () => {
    console.log(`MangosGo running at http://localhost:${PORT}`);
});
