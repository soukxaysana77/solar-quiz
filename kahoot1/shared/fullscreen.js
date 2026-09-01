// ปุ่มเข้า/ออกโหมดเต็มจอ วางคู่กับปุ่มเสียงมุมขวาบน
// iOS Safari ไม่รองรับ Fullscreen API กับ element ทั่วไป ถ้าไม่รองรับก็ไม่ต้องโชว์ปุ่ม
window.KG = window.KG || {};

KG.fullscreen = (() => {
    const supported = () => Boolean(
        document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
    );

    const isOn = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

    async function toggle() {
        try {
            if (isOn()) {
                await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
            } else {
                const root = document.documentElement;
                await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
            }
        } catch {
            /* ผู้ใช้กดยกเลิกหรือเบราว์เซอร์ไม่ยอม ปล่อยผ่าน ไม่ต้องทำอะไร */
        }
    }

    function mountToggle() {
        if (!supported()) return null;

        const button = document.createElement('button');
        button.className = 'fs-toggle';
        button.type = 'button';
        button.title = KG.i18n?.t('fullscreen.toggle') ?? 'เต็มจอ';
        const paint = () => { button.textContent = isOn() ? '✕' : '⛶'; };
        button.onclick = toggle;
        paint();
        document.addEventListener('fullscreenchange', paint);
        document.addEventListener('webkitfullscreenchange', paint);
        document.body.appendChild(button);
        return button;
    }

    return { mountToggle, toggle, isOn };
})();
