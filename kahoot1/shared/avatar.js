// นักบินอวกาศตัวเดียวใช้ทุกหน้า ต่างกันแค่สีชุดที่เซิร์ฟเวอร์แจกมา
// วาดเป็น SVG แทน CSS เพราะต้องย่อขยายไปวางได้ทั้งในชิปเล็ก ๆ และบนแท่นรับรางวัล
window.KG = window.KG || {};

KG.avatar = (() => {
    const BODY = 'M16 38C16 16 32 8 50 8C68 8 84 16 84 38L84 68C84 84 70 92 50 92C30 92 16 84 16 68Z';
    const FALLBACK = '#ffffff';

    // สีมาจากเซิร์ฟเวอร์ก็จริง แต่ค่านี้ถูกยัดลง innerHTML เลยกรองให้เหลือแค่ hex ก่อน
    const safeColor = color => (/^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK);

    function markup(color, size = 24) {
        const suit = safeColor(color);
        return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
            <g stroke="#000" stroke-width="7" stroke-linejoin="round">
                <rect x="4" y="44" width="18" height="30" rx="9" fill="${suit}" transform="rotate(15 13 59)"/>
                <rect x="78" y="44" width="18" height="30" rx="9" fill="${suit}" transform="rotate(-15 87 59)"/>
                <path d="${BODY}" fill="${suit}"/>
                <rect x="29" y="26" width="42" height="27" rx="13" fill="#161b22" stroke-width="6"/>
            </g>
            <circle cx="61" cy="34" r="4" fill="#fff" opacity=".85"/>
        </svg>`;
    }

    function el(color, size = 24) {
        const span = document.createElement('span');
        span.className = 'avatar';
        span.innerHTML = markup(color, size);
        return span;
    }

    return { markup, el };
})();
