// ตัวช่วยฝั่งหน้าเว็บสำหรับระบบบัญชี
//
// โทเคนจริงอยู่ในคุกกี้แบบ HttpOnly หน้าเว็บอ่านไม่ได้ ต้องถามเซิร์ฟเวอร์ว่าใครล็อกอินอยู่
// เซิร์ฟเวอร์เป็นคนกันหน้าที่ต้องมีสิทธิ์อยู่แล้ว ฝั่งนี้แค่ทำให้ปุ่มกับป้ายชื่อถูกต้องเท่านั้น
window.KG = window.KG || {};

KG.auth = (() => {
    let cached;
    let hasUsers = true;

    return {
        // ถามครั้งเดียวต่อการโหลดหน้า ที่เหลืออ่านจากที่จำไว้
        async me() {
            if (cached !== undefined) return cached;
            try {
                const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
                const body = response.ok ? await response.json() : {};
                cached = body.user ?? null;
                hasUsers = body.hasUsers !== false;
            } catch {
                cached = null;
            }
            return cached;
        },

        // ต้องเรียก me() ก่อนถึงจะได้ค่าจริง ใช้บอกว่าคนที่สมัครคนแรกจะได้เป็นแอดมิน
        systemHasUsers() { return hasUsers; },

        forget() { cached = undefined; },

        async logout() {
            try {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
            } catch { /* ออฟไลน์ก็ถือว่าออกจากระบบแล้ว คุกกี้จะหมดอายุเอง */ }
            cached = null;
        },

        // แถบมุมขวาบน: ล็อกอินอยู่ก็โชว์ชื่อกับปุ่มออก ยังไม่ล็อกอินก็โชว์ปุ่มเข้าสู่ระบบ
        // ใส่ data-i18n-stable ให้กล่องกว้างคงที่ สลับภาษาแล้วของรอบ ๆ จะได้ไม่ขยับ
        async mountChip() {
            const user = await this.me();
            const bar = KG.tools();
            const chip = document.createElement('div');
            chip.className = 'auth-chip';

            if (user) {
                const who = document.createElement('span');
                who.className = 'auth-who';
                // ชื่อ role ยาวไม่เท่ากันสองภาษา ถ้าปล่อยให้ป้ายหดขยายตาม แถบมุมขวาจะเปลี่ยนความกว้าง
                // แล้วทั้งหน้าที่เผื่อที่ให้แถบนี้จะขยับตอนสลับภาษา จึงซ้อนไว้ทั้งสองภาษาเหมือนปุ่มอื่น
                const roleKey = 'auth.role' + user.role.charAt(0).toUpperCase() + user.role.slice(1);
                const labels = KG.i18n.all(roleKey);
                const texts = {};
                Object.keys(labels).forEach(code => { texts[code] = `${user.name} · ${labels[code]}`; });
                const paint = () => KG.i18n.stack(who, texts);
                paint();
                KG.i18n.onChange(paint);

                // ไอคอนกับข้อความแยกกัน จอแคบซ่อนเฉพาะข้อความไว้ ปุ่มจะได้เล็กพอไม่ไปเบียดหัวหน้า
                const withIcon = (node, icon, key) => {
                    const mark = document.createElement('span');
                    mark.className = 'auth-icon';
                    mark.textContent = icon;
                    const label = document.createElement('span');
                    label.className = 'auth-label';
                    label.dataset.i18n = key;
                    label.dataset.i18nStable = '';
                    node.append(mark, label);
                    return node;
                };

                const home = withIcon(document.createElement('a'), '📊', 'dash.open');
                home.className = 'auth-btn';
                home.href = '/dashboard/';

                const out = withIcon(document.createElement('button'), '🚪', 'auth.logout');
                out.type = 'button';
                out.className = 'auth-btn';
                out.onclick = async () => {
                    await KG.auth.logout();
                    location.href = '/page/';
                };
                // อยู่หน้ารวมอยู่แล้วก็ไม่ต้องมีลิงก์ไปหน้าตัวเอง
                if (location.pathname.startsWith('/dashboard')) chip.append(who, out);
                else chip.append(who, home, out);
            } else {
                const link = document.createElement('a');
                link.className = 'auth-btn';
                link.href = `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;
                link.dataset.i18n = 'auth.login';
                link.dataset.i18nStable = '';
                chip.appendChild(link);
            }

            bar.prepend(chip);
            KG.i18n.apply(chip);
            KG.measureTools();
            return user;
        }
    };
})();
