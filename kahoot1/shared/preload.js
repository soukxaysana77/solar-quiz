// โหลดรูปคำถามดักไว้ตั้งแต่ตอนรออยู่ในล็อบบี้ พอเกมเริ่มรูปอยู่ในแคชเบราว์เซอร์แล้ว
// ไฟล์ใน /uploads/ ตั้งชื่อเป็น hash และส่งมาพร้อม Cache-Control: immutable
// เบราว์เซอร์จึงใช้ของในแคชต่อได้ข้ามหน้า ตอนย้ายจาก /lobby/ ไป /game/
window.KG = window.KG || {};

KG.preload = (urls, onProgress) => {
    const list = (urls || []).filter(url => typeof url === 'string' && url.startsWith('/uploads/'));
    if (!list.length) {
        onProgress?.(0, 0);
        return Promise.resolve(0);
    }

    let done = 0;
    onProgress?.(0, list.length);

    return Promise.all(list.map(url => new Promise((resolve) => {
        const img = new Image();
        // โหลดไม่ขึ้นก็ไม่ควรค้างล็อบบี้ไว้ ปล่อยผ่านแล้วไปโหลดใหม่ตอนขึ้นคำถามจริง
        const finish = () => { done++; onProgress?.(done, list.length); resolve(); };
        img.onload = finish;
        img.onerror = finish;
        img.src = url;
    }))).then(() => done);
};
