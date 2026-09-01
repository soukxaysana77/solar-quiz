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
    message: document.querySelector('#message')
  };

  const t = KG.i18n.t;
  KG.i18n.apply();
  KG.i18n.mountToggle();

  if (!pin) { el.message.textContent = t('common.noPin'); return; }

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

  const renderQuestion = (msg) => {
    pendingResult = null;
    paintMode(msg.mode);
    el.card.classList.toggle('is-out', eliminated);
    el.progress.textContent = t('game.progress', { pin, index: msg.index + 1, total: msg.total });
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
    socket.onclose = () => { el.message.textContent = t('common.reconnecting'); setTimeout(connect, 2000); };
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
        el.message.textContent = t('game.locked');
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

        const place = msg.players.findIndex((player) => player.id === playerId) + 1;
        const rank = place ? ' · ' + t('game.rank', { place, total: msg.players.length }) : '';

        if (pendingResult?.correct) {
          KG.sound.correct(streak);
          const bonus = pendingResult.bonus ? ' ' + t('game.streakBonus', { bonus: pendingResult.bonus }) : '';
          el.timerLabel.textContent = t('game.correct');
          el.message.textContent = t('game.gain', { gain: pendingResult.gain }) + bonus + ' · ' + t('game.score', { score }) + rank;
        } else if (pendingResult) {
          KG.sound.wrong();
          el.timerLabel.textContent = t('game.wrong');
          el.message.textContent = t('game.score', { score }) + rank;
        } else {
          KG.sound.timeUp();
          el.timerLabel.textContent = t('game.timeUp');
          el.message.textContent = t('game.missed') + ' · ' + t('game.score', { score }) + rank;
        }

        const me = msg.players.find((player) => player.id === playerId);
        streak = me?.streak ?? streak;
        paintStreak();

        // ฉากไล่ล่าอยู่บนจอใหญ่ ฝั่งผู้เล่นบอกเป็นข้อความพอ
        if (msg.mode === 'blackhole' && me) {
            if (me.eliminated) el.message.textContent = t('game.sucked');
            else el.message.textContent = el.message.textContent + ' · ' + t('game.holeDistance', { lead: me.lead });
        }

        // โหมดตกรอบ: ถ้ารอบนี้ตกแล้ว บอกให้รู้และล็อกปุ่มตั้งแต่ข้อถัดไป
        if (me?.eliminated && !eliminated) {
          eliminated = true;
          el.card.classList.add('is-out');
          el.timerLabel.textContent = t('game.eliminated');
          el.message.textContent = t('game.eliminatedAt', { index: msg.questionIndex + 1, survived: me.survived });
        }

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

        const me = msg.players.find((player) => player.id === playerId);
        const place = msg.players.findIndex((player) => player.id === playerId) + 1;
        const medal = ['🥇', '🥈', '🥉'][place - 1] || '🎉';
        if (msg.mode === 'blackhole' && me?.eliminated) {
            el.question.textContent = t('game.finalSucked', { survived: me.survived });
        } else if (msg.mode === 'blackhole') {
            el.question.textContent = t('game.finalSurvived', { lead: me?.lead ?? 0 });
        } else if (msg.mode === 'survival' && me?.eliminated) {
            el.question.textContent = t('game.finalEliminated', { survived: me.survived });
        } else {
            el.question.textContent = t('game.finalRank', { medal, place, total: msg.players.length });
        }
        el.progress.textContent = 'PIN ' + pin;
        el.message.textContent = t('game.totalScore', { score })
            + (me?.bestStreak > 1 ? ' · ' + t('game.bestStreak', { n: me.bestStreak }) : '');
      }
    };
  };

  // ข้อความที่ JS สร้างเองต้องวาดใหม่เมื่อสลับภาษา
  KG.i18n.onChange(() => { paintMode(); paintStreak(); });

  connect();
});
