document.addEventListener('DOMContentLoaded', () => {
  const pin = new URLSearchParams(location.search).get('pin') || localStorage.getItem('mangosgo.lastPin');
  const el = {
    pin: document.querySelector('#pin'),
    title: document.querySelector('#title'),
    count: document.querySelector('#question-count'),
    timer: document.querySelector('.timer'),
    timerTrack: document.querySelector('#timer-track'),
    timerFill: document.querySelector('#timer-fill'),
    timerLabel: document.querySelector('#timer-label'),
    playView: document.querySelector('#play-view'),
    question: document.querySelector('#question'),
    media: document.querySelector('#question-media'),
    options: document.querySelector('#options'),
    answered: document.querySelector('#answered'),
    runView: document.querySelector('#run-view'),
    runArena: document.querySelector('#run-arena'),
    runAnswer: document.querySelector('#run-answer'),
    podiumView: document.querySelector('#podium-view'),
    podium: document.querySelector('#podium'),
    runnersUp: document.querySelector('#runners-up'),
    modeView: document.querySelector('#mode-view'),
    modes: document.querySelector('#modes'),
    start: document.querySelector('#start'),
    scores: document.querySelector('#scores'),
    playerCount: document.querySelector('#player-count'),
    players: document.querySelector('#players'),
    message: document.querySelector('#message')
  };

  const t = KG.i18n.t;
  KG.i18n.apply();
  KG.i18n.mountToggle();

  el.pin.textContent = pin || '------';
  if (!pin) { el.message.textContent = t('host.noPin'); return; }

  KG.sound.mountToggle();
  KG.fullscreen.mountToggle();
  document.addEventListener('pointerdown', () => KG.sound.unlock(), { once: true });

  let socket = null;
  let currentOptions = [];
  let ticker = null;
  let lastTick = -1;
  let inLobby = true;
  let lobbyCount = 0;
  let countdown = null;
  let modes = [];
  let selectedMode = localStorage.getItem('mangosgo.mode') || 'classic';

  const stopTimer = () => { clearInterval(ticker); ticker = null; };
  const stopCountdown = () => { clearInterval(countdown); countdown = null; };

  // เก็บ ROOM_STATE ล่าสุดไว้วาดใหม่ตอนสลับภาษา (ข้อความพวกนี้ JS เป็นคนเซ็ต ไม่ใช่ data-i18n)
  let lastRoomState = null;

  // นับถอยหลังไปข้อถัดไป เซิร์ฟเวอร์เป็นคนพาไปเอง จอนี้แค่บอกให้รู้ว่าเหลืออีกกี่วิ
  const startCountdown = (remaining, isLast) => {
    stopCountdown();
    const deadline = Date.now() + remaining;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.answered.textContent = isLast ? t('host.resultIn', { n: left }) : t('host.nextIn', { n: left });
      if (left === 0) stopCountdown();
    };
    tick();
    countdown = setInterval(tick, 200);
  };

  // หลอดยาวตามสัดส่วนเวลาที่เหลือ และเปลี่ยนสีเขียว→เหลือง→แดงเมื่อใกล้หมด
  const paintBar = (fraction) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    el.timerFill.style.transform = `scaleX(${clamped})`;
    el.timerFill.classList.toggle('is-mid', clamped <= 0.5 && clamped > 0.25);
    el.timerFill.classList.toggle('is-low', clamped <= 0.25);
  };

  const startTimer = (remaining, duration) => {
    stopTimer();
    lastTick = -1;
    el.timerTrack.classList.remove('is-hidden');
    const total = duration || remaining || 1;
    const deadline = Date.now() + remaining;
    const tick = () => {
      const leftMs = Math.max(0, deadline - Date.now());
      const left = Math.ceil(leftMs / 1000);
      paintBar(leftMs / total);
      el.timerLabel.textContent = `${left}s`;
      el.timer.classList.toggle('is-urgent', left <= 5 && left > 0);
      if (left <= 5 && left > 0 && left !== lastTick) KG.sound.tick(left);
      lastTick = left;
      if (leftMs === 0) stopTimer();
    };
    tick();
    ticker = setInterval(tick, 100);
  };

  // การ์ดเลือกโหมด สีมาจากเซิร์ฟเวอร์ จะได้ไม่ต้องมี list โหมดสองที่
  const paintModes = () => {
    el.modes.innerHTML = '';
    modes.forEach((mode) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mode-card';
      card.style.background = mode.color;
      card.setAttribute('aria-pressed', String(mode.id === selectedMode));

      const icon = document.createElement('div');
      icon.className = 'mode-icon';
      icon.textContent = mode.icon;
      const name = document.createElement('div');
      name.className = 'mode-name';
      name.textContent = modeText(mode.label);
      const desc = document.createElement('div');
      desc.className = 'mode-desc';
      desc.textContent = modeText(mode.desc);

      card.append(icon, name, desc);
      card.onclick = () => {
        selectedMode = mode.id;
        localStorage.setItem('mangosgo.mode', mode.id);
        KG.sound.unlock();
        KG.sound.join();
        paintModes();
      };
      el.modes.appendChild(card);
    });
  };

  const findMode = (id) => modes.find((mode) => mode.id === id);
  // เซิร์ฟเวอร์ส่ง label/desc มาเป็น { th, en } เลือกตามภาษาที่จออยู่ตอนนี้
  const modeText = (value) => (typeof value === 'string' ? value : (value?.[KG.i18n.lang] ?? value?.th ?? ''));

  // โหมดที่ "กำลังเล่นอยู่จริง" มาจากเซิร์ฟเวอร์เสมอ ไม่ใช่การ์ดที่จอนี้เลือกไว้
  // ถ้ามี host หลายจอ จอที่ไม่ได้กด Start จะได้โหมดถูกต้องเหมือนกัน
  let activeMode = null;

  // ระหว่างเล่นเอาการ์ดออก เหลือป้ายบอกว่ากำลังเล่นโหมดอะไร
  const showModeBadge = () => {
    const mode = findMode(activeMode ?? selectedMode);
    el.modeView.innerHTML = '';
    if (!mode) return;
    const badge = document.createElement('span');
    badge.className = 'mode-badge';
    badge.style.background = mode.color;
    badge.textContent = mode.icon + ' ' + modeText(mode.label);
    el.modeView.appendChild(badge);
  };

  const chip = (player) => {
    const node = document.createElement('li');
    node.className = player.connected ? 'player-chip kg-pop' : 'player-chip is-away';
    const avatar = KG.avatar.el(player.avatar, 26);
    const name = document.createElement('span');
    name.textContent = player.name;
    node.append(avatar, name);
    return node;
  };

  const renderScores = (players, ranked) => {
    el.scores.innerHTML = '';
    players.forEach((player, place) => {
      const li = document.createElement('li');
      li.className = 'score-row';
      const flame = player.streak >= 2 ? ` 🔥${player.streak}` : '';
      const rank = document.createElement('span');
      rank.className = 'score-rank';
      rank.textContent = ranked ? `${place + 1}.` : '';
      const label = document.createElement('span');
      label.textContent = `${player.name}: ${player.score}${flame}`;
      li.append(rank, KG.avatar.el(player.avatar, 24), label);
      el.scores.appendChild(li);
    });
  };

  // เวทีไล่ล่าเดียวสำหรับทุกคน เทียบระยะกับรอบก่อนเพื่อรู้ว่าใครเร่งเครื่อง ใครโดนดึง
  const lastLeads = new Map();
  // ช่วงถามไม่มีรายชื่อมากับ QUESTION จึงต้องเก็บชุดล่าสุดไว้วาดฉากต่อ
  let latestPlayers = [];

  const renderRun = (players, animate = true) => {
    const arena = KG.run.arena();
    players.forEach((player, index) => {
      const before = lastLeads.get(player.id);
      const delta = !animate || before === undefined ? 0 : (player.lead ?? 0) - before;
      lastLeads.set(player.id, player.lead ?? 0);

      arena.appendChild(KG.run.pilot({
        name: player.name,
        avatar: player.avatar,
        lead: player.lead,
        maxLead: player.maxLead,
        eliminated: player.eliminated,
        delta,
        row: index,
        rows: players.length
      }));
    });
    el.runArena.replaceChildren(arena);
  };

  const renderOptions = (options, correctIndex = null, tally = null) => {
    el.options.innerHTML = '';
    options.forEach((option, position) => {
      const li = document.createElement('li');
      li.textContent = tally ? `${option.text} — ${tally[position] || 0}` : option.text;
      if (correctIndex !== null) {
        li.classList.add(option.index === correctIndex ? 'correct' : 'dimmed');
      }
      el.options.appendChild(li);
    });
  };

  // แท่นสามอันดับแรก เรียงซ้ายไปขวาเป็นที่ 2 – 1 – 3 แบบพิธีมอบเหรียญจริง
  const renderPodium = (players) => {
    const top = players.slice(0, 3);
    const order = [1, 0, 2].filter(index => top[index]);
    const medals = ['🥇', '🥈', '🥉'];

    el.podium.innerHTML = '';
    order.forEach((index) => {
      const player = top[index];
      const block = document.createElement('div');
      block.className = `podium-slot place-${index + 1}`;
      block.style.animationDelay = `${(2 - index) * 0.35}s`;

      const avatar = document.createElement('div');
      avatar.className = 'podium-avatar avatar-float';
      avatar.innerHTML = KG.avatar.markup(player.avatar, 56);

      const name = document.createElement('div');
      name.className = 'podium-name';
      name.textContent = player.name;

      const step = document.createElement('div');
      step.className = 'podium-step';
      step.textContent = medals[index];

      const score = document.createElement('div');
      score.className = 'podium-score';
      score.textContent = `${player.score}`;

      block.append(avatar, name, step, score);
      el.podium.appendChild(block);
    });

    el.runnersUp.innerHTML = '';
    players.slice(3).forEach((player, index) => {
      const li = document.createElement('li');
      li.className = 'score-row';
      const rank = document.createElement('span');
      rank.className = 'score-rank';
      rank.textContent = `${index + 4}.`;
      const label = document.createElement('span');
      label.textContent = `${player.name}: ${player.score}`;
      li.append(rank, KG.avatar.el(player.avatar, 24), label);
      el.runnersUp.appendChild(li);
    });
  };

  const connect = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    socket.onopen = () => {
      el.message.textContent = '';
      socket.send(JSON.stringify({ type: 'HOST_ROOM', pin }));
    };
    socket.onclose = () => {
      el.message.textContent = t('common.reconnecting');
      setTimeout(connect, 2000);
    };
    socket.onmessage = (event) => handle(JSON.parse(event.data));
  };

  const send = (type, data = {}) => {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type, ...data }));
  };

  const handle = (msg) => {
    if (msg.type === 'ERROR') {
      el.message.textContent = msg.code ? t('error.' + msg.code, { max: msg.max }) : msg.message;
      return;
    }

    if (msg.type === 'HOST_READY') {
      el.title.textContent = msg.title;
      el.count.textContent = t('host.questionCount', { n: msg.total });
      modes = msg.modes || [];
      activeMode = msg.phase === 'lobby' ? null : (msg.mode ?? null);
      if (!modes.some((mode) => mode.id === selectedMode)) selectedMode = modes[0]?.id;
      if (msg.phase === 'lobby') paintModes();
      else showModeBadge();
      // จอ host ก็ต้องโชว์รูปเหมือนกัน โหลดดักไว้ตั้งแต่ยังรอผู้เล่น
      KG.preload(msg.media, (done, total) => {
        if (!total || done >= total) { el.answered.textContent = ''; return; }
        el.answered.textContent = `กำลังเตรียมรูปคำถาม ${done}/${total}`;
      });
      return;
    }

    if (msg.type === 'ROOM_STATE') {
      lastRoomState = msg;
      el.playerCount.textContent = t('common.players', { n: msg.players.length });
      el.players.innerHTML = '';
      latestPlayers = msg.players;
      msg.players.forEach((player) => el.players.appendChild(chip(player)));
      renderScores(msg.players, msg.phase !== 'lobby');
      el.start.disabled = msg.phase !== 'lobby' || msg.players.length === 0;
      if (msg.phase === 'lobby') {
        document.body.classList.remove('is-playing', 'is-question', 'is-reveal', 'is-final', 'is-run');
        activeMode = null;
        el.timerTrack.classList.add('is-hidden');
        el.timerLabel.textContent = t('host.waitingPlayers');
        // ส่งเสียงตอบรับเฉพาะตอนมีคนเข้ามาเพิ่มจริง ๆ ไม่ใช่ทุกครั้งที่รายชื่ออัปเดต
        if (msg.players.length > lobbyCount) KG.sound.join();
        lobbyCount = msg.players.length;
        KG.sound.startMusic();
      }
      return;
    }

    if (msg.type === 'QUESTION') {
      stopCountdown();
      // ช่วงเล่นจริง = จอเกมเต็มจอ ซ่อนของในล็อบบี้ให้ตัวเกมกินพื้นที่ทั้งหมด
      document.body.classList.add('is-playing', 'is-question');
      document.body.classList.remove('is-final', 'is-reveal');
      activeMode = msg.mode ?? activeMode;
      showModeBadge();
      if (msg.index === 0) lastLeads.clear();
      const isRun = msg.mode === 'blackhole';
      document.body.classList.toggle('is-run', isRun);
      // โหมดหลุมดำ จอใหญ่โชว์ฉากไล่ล่าอย่างเดียว ไม่ต้องขึ้นคำถาม
      el.runView.hidden = !isRun;
      if (isRun) renderRun(latestPlayers, false);
      if (inLobby) { KG.sound.stopMusic(); KG.sound.start(); inLobby = false; }
      currentOptions = msg.options;
      el.playView.hidden = false;
      el.podiumView.hidden = true;
      el.count.textContent = t('host.questionOf', { index: msg.index + 1, total: msg.total });
      el.question.textContent = msg.question;
      // รูปถูกโหลดดักไว้ตั้งแต่ตอนอยู่ล็อบบี้แล้ว ตรงนี้จึงขึ้นทันทีไม่ต้องรอโหลด
      if (msg.mediaUrl) { el.media.src = msg.mediaUrl; el.media.style.display = 'block'; }
      else { el.media.removeAttribute('src'); el.media.style.display = 'none'; }
      renderOptions(msg.options);
      el.start.hidden = true;
      el.message.textContent = '';
      startTimer(msg.remaining, msg.duration);
      return;
    }

    if (msg.type === 'ANSWER_COUNT') {
      el.answered.textContent = t('host.answered', { answered: msg.answered, total: msg.total });
      return;
    }

    if (msg.type === 'LEADERBOARD') {
      stopTimer();
      KG.sound.timeUp();
      // เฉลยแล้วค่อยโชว์อันดับ
      document.body.classList.remove('is-question');
      document.body.classList.add('is-reveal');
      paintBar(0);
      el.timer.classList.remove('is-urgent');
      el.timerLabel.textContent = t('host.timeUp');
      renderOptions(currentOptions, msg.correctIndex, msg.tally);
      renderScores(msg.players, true);

      if (msg.mode === 'blackhole') {
        el.runView.hidden = false;
        latestPlayers = msg.players;
        renderRun(msg.players);
        const correct = currentOptions.find((option) => option.index === msg.correctIndex);
        el.runAnswer.innerHTML = '';
        el.runAnswer.append(
          document.createTextNode(t('host.answer') + ' '),
          Object.assign(document.createElement('span'), { className: 'run-correct', textContent: correct?.text ?? '-' })
        );
        const gone = msg.players.filter((player) => player.eliminated).length;
        el.message.textContent = gone
          ? t('host.aliveSome', { gone, alive: msg.alive })
          : t('host.aliveAll', { alive: msg.alive });
      }

      if (msg.mode === 'survival') {
        const out = msg.players.filter((player) => player.eliminated).length;
        el.message.textContent = out
          ? t('host.survivalSome', { out, alive: msg.alive })
          : t('host.survivalAll', { alive: msg.alive });
      }
      startCountdown(msg.nextIn ?? 0, msg.isLastQuestion);
      return;
    }

    if (msg.type === 'FINAL') {
      stopTimer();
      stopCountdown();
      document.body.classList.remove('is-playing', 'is-question', 'is-reveal', 'is-run');
      document.body.classList.add('is-final');
      el.answered.textContent = '';
      KG.sound.stopMusic();
      KG.sound.podium();
      el.timerTrack.classList.add('is-hidden');
      el.timerLabel.textContent = t('host.finished');
      el.playView.hidden = true;
      el.runView.hidden = true;
      el.podiumView.hidden = false;
      el.scores.innerHTML = '';
      renderPodium(msg.players);
      el.message.textContent = t('host.thanks');
    }
  };

  el.start.onclick = () => {
    KG.sound.unlock();
    el.start.disabled = true;
    send('START_GAME', { mode: selectedMode });
  };

  // ข้อความที่ JS สร้างเองต้องวาดใหม่เมื่อสลับภาษา
  KG.i18n.onChange(() => {
    if (document.body.classList.contains('is-playing') || document.body.classList.contains('is-final')) showModeBadge();
    else paintModes();
    // ข้อความในล็อบบี้ที่ JS เซ็ตไว้ ต้องวาดซ้ำเองเพราะไม่มี data-i18n มารับ
    if (lastRoomState) {
      el.playerCount.textContent = t('common.players', { n: lastRoomState.players.length });
      if (lastRoomState.phase === 'lobby') el.timerLabel.textContent = t('host.waitingPlayers');
      renderScores(lastRoomState.players, lastRoomState.phase !== 'lobby');
    }
  });

  connect();
});
