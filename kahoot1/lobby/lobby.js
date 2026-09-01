document.addEventListener('DOMContentLoaded', async () => {
    const pin = new URLSearchParams(location.search).get('pin') || sessionStorage.getItem('mangosgo.activePin');
    const el = {
        pin: document.querySelector('#pin'),
        joinView: document.querySelector('#join-view'),
        waitView: document.querySelector('#wait-view'),
        nickname: document.querySelector('#nickname'),
        dice: document.querySelector('#dice'),
        avatars: document.querySelector('#avatars'),
        enter: document.querySelector('#enter'),
        joinError: document.querySelector('#join-error'),
        me: document.querySelector('#me'),
        preload: document.querySelector('#preload'),
        playerCount: document.querySelector('#player-count'),
        players: document.querySelector('#players'),
        status: document.querySelector('.status')
    };

    const t = KG.i18n.t;
    KG.i18n.apply();
    KG.i18n.mountToggle();

    el.pin.textContent = pin || '------';
    if (!pin) { el.joinView.hidden = true; el.status.textContent = t('common.noPin'); return; }
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

    const showWaiting = (msg) => {
        joined = true;
        el.joinView.hidden = true;
        el.waitView.hidden = false;
        el.me.innerHTML = '';
        const avatar = KG.avatar.el(msg.avatar, 44);
        avatar.classList.add('avatar-float');
        const name = document.createElement('span');
        name.textContent = msg.name;
        el.me.append(avatar, name);
        KG.sound.join();
        KG.sound.startMusic();
    };

    let lastPlayers = [];

    const renderPlayers = (players) => {
        lastPlayers = players;
        el.playerCount.textContent = t('common.players', { n: players.length });
        el.players.innerHTML = '';
        players.forEach((player) => {
            const li = document.createElement('li');
            li.className = player.connected ? 'player-chip' : 'player-chip is-away';
            const avatar = KG.avatar.el(player.avatar, 24);
            const name = document.createElement('span');
            name.textContent = player.name;
            li.append(avatar, name);
            el.players.appendChild(li);
        });
    };

    const connect = (payload) => {
        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'JOIN_ROOM', ...payload }));
        socket.onclose = () => { if (joined) setTimeout(() => connect(payload), 2000); };
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'ERROR') {
                // ยังไม่ได้เข้าห้อง = ชื่อชนหรือ PIN ผิด ให้กลับไปแก้ที่ฟอร์ม
                if (!joined) {
                    el.joinError.textContent = errorText(msg);
                    el.enter.disabled = false;
                    socket.onclose = null;
                    socket.close();
                } else {
                    el.status.textContent = errorText(msg);
                }
                return;
            }

            if (msg.type === 'JOINED') {
                localStorage.setItem('mangosgo.player', msg.name);
                localStorage.setItem('mangosgo.avatar', String(avatarIndex));
                sessionStorage.setItem(idKey, msg.playerId);
                showWaiting(msg);
                // ใช้เวลาที่นั่งรอ host โหลดรูปคำถามเก็บไว้ในแคชให้หมดก่อน
                KG.preload(msg.media, (done, total) => {
                    if (!total) { el.preload.textContent = ''; return; }
                    el.preload.textContent = done < total
                        ? t('lobby.preloading', { done, total })
                        : t('lobby.preloadDone', { total });
                });
                return;
            }

            if (msg.type === 'ROOM_STATE') {
                renderPlayers(msg.players);
                if (msg.phase === 'question' || msg.phase === 'leaderboard') goToGame();
                else if (msg.phase === 'final') el.status.textContent = t('common.gameOver');
                return;
            }

            // เกมเริ่มแล้ว ย้ายไปหน้าเล่นทันที (ที่นั่นจะ JOIN_ROOM ด้วย playerId เดิม คะแนนไม่หาย)
            if (msg.type === 'QUESTION' || msg.type === 'LEADERBOARD') goToGame();
            else if (msg.type === 'FINAL') el.status.textContent = t('common.gameOver');
        };
    };

    el.enter.onclick = () => {
        const name = el.nickname.value.trim().slice(0, 40);
        if (!name) { el.joinError.textContent = t('lobby.needName'); return; }
        el.joinError.textContent = '';
        el.enter.disabled = true;
        KG.sound.unlock();
        connect({ pin, name, avatar: avatarIndex });
    };

    el.nickname.addEventListener('keydown', (event) => { if (event.key === 'Enter') el.enter.click(); });

    // ข้อความที่ JS สร้างเองต้องวาดใหม่เมื่อสลับภาษา
    KG.i18n.onChange(() => { if (lastPlayers.length) renderPlayers(lastPlayers); });

    // เคยเข้าห้องนี้ไปแล้วใน session นี้ (เช่นกดรีเฟรช) ก็ต่อกลับเลย ไม่ต้องเลือกใหม่
    const savedId = sessionStorage.getItem(idKey);
    if (savedId) {
        el.enter.disabled = true;
        connect({ pin, name: localStorage.getItem('mangosgo.player') || 'Player', avatar: avatarIndex, playerId: savedId });
    }
});
