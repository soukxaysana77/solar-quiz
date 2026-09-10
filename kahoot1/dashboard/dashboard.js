// หน้ารวมของทั้งสามบทบาท ใช้หน้าเดียวกันแต่วาดคนละส่วนตาม role ที่เซิร์ฟเวอร์ตอบมา
// เซิร์ฟเวอร์เป็นคนตัดสินว่าใครเห็นอะไร ฝั่งนี้แค่วาดสิ่งที่ได้รับมา
document.addEventListener('DOMContentLoaded', async () => {
    const el = {
        hello: document.querySelector('#hello'),
        subtitle: document.querySelector('#subtitle'),
        actions: document.querySelector('#actions'),
        stats: document.querySelector('#stats'),
        panels: document.querySelector('#panels'),
        report: document.querySelector('#report'),
        reportTitle: document.querySelector('#report-title'),
        reportMeta: document.querySelector('#report-meta'),
        reportBody: document.querySelector('#report-body'),
        reportClose: document.querySelector('#report-close')
    };

    const t = KG.i18n.t;
    KG.i18n.apply();
    KG.i18n.mountToggle();
    KG.auth.mountChip();

    let data = null;
    // วันเวลาที่เซิร์ฟเวอร์เก็บเป็น UTC ต้องบอก JS ให้ชัด ไม่งั้นบางเบราว์เซอร์อ่านเป็นเวลาท้องถิ่นแล้วเพี้ยนไปหลายชั่วโมง
    const when = (raw) => {
        if (!raw) return '';
        const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
        return Number.isNaN(date.getTime()) ? raw : date.toLocaleString(KG.i18n.lang === 'th' ? 'th-TH' : 'en-GB', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const panel = (titleKey) => {
        const box = make('section', 'panel');
        box.appendChild(make('p', 'panel-title', t(titleKey)));
        return box;
    };

    const emptyNote = (key) => make('p', 'empty', t(key));

    const statCard = (value, labelKey) => {
        const box = make('div', 'stat');
        box.append(make('div', 'stat-value', String(value)), make('div', 'stat-label', t(labelKey)));
        return box;
    };

    // ---- แถวรายการแบบใช้ซ้ำ: หัวข้อ + คำอธิบายย่อย + ปุ่มด้านขวา ----
    const listRow = (title, sub, tools = [], lead = null) => {
        const row = make('div', 'row');
        if (lead) row.appendChild(lead);
        const main = make('div', 'row-main');
        main.append(make('div', 'row-title', title), make('div', 'row-sub', sub));
        row.appendChild(main);
        if (tools.length) {
            const box = make('div', 'row-tools');
            tools.forEach(tool => box.appendChild(tool));
            row.appendChild(box);
        }
        return row;
    };

    // ข้อความบนปุ่มซ้อนไว้ทุกภาษา ปุ่มจึงกว้างคงที่ สลับภาษาแล้วปุ่มข้าง ๆ ไม่ขยับ
    const stacked = (node, key) => KG.i18n.stack(node, KG.i18n.all(key));

    const linkBtn = (key, href, className = 'mini') => {
        const link = stacked(make('a', className), key);
        link.href = href;
        return link;
    };

    const actionBtn = (key, onClick, danger = false) => {
        const button = stacked(make('button', 'mini' + (danger ? ' is-danger' : '')), key);
        button.type = 'button';
        button.onclick = onClick;
        return button;
    };

    // ---- รายงานของรอบเดียว ----
    const closeReport = () => { el.report.hidden = true; openReportId = null; };
    el.reportClose.onclick = closeReport;
    el.report.onclick = (event) => { if (event.target === el.report) closeReport(); };
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeReport(); });

    // จำรอบที่เปิดดูอยู่ ไว้วาดใหม่ตอนสลับภาษาขณะกล่องรายงานยังเปิดค้าง
    let openReportId = null;

    const openReport = async (id) => {
        openReportId = id;
        el.report.hidden = false;
        el.reportTitle.textContent = t('dash.loading');
        el.reportMeta.textContent = '';
        el.reportBody.innerHTML = '';
        let body;
        try {
            const response = await fetch(`/api/session?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
            body = await response.json();
            if (!response.ok) throw new Error(body.code || 'serverError');
        } catch (error) {
            el.reportTitle.textContent = t('error.' + (error.message || 'network'));
            return;
        }

        el.reportTitle.textContent = body.session.title;
        el.reportMeta.textContent = [
            'PIN ' + body.session.pin,
            when(body.session.startedAt),
            t('dash.unit.questions', { n: body.session.questionCount })
        ].join(' · ');

        const standing = panel('dash.standing');
        const list = make('div', 'list');
        if (!body.standing.length) list.appendChild(emptyNote('dash.emptySessions'));
        body.standing.forEach((player) => {
            const row = listRow(
                player.name,
                `${t('dash.statCorrect')} ${player.correct_count} · ${t('dash.unit.rank', { n: player.place })}`,
                [],
                make('span', 'place', t('dash.unit.rank', { n: player.place }))
            );
            row.appendChild(make('span', 'score', String(player.score)));
            list.appendChild(row);
        });
        standing.appendChild(list);
        el.reportBody.appendChild(standing);

        if (body.questions.length) {
            const perQuestion = panel('dash.perQuestion');
            body.questions.forEach((question) => {
                const bar = make('div', 'qbar');
                const track = make('div', 'qbar-track');
                const fill = make('div', 'qbar-fill');
                // เขียวคือส่วนใหญ่ตอบถูก แดงคือข้อที่ต้องกลับไปสอนซ้ำ
                fill.classList.add(question.percent >= 70 ? 'is-ok' : question.percent >= 40 ? 'is-mid' : 'is-low');
                fill.style.width = question.percent + '%';
                track.appendChild(fill);
                bar.append(
                    make('span', 'qbar-label', t('dash.questionNo', { n: question.index + 1 })),
                    track,
                    make('span', 'qbar-label', `${question.percent}% · ${t('dash.correctOf', { correct: question.correct, answered: question.answered })}`)
                );
                perQuestion.appendChild(bar);
            });
            el.reportBody.appendChild(perQuestion);
        }
    };

    // ---- วาดหน้าใหม่ทั้งหมด เรียกซ้ำได้ตอนสลับภาษาหรือหลังลบของ ----
    const paint = () => {
        if (!data) return;
        const user = data.user;
        el.hello.textContent = t('dash.hello', { name: user.name });
        el.subtitle.textContent = t('dash.' + user.role);
        el.actions.innerHTML = '';
        el.stats.innerHTML = '';
        el.panels.innerHTML = '';

        if (user.role === 'student') {
            el.actions.appendChild(linkBtn('dash.joinGame', '../page/', 'action'));
            el.stats.append(
                statCard(data.stats.played, 'dash.statPlayed'),
                statCard(data.stats.totalScore, 'dash.statScore'),
                statCard(data.stats.totalCorrect, 'dash.statCorrect'),
                statCard(data.stats.bestPlace ? t('dash.unit.rank', { n: data.stats.bestPlace }) : '—', 'dash.statBestPlace')
            );

            const history = panel('dash.myHistory');
            const list = make('div', 'list');
            if (!data.history.length) list.appendChild(emptyNote('dash.emptyHistory'));
            data.history.forEach((game) => {
                const row = listRow(
                    game.title,
                    `${when(game.playedAt)} · ${t('dash.unit.questions', { n: game.questionCount })} · ${t('dash.unit.players', { n: game.playerCount })}`,
                    [],
                    make('span', 'place', t('dash.unit.rank', { n: game.place }))
                );
                row.appendChild(make('span', 'score', String(game.score)));
                list.appendChild(row);
            });
            history.appendChild(list);
            el.panels.appendChild(history);
            return;
        }

        // ---- ครูและแอดมินใช้โครงเดียวกัน แอดมินมีส่วนผู้ใช้เพิ่มมา ----
        const isAdmin = user.role === 'admin';
        el.actions.appendChild(linkBtn('dash.newQuiz', '../Make/', 'action'));
        el.actions.appendChild(linkBtn('dash.joinGame', '../page/', 'action is-soft'));

        if (isAdmin) {
            el.stats.append(
                statCard(data.stats.users, 'dash.statUsers'),
                statCard(data.stats.teachers, 'dash.statTeachers'),
                statCard(data.stats.students, 'dash.statStudents'),
                statCard(data.stats.quizzes, 'dash.statQuizzes'),
                statCard(data.stats.sessions, 'dash.statSessions')
            );
        } else {
            el.stats.append(
                statCard(data.stats.quizzes, 'dash.statQuizzes'),
                statCard(data.stats.sessions, 'dash.statSessions'),
                statCard(data.stats.players, 'dash.statPlayers')
            );
        }

        const quizzes = panel(isAdmin ? 'dash.allQuizzes' : 'dash.myQuizzes');
        const quizList = make('div', 'list');
        if (!data.quizzes.length) quizList.appendChild(emptyNote('dash.emptyQuizzes'));
        data.quizzes.forEach((quiz) => {
            const bits = [
                'PIN ' + quiz.pin,
                t('dash.unit.questions', { n: quiz.questionCount }),
                `${t('dash.statSessions')} ${t('dash.unit.times', { n: quiz.timesPlayed })}`
            ];
            if (isAdmin) bits.push(`${t('dash.owner')}: ${quiz.ownerName || t('dash.noOwner')}`);
            quizList.appendChild(listRow(quiz.title, bits.join(' · '), [
                linkBtn('dash.host', `../host/?pin=${encodeURIComponent(quiz.pin)}`),
                actionBtn('dash.delete', () => removeQuiz(quiz), true)
            ]));
        });
        quizzes.appendChild(quizList);
        el.panels.appendChild(quizzes);

        const sessions = panel('dash.recentGames');
        const sessionList = make('div', 'list');
        if (!data.sessions.length) sessionList.appendChild(emptyNote('dash.emptySessions'));
        data.sessions.forEach((game) => {
            sessionList.appendChild(listRow(
                game.title,
                `${when(game.playedAt)} · ${t('dash.unit.players', { n: game.playerCount })} · PIN ${game.pin}`,
                [actionBtn('dash.report', () => openReport(game.id))]
            ));
        });
        sessions.appendChild(sessionList);
        el.panels.appendChild(sessions);

        if (isAdmin) {
            const users = panel('dash.users');
            const userList = make('div', 'list');
            data.users.forEach((row) => {
                const select = make('select', 'role-select');
                ['student', 'teacher', 'admin'].forEach((role) => {
                    const option = make('option', null, t('auth.role' + role.charAt(0).toUpperCase() + role.slice(1)));
                    option.value = role;
                    if (row.role === role) option.selected = true;
                    select.appendChild(option);
                });
                select.onchange = () => changeRole(row, select);
                const item = listRow(row.name, `${row.email} · ${when(row.createdAt)}`);
                const tools = make('div', 'row-tools');
                tools.appendChild(select);
                item.appendChild(tools);
                userList.appendChild(item);
            });
            users.appendChild(userList);
            el.panels.appendChild(users);
        }
    };

    const removeQuiz = async (quiz) => {
        if (!confirm(t('dash.confirmDelete', { title: quiz.title }))) return;
        try {
            const response = await fetch('/api/quizzes/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ pin: quiz.pin })
            });
            if (!response.ok) throw new Error((await response.json()).code || 'serverError');
        } catch (error) {
            alert(t('error.' + (error.message || 'network')));
            return;
        }
        await load();
    };

    const changeRole = async (row, select) => {
        const wanted = select.value;
        try {
            const response = await fetch('/api/users/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ id: row.id, role: wanted })
            });
            if (!response.ok) throw new Error((await response.json()).code || 'serverError');
        } catch (error) {
            alert(t('error.' + (error.message || 'network')));
            select.value = row.role;
            return;
        }
        await load();
    };

    // แยกให้ชัดว่า "ต่อเซิร์ฟเวอร์ไม่ติด" กับ "เซิร์ฟเวอร์ตอบว่าไม่ผ่าน" คนละเรื่องกัน
    // ของเดิมเหมารวมเป็นข้อความเดียว พอมีปัญหาจริงเลยไม่รู้ว่าเกิดอะไรขึ้น
    const showLoadError = (messageKey) => {
        el.actions.innerHTML = '';
        el.stats.innerHTML = '';
        el.panels.innerHTML = '';
        const box = make('section', 'panel');
        box.appendChild(make('p', 'empty', t(messageKey)));
        const retry = make('button', 'action');
        retry.type = 'button';
        KG.i18n.stack(retry, KG.i18n.all('dash.retry'));
        retry.onclick = load;
        box.appendChild(retry);
        el.panels.appendChild(box);
    };

    const load = async () => {
        let response;
        try {
            response = await fetch('/api/dashboard', { credentials: 'same-origin' });
        } catch (error) {
            // ต่อไม่ติดจริง ๆ เช่นเซิร์ฟเวอร์ไม่ได้รันอยู่ หรือเน็ตหลุด
            console.error('เรียก /api/dashboard ไม่สำเร็จ:', error);
            showLoadError('error.network');
            return;
        }

        // หมดอายุ session หรือยังไม่ได้ล็อกอิน พากลับไปหน้าเข้าสู่ระบบ
        if (response.status === 401) { location.href = '/auth/?next=%2Fdashboard%2F'; return; }

        let body;
        try {
            body = await response.json();
        } catch (error) {
            console.error('/api/dashboard ตอบกลับมาไม่ใช่ JSON (status ' + response.status + '):', error);
            showLoadError('error.serverError');
            return;
        }

        if (!response.ok) {
            console.error('/api/dashboard ตอบ status ' + response.status, body);
            showLoadError('error.' + (body.code || 'serverError'));
            return;
        }

        data = body;
        paint();
    };

    // ข้อความทั้งหน้าถูกสร้างด้วย JS ทั้งหมด สลับภาษาแล้ววาดใหม่ทีเดียวจบ
    KG.i18n.onChange(() => {
        paint();
        // กล่องรายงานเปิดค้างอยู่ก็ต้องวาดใหม่ด้วย ไม่งั้นเนื้อในค้างภาษาเดิม
        if (openReportId !== null) openReport(openReportId);
    });
    await load();
});
