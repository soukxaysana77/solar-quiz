document.addEventListener('DOMContentLoaded', async () => {
    const pin = new URLSearchParams(location.search).get('pin') || sessionStorage.getItem('mangosgo.activePin');
    const el = {
        pin: document.querySelector('#pin'),
        joinView: document.querySelector('#join-view'),
        nickname: document.querySelector('#nickname'),
        dice: document.querySelector('#dice'),
        avatars: document.querySelector('#avatars'),
        enter: document.querySelector('#enter'),
        joinError: document.querySelector('#join-error'),
        status: document.querySelector('.status')
    };

    const t = KG.i18n.t;
    KG.i18n.apply();
    KG.i18n.mountToggle();

    // ข้อความที่ JS เขียนเอง จำวิธีวาดไว้เพื่อวาดใหม่ตอนสลับภาษา
    // ต้องถอด data-i18n ทิ้งด้วย ไม่งั้น apply() จะเขียนทับกลับเป็นข้อความตั้งต้น
    const redraws = new Map();
    const setText = (node, draw) => {
        delete node.dataset.i18n;
        if (draw) { redraws.set(node, draw); node.textContent = draw(); }
        else { redraws.delete(node); node.textContent = ''; }
    };

    // ต้องลงทะเบียนตรงนี้ ก่อนโค้ดที่ return ออกไปตอนไม่มี PIN
    // ไม่งั้นหน้าที่จบด้วย return จะไม่มีตัวฟังการสลับภาษาเลย
    KG.i18n.onChange(() => {
        redraws.forEach((draw, node) => { node.textContent = draw(); });
    });

    el.pin.textContent = pin || '------';
    if (!pin) { el.joinView.hidden = true; setText(el.status, () => t('common.noPin')); return; }
    sessionStorage.setItem('mangosgo.activePin', pin);

    KG.sound.mountToggle();

    // ------- avatar picker -------
    let avatarIndex = Number(localStorage.getItem('mangosgo.avatar'));
    if (!Number.isInteger(avatarIndex) || avatarIndex < 0) avatarIndex = 0;

    const avatars = await fetch('/api/avatars').then(r => r.json()).then(d => d.avatars).catch(() => ['#ffffff']);
    const paintAvatars = () => {
        el.avatars.innerHTML = '';
        avatars.forEach((color, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.innerHTML = KG.avatar.markup(color, 42);
            button.setAttribute('aria-pressed', String(index === avatarIndex));
            button.onclick = () => { avatarIndex = index; KG.sound.unlock(); KG.sound.join(); paintAvatars(); };
            el.avatars.appendChild(button);
        });
    };
    paintAvatars();

    el.nickname.value = localStorage.getItem('mangosgo.player') || KG.nickname.random();
    el.dice.onclick = () => { el.nickname.value = KG.nickname.random(); KG.sound.unlock(); KG.sound.join(); };

    // ------- websocket -------
    const idKey = `mangosgo.playerId.${pin}`;
    let socket = null;
    let joined = false;

    // เซิร์ฟเวอร์ส่ง code มา ฝั่งนี้แปลเอง จะได้เปลี่ยนภาษาได้โดยไม่ต้องต่อใหม่
    const errorText = (msg) => (msg.code ? t(`error.${msg.code}`, { max: msg.max }) : msg.message);

    const goToGame = () => { KG.sound.stopMusic(); location.href = `../game/?pin=${encodeURIComponent(pin)}`; };

    const connect = (payload) => {
        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'JOIN_ROOM', ...payload }));
        socket.onclose = () => { if (joined) setTimeout(() => connect(payload), 2000); };
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'ERROR') {
                // ยังไม่ได้เข้าห้อง = ชื่อชนหรือ PIN ผิด ให้กลับไปแก้ที่ฟอร์ม
                if (!joined) {
                    setText(el.joinError, () => errorText(msg));
                    el.enter.disabled = false;
                    socket.onclose = null;
                    socket.close();
                } else {
                    setText(el.status, () => errorText(msg));
                }
                return;
            }

            // เข้าห้องได้แล้วก็ย้ายไปหน้าเล่นเลย ไปนั่งรือ host กดเริ่มที่นั่นแทน
            // (ที่นั่นจะ JOIN_ROOM ด้วย playerId เดิม คะแนนไม่หาย) จะได้ไม่ต้องโหลดหน้าใหม่
            // ตอนคำถามมาถึง ซึ่งกินเวลาของนาฬิกาที่เดินอยู่แล้วไปหลายวินาทีเมื่อเซิร์ฟเวอร์ช้า
            if (msg.type === 'JOINED') {
                joined = true;
                localStorage.setItem('mangosgo.player', msg.name);
                localStorage.setItem('mangosgo.avatar', String(avatarIndex));
                sessionStorage.setItem(idKey, msg.playerId);
                goToGame();
                return;
            }

            if (msg.type === 'FINAL') setText(el.status, () => t('common.gameOver'));
        };
    };

    el.enter.onclick = () => {
        const name = el.nickname.value.trim().slice(0, 40);
        if (!name) { setText(el.joinError, () => t('lobby.needName')); return; }
        setText(el.joinError, null);
        el.enter.disabled = true;
        KG.sound.unlock();
        connect({ pin, name, avatar: avatarIndex });
    };

    el.nickname.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.enter.click(); });


    // เคยเข้าห้องนี้ไปแล้วใน session นี้ (เช่นกดรีเฟรช) ก็ต่อกลับเลย ไม่ต้องเลือกใหม่
    const savedId = sessionStorage.getItem(idKey);
    if (savedId) {
        el.enter.disabled = true;
        connect({ pin, name: localStorage.getItem('mangosgo.player') || 'Player', avatar: avatarIndex, playerId: savedId });
    }
});
