// ระบบสองภาษา ไทย/อังกฤษ ใช้ร่วมกันทุกหน้า
//
// ข้อความคงที่ใน HTML ใส่ data-i18n="key" ไว้ แล้ว KG.i18n.apply() จะเติมให้เอง
// ข้อความที่ JS สร้างเองเรียก KG.i18n.t('key', { ตัวแปร }) ตรง ๆ
// ภาษาที่เลือกถูกจำไว้ใน localStorage ทุกหน้าจึงใช้ภาษาเดียวกันหมด
window.KG = window.KG || {};

KG.i18n = (() => {
    const KEY = 'mangosgo.lang';
    const FALLBACK = 'th';

    const DICT = {
        th: {
            // ---- ทั่วไป ----
            'lang.name': 'ไทย',
            'app.name': 'MangosGo!',
            'common.gamePin': 'GAME PIN',
            'common.players': 'ผู้เล่น: {n}',
            'common.noPin': 'ไม่ได้ระบุ PIN ของเกม',
            'common.reconnecting': 'การเชื่อมต่อหลุด กำลังต่อใหม่...',
            'common.gameOver': 'เกมนี้จบไปแล้ว',
            'error.pinNotFound': 'ไม่พบ PIN นี้',
            'error.nameTaken': 'ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นดูครับ',
            'error.roomFull': 'ห้องเต็มแล้ว (สูงสุด {max} คน)',
            'error.gameOver': 'เกมนี้จบไปแล้ว',
            'error.openedElsewhere': 'เปิดเกมนี้จากที่อื่นแล้ว',
            'error.serverError': 'เซิร์ฟเวอร์มีปัญหา ลองใหม่อีกครั้ง',
            'sound.toggle': 'เปิด/ปิดเสียง',
            'fullscreen.toggle': 'เต็มจอ',
            'lang.toggle': 'เปลี่ยนภาษา',

            // ---- หน้าใส่ PIN ----
            'page.title': 'MangosGo! ใส่ PIN',
            'page.make': '✏️ สร้าง',
            'page.join': '🧩 เข้าร่วม',
            'page.tooltip': 'สร้างเกมสนุก ๆ ได้เอง',
            'page.pinLabel': 'PIN',
            'page.pinPlaceholder': 'ใส่ PIN',
            'page.joinBtn': 'เข้าร่วม',
            'page.connecting': 'กำลังเชื่อมต่อ...',
            'page.pinTooShort': 'PIN ต้องมี 6 หลัก',
            'page.joinFailed': 'เข้าร่วมเกมไม่ได้',
            'page.footer': 'เริ่มใช้งานฟรีที่',
            'page.terms': 'เงื่อนไขการใช้งาน',
            'page.privacy': 'ความเป็นส่วนตัว',
            'page.cookie': 'นโยบายคุกกี้',

            // ---- ล็อบบี้ ----
            'lobby.title': 'MangosGo! ห้องรอ',
            'lobby.nickname': 'ชื่อเล่นของคุณ',
            'lobby.nicknamePlaceholder': 'ตั้งชื่อเลย',
            'lobby.randomName': 'สุ่มชื่อให้หน่อย',
            'lobby.pickAvatar': 'เลือกอวตาร',
            'lobby.enter': 'เข้าห้อง',
            'lobby.waiting': 'อยู่ในห้องแล้ว รอ host กดเริ่มเกม...',
            'lobby.leave': 'ออกจากเกม',
            'lobby.needName': 'ใส่ชื่อเล่นก่อนนะครับ',
            'lobby.preloading': 'กำลังเตรียมรูปคำถาม {done}/{total}',
            'lobby.preloadDone': 'เตรียมรูปครบแล้ว ({total} รูป) พร้อมเล่น',

            // ---- หน้าผู้เล่น ----
            'game.title': 'MangosGo! เล่นเกม',
            'game.waitingQuestion': 'รอคำถาม...',
            'game.progress': 'PIN {pin} · ข้อ {index} จาก {total}',
            'game.locked': 'ล็อกคำตอบแล้ว รอคนอื่น...',
            'game.correct': '✅ ถูกต้อง!',
            'game.wrong': '❌ ยังไม่ใช่',
            'game.timeUp': '⏱ หมดเวลา',
            'game.score': 'คะแนน {score}',
            'game.gain': '+{gain}',
            'game.streakBonus': '(+{bonus} ต่อเนื่อง)',
            'game.rank': 'อันดับ {place} จาก {total}',
            'game.missed': 'ไม่ทันตอบ',
            'game.streak': '🔥 ตอบถูกติดกัน {n}',
            'game.finalRank': '{medal} อันดับ {place} จาก {total}',
            'game.totalScore': 'คะแนนรวม {score}',
            'game.bestStreak': 'ตอบถูกติดกันสูงสุด {n}',
            'game.eliminated': '💀 ตกรอบ',
            'game.eliminatedAt': 'ตกรอบที่ข้อ {index} · ผ่านมาได้ {survived} ข้อ · ดูเกมต่อได้',
            'game.finalEliminated': '💀 ตกรอบ · ผ่านมาได้ {survived} ข้อ',
            'game.holeDistance': '🕳️ ระยะห่างหลุมดำ {lead}',
            'game.sucked': 'หลุมดำดูดไปแล้ว · ดูเกมต่อได้',
            'game.finalSucked': '🕳️ หลุมดำดูดไป · หนีมาได้ {survived} ข้อ',
            'game.finalSurvived': '🚀 รอดจากหลุมดำ · เหลือระยะ {lead}',

            // ---- จอ host ----
            'host.title': 'MangosGo! จอใหญ่',
            'host.back': '← กลับไปหน้าสร้าง',
            'host.loading': 'กำลังโหลดเกม...',
            'host.pickMode': 'เลือกโหมดเกม',
            'host.start': 'เริ่มเกม',
            'host.noPin': 'ไม่ได้ระบุ PIN ของเกม',
            'host.waitingPlayers': 'รอผู้เล่น',
            'host.questionCount': '{n} ข้อ',
            'host.questionOf': 'ข้อ {index} จาก {total}',
            'host.timeUp': 'หมดเวลา',
            'host.answered': 'ตอบแล้ว {answered} / {total}',
            'host.nextIn': 'ข้อถัดไปใน {n} วิ',
            'host.resultIn': 'สรุปผลใน {n} วิ',
            'host.finished': '🏆 จบเกมแล้ว',
            'host.thanks': 'ขอบคุณที่ร่วมสนุก!',
            'host.answer': 'เฉลย:',
            'host.aliveAll': 'ยังหนีกันครบ {alive} คน',
            'host.aliveSome': 'โดนดูดไปแล้ว {gone} คน · ยังหนีอยู่ {alive} คน',
            'host.survivalAll': 'ยังอยู่ครบ {alive} คน',
            'host.survivalSome': 'ตกรอบแล้ว {out} คน · เหลือ {alive} คน',

            // ---- หน้าสร้างคำถาม ----
            'make.title': 'MangosGo! สร้างชุดคำถาม',
            'make.brand': 'MangosGo! สตูดิโอ',
            'make.themes': 'ธีม',
            'make.settings': 'ตั้งค่า',
            'make.save': 'บันทึก',
            'make.exit': 'ออก',
            'make.host': 'เปิดจอใหญ่',
            'make.question': 'คำถาม',
            'make.delete': 'ลบ',
            'make.duplicate': 'ทำสำเนา',
            'make.add': '+ เพิ่ม',
            'make.create': '+ สร้าง',
            'make.properties': 'ตั้งค่าคำถาม',
            'make.applyAll': 'ใช้กับทุกข้อ',
            'make.findMedia': 'เลือกหรือใส่รูป',
            'make.uploadFile': 'อัปโหลดไฟล์',
            'make.dragHere': ' หรือลากไฟล์มาวางตรงนี้',
            'make.pickCorrect': 'คลิกการ์ดคำตอบเพื่อเลือกคำตอบที่ถูกต้อง',
            'make.greenIsCorrect': 'กรอบเขียว = คำตอบถูก',
            'make.questionType': '🔄 ชนิดคำถาม',
            'make.timeLimit': '⏱️ เวลาต่อข้อ',
            'make.points': '🏅 คะแนน',
            'make.answerOptions': '⠶ รูปแบบคำตอบ',
            'make.titlePlaceholder': 'ตั้งชื่อชุดคำถาม...',
            'make.questionPlaceholder': 'พิมพ์คำถามของคุณ',
            'make.answer1': 'คำตอบที่ 1',
            'make.answer2': 'คำตอบที่ 2',
            'make.answer3': 'คำตอบที่ 3 (ไม่บังคับ)',
            'make.answer4': 'คำตอบที่ 4 (ไม่บังคับ)',

            // ---- ชื่อโหมด (จอผู้เล่นใช้ ส่วนจอ host ใช้ชื่อที่เซิร์ฟเวอร์ส่งมา) ----
            'mode.classic': 'คลาสสิก',
            'mode.accuracy': 'แม่นยำ',
            'mode.survival': 'ตกรอบ',
            'mode.blackhole': 'หนีหลุมดำ',
            'mode.rush': 'เร่งรีบ',

            // ---- ฉากหนีหลุมดำ ----
            'run.distance': 'ระยะ {lead}',
            'run.gone': 'โดนดูดแล้ว'
        },

        en: {
            'lang.name': 'EN',
            'app.name': 'MangosGo!',
            'common.gamePin': 'GAME PIN',
            'common.players': 'Players: {n}',
            'common.noPin': 'No game PIN supplied.',
            'common.reconnecting': 'Connection lost. Reconnecting...',
            'common.gameOver': 'This game has already ended.',
            'error.pinNotFound': 'Game PIN not found.',
            'error.nameTaken': 'That nickname is taken — try another one.',
            'error.roomFull': 'Room is full (max {max} players).',
            'error.gameOver': 'This game has already ended.',
            'error.openedElsewhere': 'This game was opened somewhere else.',
            'error.serverError': 'Server error. Please try again.',
            'sound.toggle': 'Sound on/off',
            'fullscreen.toggle': 'Fullscreen',
            'lang.toggle': 'Change language',

            'page.title': 'MangosGo! Enter PIN',
            'page.make': '✏️ Make',
            'page.join': '🧩 Join',
            'page.tooltip': 'Engaging content',
            'page.pinLabel': 'PIN',
            'page.pinPlaceholder': 'Enter PIN',
            'page.joinBtn': 'Join',
            'page.connecting': 'Connecting...',
            'page.pinTooShort': 'PIN must contain 6 digits.',
            'page.joinFailed': 'Unable to join game.',
            'page.footer': 'Get started for FREE at',
            'page.terms': 'Terms',
            'page.privacy': 'Privacy',
            'page.cookie': 'Cookie notice',

            'lobby.title': 'MangosGo! Lobby',
            'lobby.nickname': 'Your nickname',
            'lobby.nicknamePlaceholder': 'Pick a name',
            'lobby.randomName': 'Random name',
            'lobby.pickAvatar': 'Pick your pilot',
            'lobby.enter': 'Join game',
            'lobby.waiting': "You're in! Waiting for the host to start...",
            'lobby.leave': 'Leave game',
            'lobby.needName': 'Please enter a nickname first',
            'lobby.preloading': 'Loading question images {done}/{total}',
            'lobby.preloadDone': 'All {total} images ready — good to go',

            'game.title': 'MangosGo! Game',
            'game.waitingQuestion': 'Waiting for question...',
            'game.progress': 'PIN {pin} · Question {index} of {total}',
            'game.locked': 'Answer locked — waiting for others...',
            'game.correct': '✅ Correct!',
            'game.wrong': '❌ Not quite',
            'game.timeUp': "⏱ Time's up",
            'game.score': 'Score {score}',
            'game.gain': '+{gain}',
            'game.streakBonus': '(+{bonus} streak)',
            'game.rank': 'Rank {place} of {total}',
            'game.missed': 'No answer',
            'game.streak': '🔥 {n} in a row',
            'game.finalRank': '{medal} Rank {place} of {total}',
            'game.totalScore': 'Total score {score}',
            'game.bestStreak': 'Best streak {n}',
            'game.eliminated': '💀 Eliminated',
            'game.eliminatedAt': 'Out on question {index} · survived {survived} · you can keep watching',
            'game.finalEliminated': '💀 Eliminated · survived {survived} questions',
            'game.holeDistance': '🕳️ Distance from black hole {lead}',
            'game.sucked': 'Sucked into the black hole · you can keep watching',
            'game.finalSucked': '🕳️ Sucked in · escaped {survived} questions',
            'game.finalSurvived': '🚀 Escaped the black hole · distance {lead}',

            'host.title': 'MangosGo! Host',
            'host.back': '← Back to editor',
            'host.loading': 'Loading game...',
            'host.pickMode': 'Choose a game mode',
            'host.start': 'Start game',
            'host.noPin': 'No game PIN was supplied.',
            'host.waitingPlayers': 'Waiting for players',
            'host.questionCount': '{n} question(s)',
            'host.questionOf': 'Question {index} of {total}',
            'host.timeUp': "Time's up",
            'host.answered': 'Answered: {answered} / {total}',
            'host.nextIn': 'Next question in {n}s',
            'host.resultIn': 'Results in {n}s',
            'host.finished': '🏆 Game finished',
            'host.thanks': 'Thanks for playing!',
            'host.answer': 'Answer:',
            'host.aliveAll': 'All {alive} still running',
            'host.aliveSome': '{gone} sucked in · {alive} still running',
            'host.survivalAll': 'All {alive} still in',
            'host.survivalSome': '{out} eliminated · {alive} left',

            'make.title': 'MangosGo! Creator',
            'make.brand': 'MangosGo! Creator Studio',
            'make.themes': 'Themes',
            'make.settings': 'Settings',
            'make.save': 'Save',
            'make.exit': 'Exit',
            'make.host': 'Host',
            'make.question': 'Question',
            'make.delete': 'Delete',
            'make.duplicate': 'Duplicate',
            'make.add': '+ Add',
            'make.create': '+ Create',
            'make.properties': 'Question properties',
            'make.applyAll': 'Apply to all questions',
            'make.findMedia': 'Find and insert media',
            'make.uploadFile': 'Upload file',
            'make.dragHere': ' or drag here to upload',
            'make.pickCorrect': 'Click an answer card to mark the correct one',
            'make.greenIsCorrect': 'Green border = correct answer',
            'make.questionType': '🔄 Question type',
            'make.timeLimit': '⏱️ Time limit',
            'make.points': '🏅 Points',
            'make.answerOptions': '⠶ Answer options',
            'make.titlePlaceholder': 'Enter quiz title...',
            'make.questionPlaceholder': 'Start typing your question',
            'make.answer1': 'Add answer 1',
            'make.answer2': 'Add answer 2',
            'make.answer3': 'Add answer 3 (optional)',
            'make.answer4': 'Add answer 4 (optional)',

            'mode.classic': 'Classic',
            'mode.accuracy': 'Accuracy',
            'mode.survival': 'Survival',
            'mode.blackhole': 'Black Hole Run',
            'mode.rush': 'Rush',

            'run.distance': 'Distance {lead}',
            'run.gone': 'Sucked in'
        }
    };

    let lang = FALLBACK;
    try {
        const saved = localStorage.getItem(KEY);
        if (saved && DICT[saved]) lang = saved;
    } catch { /* โหมดส่วนตัวอ่านไม่ได้ ใช้ค่าเริ่มต้น */ }

    const listeners = new Set();

    function t(key, vars) {
        const text = DICT[lang]?.[key] ?? DICT[FALLBACK]?.[key] ?? key;
        if (!vars) return text;
        return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
    }

    // เติมข้อความให้ element ที่ติด data-i18n ไว้
    // data-i18n-attr="placeholder,title" ใช้เวลาต้องแปลค่าใน attribute แทนข้อความข้างใน
    function apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.dataset.i18n;
            const attrs = node.dataset.i18nAttr;
            if (attrs) attrs.split(',').forEach(attr => node.setAttribute(attr.trim(), t(key)));
            else node.textContent = t(key);
        });
        const titleKey = document.documentElement.dataset.i18nTitle;
        if (titleKey) document.title = t(titleKey);
        document.documentElement.lang = lang;
    }

    function setLang(next) {
        if (!DICT[next] || next === lang) return;
        lang = next;
        try { localStorage.setItem(KEY, next); } catch { /* เขียนไม่ได้ก็ใช้ได้แค่หน้านี้ */ }
        apply();
        listeners.forEach(fn => fn(lang));
    }

    // ปุ่มสลับภาษา วางมุมขวาบนคู่กับปุ่มเสียง
    function mountToggle() {
        const button = document.createElement('button');
        button.className = 'lang-toggle';
        button.type = 'button';
        const paint = () => {
            button.textContent = `🌐 ${t('lang.name')}`;
            button.title = t('lang.toggle');
        };
        button.onclick = () => setLang(lang === 'th' ? 'en' : 'th');
        listeners.add(paint);
        paint();
        document.body.appendChild(button);
        return button;
    }

    return {
        t,
        apply,
        setLang,
        mountToggle,
        get lang() { return lang; },
        // หน้าไหนมีข้อความที่ JS สร้างเอง ให้ลงทะเบียนวาดใหม่ตอนเปลี่ยนภาษา
        onChange(fn) { listeners.add(fn); return fn; }
    };
})();
