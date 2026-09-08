document.addEventListener('DOMContentLoaded', () => {
  const pin = new URLSearchParams(location.search).get('pin') || sessionStorage.getItem('mangosgo.activePin');
  const el = {
    me: document.querySelector('#me'),
    streak: document.querySelector('#streak'),
    modeBadge: document.querySelector('#mode-badge'),
    card: document.querySelector('.game-card'),
    progress: document.querySelector('#progress'),
    timer: document.querySelector('.timer'),
    timerTrack: document.querySelector('#timer-track'),
    timerFill: document.querySelector('#timer-fill'),
    timerLabel: document.querySelector('#timer-label'),
    question: document.querySelector('#question'),
    media: document.querySelector('#question-media'),
    answers: document.querySelector('#answers'),
    message: document.querySelector('#message'),
    home: document.querySelector('#home')
  };

  const t = KG.i18n.t;
  KG.i18n.apply();
  KG.i18n.mountToggle();

  // ต้องลงทะเบียนตรงนี้ ก่อนบรรทัดที่ return ออกไปตอนไม่มี PIN
  // ไม่งั้นหน้าที่จบด้วย return จะไม่มีตัวฟังการสลับภาษาเลย
  let redrawText = null;
  KG.i18n.onChange(() => redrawText?.());

  if (!pin) {
    redrawText = () => { el.message.textContent = t('common.noPin'); };
    redrawText();
    return;
  }

  // ชื่อกับอวตารถูกเลือกที่หน้า lobby ถ้าไม่มีแปลว่าเข้าหน้านี้ตรง ๆ ให้ย้อนไปเลือกก่อน
  const playerId = sessionStorage.getItem(`mangosgo.playerId.${pin}`);
  const name = localStorage.getItem('mangosgo.player');
  if (!playerId || !name) { location.href = `../lobby/?pin=${encodeURIComponent(pin)}`; return; }

  KG.sound.mountToggle();
  KG.fullscreen.mountToggle();
  document.addEventListener('pointerdown', () => KG.sound.unlock(), { once: true });

  let socket = null;
  let ticker = null;
  let lastTick = -1;
  let score = 0;
  let streak = 0;
  let pendingResult = null;   // ผลของข้อนี้ กั๊กไว้จนกว่าจะถึงเวลาเฉลย
  // เก็บข้อความล่าสุดไว้วาดใหม่ตอนสลับภาษา
  // redrawText คือวิธีวาดข้อความสถานะของจังหวะปัจจุบัน (ล็อกคำตอบ / เฉลย / จบเกม)
  let lastQuestion = null;
  let eliminated = false;
  let myAvatar = null;
  let myName = name;

  // ไอคอนกับสีของโหมดอยู่ที่นี่ ส่วนชื่อดึงจากพจนานุกรมเพื่อให้สลับภาษาได้
  const MODE_LOOK = {
    classic:   { icon: '🎯', color: '#8b5cf6' },
    accuracy:  { icon: '🎓', color: '#0ea5e9' },
    survival:  { icon: '💀', color: '#ef4444' },
    blackhole: { icon: '🕳️', color: '#4c1d95' },
    rush:      { icon: '⚡', color: '#f59e0b' }
  };

  let currentModeId = null;

  const paintMode = (mode) => {
    currentModeId = mode ?? currentModeId;
    const look = MODE_LOOK[currentModeId];
    if (!look) { el.modeBadge.hidden = true; return; }
    el.modeBadge.hidden = false;
    el.modeBadge.style.background = look.color;
    el.modeBadge.textContent = look.icon + ' ' + t('mode.' + currentModeId);
  };

  const stopTimer = () => { clearInterval(ticker); ticker = null; };

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
      // ติ๊กวินาทีละครั้งในช่วง 5 วิสุดท้าย
      if (left <= 5 && left > 0 && left !== lastTick) KG.sound.tick(left);
      lastTick = left;
      if (leftMs === 0) {
        stopTimer();
        el.answers.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      }
    };
    tick();
    ticker = setInterval(tick, 100);
  };

  const paintStreak = () => {
    if (streak < 2) { el.streak.hidden = true; return; }
    el.streak.hidden = false;
    el.streak.textContent = t('game.streak', { n: streak });
    el.streak.classList.remove('kg-pop');
    void el.streak.offsetWidth;
    el.streak.classList.add('kg-pop');
  };

  const send = (type, data = {}) => {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type, ...data }));
  };

  // แยกออกมาเป็นฟังก์ชันเพราะต้องวาดซ้ำได้ตอนผู้เล่นสลับภาษาระหว่างรอเฉลย
  const renderResult = (msg, result, justEliminated) => {
    redrawText = () => renderResult(msg, result, justEliminated);
    const me = msg.players.find((player) => player.id === playerId);
    const place = msg.players.findIndex((player) => player.id === playerId) + 1;
    const rank = place ? ' · ' + t('game.rank', { place, total: msg.players.length }) : '';

    let label;
    let message;
    if (result?.correct) {
      const bonus = result.bonus ? ' ' + t('game.streakBonus', { bonus: result.bonus }) : '';
      label = t('game.correct');
      message = t('game.gain', { gain: result.gain }) + bonus + ' · ' + t('game.score', { score }) + rank;
    } else if (result) {
      label = t('game.wrong');
      message = t('game.score', { score }) + rank;
    } else {
      label = t('game.timeUp');
      message = t('game.missed') + ' · ' + t('game.score', { score }) + rank;
    }

    // ฉากไล่ล่าอยู่บนจอใหญ่ ฝั่งผู้เล่นบอกเป็นข้อความพอ
    if (msg.mode === 'blackhole' && me) {
      if (me.eliminated) message = t('game.sucked');
      else message += ' · ' + t('game.holeDistance', { lead: me.lead });
    }

    if (justEliminated) {
      label = t('game.eliminated');
      message = t('game.eliminatedAt', { index: msg.questionIndex + 1, survived: me.survived });
    }

    el.timerLabel.textContent = label;
    el.message.textContent = message;
  };

  // แยกออกมาเป็นฟังก์ชันเพราะต้องวาดซ้ำได้ตอนผู้เล่นสลับภาษาบนหน้าจบเกม
  const renderFinal = (msg) => {
    redrawText = () => renderFinal(msg);
    lastQuestion = null;
    // จบเกมแล้วป้ายตอบถูกติดกันต้องหายไป ล้างค่าไว้ด้วยไม่งั้น paintStreak() ตอนสลับภาษาจะเอากลับขึ้นมา
    streak = 0;
    const me = msg.players.find((player) => player.id === playerId);
    const place = msg.players.findIndex((player) => player.id === playerId) + 1;
    const medal = ['🥇', '🥈', '🥉'][place - 1] || '🎉';
    delete el.question.dataset.i18n;
    if (msg.mode === 'blackhole' && me?.eliminated) {
        el.question.textContent = t('game.finalSucked', { survived: me.survived });
    } else if (msg.mode === 'blackhole') {
        el.question.textContent = t('game.finalSurvived', { lead: me?.lead ?? 0 });
    } else if (msg.mode === 'survival' && me?.eliminated) {
        el.question.textContent = t('game.finalEliminated', { survived: me.survived });
    } else {
        el.question.textContent = t('game.finalRank', { medal, place, total: msg.players.length });
    }
    el.home.hidden = false;
    el.progress.textContent = 'PIN ' + pin;
    el.message.textContent = t('game.totalScore', { score })
        + (me?.bestStreak > 1 ? ' · ' + t('game.bestStreak', { n: me.bestStreak }) : '');
  };

  const renderQuestion = (msg) => {
    pendingResult = null;
    lastQuestion = msg;
    redrawText = () => { el.message.textContent = score ? t('game.score', { score }) : ''; };
    paintMode(msg.mode);
    el.card.classList.toggle('is-out', eliminated);
    el.progress.textContent = t('game.progress', { pin, index: msg.index + 1, total: msg.total });
    // คำถามเป็นข้อความของผู้ใช้ ต้องถอด data-i18n ทิ้ง ไม่งั้นสลับภาษาแล้วโดนเขียนทับเป็น "รอคำถาม..."
    delete el.question.dataset.i18n;
    el.question.textContent = msg.question;
    el.message.textContent = score ? t('game.score', { score }) : '';
    el.answers.innerHTML = '';

    if (msg.mediaUrl) { el.media.src = msg.mediaUrl; el.media.style.display = 'block'; }
    else { el.media.removeAttribute('src'); el.media.style.display = 'none'; }

    msg.options.forEach((option) => {
      const button = document.createElement('button');
      button.className = 'answer';
      button.textContent = option.text;
      button.dataset.index = option.index;
      button.disabled = eliminated;
      button.onclick = () => {
        if (eliminated) return;
        KG.sound.unlock();
        el.answers.querySelectorAll('button').forEach((other) => { other.disabled = true; });
        send('ANSWER', { answer: option.index });
      };
      el.answers.appendChild(button);
    });

    startTimer(msg.remaining, msg.duration);
  };

  const connect = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    socket.onopen = () => send('JOIN_ROOM', { pin, name, playerId });
    socket.onclose = () => {
      redrawText = () => { el.message.textContent = t('common.reconnecting'); };
      redrawText();
      setTimeout(connect, 2000);
    };
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'ERROR') {
        el.message.textContent = msg.code ? t('error.' + msg.code, { max: msg.max }) : msg.message;
        return;
      }

      if (msg.type === 'JOINED') {
        score = msg.score;
        streak = msg.streak || 0;
        myAvatar = msg.avatar;
        myName = msg.name;
        eliminated = Boolean(msg.eliminated);
        el.me.innerHTML = '';
        const avatar = KG.avatar.el(msg.avatar, 30);
        const label = document.createElement('span');
        label.textContent = msg.name;
        el.me.append(avatar, label);
        paintStreak();
        return;
      }

      // ยังอยู่ในล็อบบี้ (เช่นกดรีเฟรชก่อนเกมเริ่ม) ให้กลับไปรอที่หน้า lobby
      if (msg.type === 'ROOM_STATE' && msg.phase === 'lobby') {
        location.href = `../lobby/?pin=${encodeURIComponent(pin)}`;
        return;
      }

      if (msg.type === 'QUESTION') { renderQuestion(msg); return; }

      // ส่งคำตอบถึงแล้ว แต่ยังไม่บอกว่าถูกหรือผิด ต้องรอหมดเวลาพร้อมกันทุกคน
      if (msg.type === 'ANSWER_ACCEPTED') {
        el.answers.querySelectorAll('button').forEach((button) => {
          button.disabled = true;
          button.classList.toggle('is-picked', Number(button.dataset.index) === msg.answer);
          button.classList.toggle('is-waiting', Number(button.dataset.index) !== msg.answer);
        });
        redrawText = () => { el.message.textContent = t('game.locked'); };
        redrawText();
        return;
      }

      // ผลของตัวเองมาถึงตอนหมดเวลา เก็บไว้ให้ LEADERBOARD เป็นคนเฉลย
      if (msg.type === 'ANSWER_RESULT') {
        pendingResult = msg;
        score = msg.total;
        streak = msg.streak || 0;
        return;
      }

      if (msg.type === 'LEADERBOARD') {
        stopTimer();
        paintBar(0);
        el.timer.classList.remove('is-urgent');
        el.answers.querySelectorAll('button').forEach((button) => {
          button.disabled = true;
          button.classList.remove('is-waiting');
          button.classList.toggle('is-correct', Number(button.dataset.index) === msg.correctIndex);
          button.classList.toggle('is-dimmed', Number(button.dataset.index) !== msg.correctIndex);
        });

        const me = msg.players.find((player) => player.id === playerId);
        const justEliminated = Boolean(me?.eliminated) && !eliminated;

        // เสียงเล่นครั้งเดียวตรงนี้ ไม่ไปอยู่ในตัววาดข้อความ ไม่งั้นสลับภาษาแล้วเสียงจะดังซ้ำ
        if (pendingResult?.correct) KG.sound.correct(streak);
        else if (pendingResult) KG.sound.wrong();
        else KG.sound.timeUp();

        streak = me?.streak ?? streak;
        paintStreak();

        // โหมดตกรอบ: ถ้ารอบนี้ตกแล้ว ล็อกปุ่มตั้งแต่ข้อถัดไป
        if (justEliminated) {
          eliminated = true;
          el.card.classList.add('is-out');
        }

        renderResult(msg, pendingResult, justEliminated);
        pendingResult = null;
        return;
      }

      if (msg.type === 'FINAL') {
        stopTimer();
        KG.sound.podium();
        el.timerTrack.classList.add('is-hidden');
        el.timerLabel.textContent = '';
        el.media.style.display = 'none';
        el.answers.innerHTML = '';
        el.streak.hidden = true;

        renderFinal(msg);
      }
    };
  };

  // ข้อความที่ JS สร้างเองต้องวาดใหม่เมื่อสลับภาษา
  KG.i18n.onChange(() => {
    paintMode();
    paintStreak();
    if (lastQuestion) el.progress.textContent = t('game.progress', { pin, index: lastQuestion.index + 1, total: lastQuestion.total });
  });

  connect();
});
