// หน้าเข้าสู่ระบบ / สมัครสมาชิก อยู่ในหน้าเดียวกัน สลับด้วยแท็บด้านบน
document.addEventListener('DOMContentLoaded', async () => {
    const el = {
        tabLogin: document.querySelector('#tab-login'),
        tabRegister: document.querySelector('#tab-register'),
        form: document.querySelector('#form'),
        nameRow: document.querySelector('#name-row'),
        roleRow: document.querySelector('#role-row'),
        name: document.querySelector('#name'),
        email: document.querySelector('#email'),
        password: document.querySelector('#password'),
        submit: document.querySelector('#submit'),
        error: document.querySelector('#error'),
        notice: document.querySelector('#notice')
    };

    const t = KG.i18n.t;
    KG.i18n.apply();
    KG.i18n.mountToggle();

    const params = new URLSearchParams(location.search);
    // หน้าที่ผู้ใช้อยากไปตอนแรก ต้องอยู่ในเว็บนี้เท่านั้น กันถูกหลอกให้เด้งออกไปเว็บอื่น
    const next = (() => {
        const raw = params.get('next') || '';
        return /^\/[^/\\]/.test(raw) ? raw : '/dashboard/';
    })();

    let mode = 'login';
    let role = 'student';

    // ข้อความที่ JS เขียนเอง จำวิธีวาดไว้เพื่อวาดใหม่ตอนสลับภาษา
    const redraws = new Map();
    const setText = (node, draw) => {
        delete node.dataset.i18n;
        if (draw) { redraws.set(node, draw); node.textContent = draw(); }
        else { redraws.delete(node); node.textContent = ''; }
    };
    KG.i18n.onChange(() => redraws.forEach((draw, node) => { node.textContent = draw(); }));

    if (params.get('denied')) setText(el.notice, () => t('auth.deniedNote'));

    const paintMode = () => {
        el.tabLogin.classList.toggle('is-on', mode === 'login');
        el.tabRegister.classList.toggle('is-on', mode === 'register');
        el.nameRow.hidden = mode === 'login';
        el.roleRow.hidden = mode === 'login';
        el.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        el.submit.dataset.i18n = mode === 'login' ? 'auth.submitLogin' : 'auth.submitRegister';
        setText(el.error, null);
        KG.i18n.apply(el.form);
    };

    el.tabLogin.onclick = () => { mode = 'login'; paintMode(); };
    el.tabRegister.onclick = () => { mode = 'register'; paintMode(); };

    document.querySelectorAll('.role-btn').forEach((button) => {
        button.onclick = () => {
            role = button.dataset.role;
            document.querySelectorAll('.role-btn').forEach(other => other.classList.toggle('is-on', other === button));
        };
    });

    el.form.onsubmit = async (event) => {
        event.preventDefault();
        setText(el.error, null);
        el.submit.disabled = true;
        const wasKey = el.submit.dataset.i18n;
        el.submit.dataset.i18n = 'auth.working';
        KG.i18n.apply(el.form);

        const body = mode === 'login'
            ? { email: el.email.value.trim(), password: el.password.value }
            : { name: el.name.value.trim(), email: el.email.value.trim(), password: el.password.value, role };

        try {
            const response = await fetch(`/api/auth/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body)
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok) {
                KG.auth.forget();
                // นักเรียนไม่มีสิทธิ์เข้าหน้าที่ครูใช้ พากลับหน้าใส่ PIN แทน จะได้ไม่วนเจอ "ไม่มีสิทธิ์"
                const allowed = result.user?.role === 'student' && /^\/(Make|host)\b/i.test(next) ? '/dashboard/' : next;
                location.href = allowed;
                return;
            }
            // เซิร์ฟเวอร์ส่งมาเป็นรหัส หน้าเว็บเป็นคนแปลเอง ข้อความจะได้ตามภาษาที่ผู้ใช้เลือก
            const code = result.code || 'serverError';
            setText(el.error, () => t('error.' + code, { min: result.min }));
        } catch {
            setText(el.error, () => t('error.network'));
        } finally {
            el.submit.disabled = false;
            el.submit.dataset.i18n = wasKey;
            KG.i18n.apply(el.form);
        }
    };

    paintMode();

    // ล็อกอินอยู่แล้วก็ไม่ต้องกรอกซ้ำ พาไปที่ที่ตั้งใจจะไปเลย
    // ยกเว้นกรณีถูกปฏิเสธสิทธิ์ ต้องให้เห็นข้อความก่อน ไม่งั้นจะเด้งกลับทันทีจนไม่รู้ว่าเกิดอะไรขึ้น
    const user = await KG.auth.me();
    if (user && !params.get('denied')) { location.href = next; return; }

    // ระบบยังว่างเปล่า บอกให้รู้ว่าสมัครคนแรกแล้วจะได้สิทธิ์แอดมิน แล้วเปิดแท็บสมัครไว้ให้เลย
    if (!KG.auth.systemHasUsers()) {
        setText(el.notice, () => t('auth.firstUserNote'));
        mode = 'register';
        paintMode();
    }
});
