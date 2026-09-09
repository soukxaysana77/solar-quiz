// ตัวสร้าง QR code แบบไม่พึ่งไลบรารีนอก (เน็ตโรงเรียนบล็อก CDN ได้ และหน้า host ไม่ควรรอสคริปต์ข้างนอก)
// รองรับเท่าที่งานนี้ใช้จริง: byte mode, ระดับกันพลาด M, เวอร์ชัน 1-10 (ยาวได้ถึง 216 ตัวอักษร)
// ลิงก์เข้าห้องยาวราว 50-60 ตัวอักษร ตกอยู่ที่เวอร์ชัน 3-4 เท่านั้น เหลือที่เผื่อโดเมนยาวกว่านี้อีกเยอะ
window.KG = window.KG || {};

KG.qr = (() => {
    // ---- เลขคณิตบนสนามจำกัด GF(256) ใช้ทำรหัสกันพลาด Reed-Solomon ----
    const EXP = new Uint8Array(512);
    const LOG = new Uint8Array(256);
    (() => {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11d;   // พหุนามเฉพาะประจำ QR
        }
        for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    })();
    const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

    // ตารางโครงสร้างบล็อกของระดับกันพลาด M: [จำนวน codeword ข้อมูลรวม, EC ต่อบล็อก, [จำนวนบล็อก, ข้อมูลต่อบล็อก], ...]
    const SPEC = {
        1:  { data: 16,  ec: 10, groups: [[1, 16]] },
        2:  { data: 28,  ec: 16, groups: [[1, 28]] },
        3:  { data: 44,  ec: 26, groups: [[1, 44]] },
        4:  { data: 64,  ec: 18, groups: [[2, 32]] },
        5:  { data: 86,  ec: 24, groups: [[2, 43]] },
        6:  { data: 108, ec: 16, groups: [[4, 27]] },
        7:  { data: 124, ec: 18, groups: [[4, 31]] },
        8:  { data: 154, ec: 22, groups: [[2, 38], [2, 39]] },
        9:  { data: 182, ec: 22, groups: [[3, 36], [2, 37]] },
        10: { data: 216, ec: 26, groups: [[4, 43], [1, 44]] }
    };

    // จุดกึ่งกลางของลายจุดยึด (alignment) แต่ละเวอร์ชัน
    const ALIGN = {
        1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };

    function generatorPoly(count) {
        let poly = [1];
        for (let i = 0; i < count; i++) {
            const next = new Array(poly.length + 1).fill(0);
            for (let j = 0; j < poly.length; j++) {
                next[j] ^= poly[j];
                next[j + 1] ^= mul(poly[j], EXP[i]);
            }
            poly = next;
        }
        return poly;
    }

    // หารยาวด้วยพหุนามกำเนิด เศษที่เหลือคือ codeword กันพลาดของบล็อกนั้น
    function ecBytes(data, ecCount) {
        const gen = generatorPoly(ecCount);
        const rem = new Uint8Array(data.length + ecCount);
        rem.set(data);
        for (let i = 0; i < data.length; i++) {
            const factor = rem[i];
            if (!factor) continue;
            for (let j = 0; j < gen.length; j++) rem[i + j] ^= mul(gen[j], factor);
        }
        return rem.slice(data.length);
    }

    // ---- แปลงข้อความเป็นสายบิตตามรูปแบบ byte mode ----
    function toCodewords(bytes, version) {
        const spec = SPEC[version];
        const bits = [];
        const push = (value, length) => {
            for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
        };

        push(0b0100, 4);                                   // ตัวบอกโหมด = byte
        push(bytes.length, version >= 10 ? 16 : 8);        // ตัวนับความยาว กว้างตามช่วงเวอร์ชัน
        for (const byte of bytes) push(byte, 8);

        const capacity = spec.data * 8;
        for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);   // ตัวปิดท้าย
        while (bits.length % 8 !== 0) bits.push(0);

        const codewords = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
            codewords.push(byte);
        }
        // เติมให้เต็มด้วยไบต์ตายตัวสองตัวสลับกันตามสเปก
        const PAD = [0xec, 0x11];
        while (codewords.length < spec.data) codewords.push(PAD[(codewords.length - bits.length / 8) % 2]);

        // แบ่งเป็นบล็อก คิด EC ของแต่ละบล็อก แล้วสานสลับกันตามลำดับที่สเปกกำหนด
        const dataBlocks = [];
        const ecBlocks = [];
        let at = 0;
        for (const [blockCount, blockSize] of spec.groups) {
            for (let i = 0; i < blockCount; i++) {
                const block = codewords.slice(at, at + blockSize);
                at += blockSize;
                dataBlocks.push(block);
                ecBlocks.push(ecBytes(Uint8Array.from(block), spec.ec));
            }
        }

        const out = [];
        const maxData = Math.max(...dataBlocks.map(b => b.length));
        for (let i = 0; i < maxData; i++) {
            for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
        }
        for (let i = 0; i < spec.ec; i++) {
            for (const block of ecBlocks) out.push(block[i]);
        }
        return out;
    }

    // ---- วางลายบังคับลงบนตาราง ----
    function buildBase(version) {
        const size = version * 4 + 17;
        const modules = Array.from({ length: size }, () => new Array(size).fill(null));
        const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

        const setArea = (row, col, height, width, painter) => {
            for (let r = 0; r < height; r++) {
                for (let c = 0; c < width; c++) {
                    const rr = row + r, cc = col + c;
                    if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
                    modules[rr][cc] = painter(r, c);
                    reserved[rr][cc] = true;
                }
            }
        };

        // ลายระบุมุม 3 มุม พร้อมเส้นคั่นรอบนอก
        for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
            setArea(row - 1, col - 1, 9, 9, () => false);
            setArea(row, col, 7, 7, (r, c) => {
                const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
                return ring !== 2;
            });
        }

        // เส้นจังหวะ
        for (let i = 8; i < size - 8; i++) {
            modules[6][i] = modules[i][6] = i % 2 === 0;
            reserved[6][i] = reserved[i][6] = true;
        }

        // ลายจุดยึด (เว้นตำแหน่งที่ทับลายระบุมุม)
        const centers = ALIGN[version];
        for (const row of centers) {
            for (const col of centers) {
                const corner = (row < 9 && col < 9) || (row < 9 && col > size - 10) || (row > size - 10 && col < 9);
                if (corner) continue;
                setArea(row - 2, col - 2, 5, 5, (r, c) => Math.max(Math.abs(r - 2), Math.abs(c - 2)) !== 1);
            }
        }

        // จองที่ให้ข้อมูลรูปแบบ (เขียนค่าจริงทีหลังเมื่อรู้ mask แล้ว) + โมดูลดำตายตัว
        for (let i = 0; i < 9; i++) {
            if (!reserved[8][i]) { modules[8][i] = false; reserved[8][i] = true; }
            if (!reserved[i][8]) { modules[i][8] = false; reserved[i][8] = true; }
        }
        for (let i = 0; i < 8; i++) {
            modules[8][size - 1 - i] = false; reserved[8][size - 1 - i] = true;
            modules[size - 1 - i][8] = false; reserved[size - 1 - i][8] = true;
        }
        modules[size - 8][8] = true; reserved[size - 8][8] = true;

        // ข้อมูลเวอร์ชัน (เฉพาะเวอร์ชัน 7 ขึ้นไป) 18 บิตพร้อมรหัสกันพลาด BCH
        if (version >= 7) {
            let bits = version << 12;
            for (let i = 0; i < 6; i++) {
                if (bits >> (17 - i) & 1) bits ^= 0x1f25 << (5 - i);
            }
            bits |= version << 12;
            for (let i = 0; i < 18; i++) {
                const bit = (bits >> i) & 1 ? true : false;
                const row = Math.floor(i / 3), col = i % 3;
                modules[row][size - 11 + col] = bit; reserved[row][size - 11 + col] = true;
                modules[size - 11 + col][row] = bit; reserved[size - 11 + col][row] = true;
            }
        }

        return { size, modules, reserved };
    }

    // เดินซิกแซกจากมุมขวาล่างขึ้นบน ทีละ 2 คอลัมน์ ข้ามคอลัมน์เส้นจังหวะ
    function placeData(base, codewords) {
        const { size, modules, reserved } = base;
        let bitIndex = 0;
        const nextBit = () => {
            const byte = codewords[bitIndex >> 3];
            const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
            return bit === 1;
        };

        let upward = true;
        for (let right = size - 1; right > 0; right -= 2) {
            if (right === 6) right = 5;      // คอลัมน์ 6 เป็นเส้นจังหวะ ข้ามไป
            for (let step = 0; step < size; step++) {
                const row = upward ? size - 1 - step : step;
                for (const col of [right, right - 1]) {
                    if (reserved[row][col]) continue;
                    modules[row][col] = nextBit();
                }
            }
            upward = !upward;
        }
    }

    const MASKS = [
        (r, c) => (r + c) % 2 === 0,
        (r) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
        (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
        (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    function applyMask(base, maskIndex) {
        const { size, modules, reserved } = base;
        const grid = modules.map(row => row.slice());
        const mask = MASKS[maskIndex];
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!reserved[r][c] && mask(r, c)) grid[r][c] = !grid[r][c];
            }
        }
        return grid;
    }

    // ข้อมูลรูปแบบ: ระดับกันพลาด 2 บิต + หมายเลข mask 3 บิต ต่อท้ายด้วย BCH แล้ว XOR ด้วยค่าคงที่
    function writeFormat(grid, size, maskIndex) {
        const EC_M = 0b00;
        let bits = (EC_M << 3) | maskIndex;
        let rest = bits << 10;
        for (let i = 0; i < 5; i++) {
            if (rest >> (14 - i) & 1) rest ^= 0x537 << (4 - i);
        }
        const format = ((bits << 10) | rest) ^ 0x5412;

        for (let i = 0; i < 15; i++) {
            const bit = ((format >> i) & 1) === 1;
            // สำเนาชุดที่ 1 รอบลายระบุมุมซ้ายบน
            if (i < 6) grid[i][8] = bit;
            else if (i === 6) grid[7][8] = bit;
            else if (i === 7) grid[8][8] = bit;
            else if (i === 8) grid[8][7] = bit;
            else grid[8][14 - i] = bit;
            // สำเนาชุดที่ 2 กระจายอยู่มุมขวาบนกับซ้ายล่าง
            if (i < 8) grid[8][size - 1 - i] = bit;
            else grid[size - 15 + i][8] = bit;
        }
    }

    // คะแนนโทษ 4 ข้อตามสเปก ยิ่งน้อยยิ่งอ่านง่าย ใช้เลือก mask ที่ดีที่สุด
    function penalty(grid, size) {
        let score = 0;

        const runScore = (line) => {
            let total = 0, run = 1;
            for (let i = 1; i < line.length; i++) {
                if (line[i] === line[i - 1]) run++;
                else { if (run >= 5) total += 3 + (run - 5); run = 1; }
            }
            if (run >= 5) total += 3 + (run - 5);
            return total;
        };
        for (let i = 0; i < size; i++) {
            score += runScore(grid[i]);
            score += runScore(grid.map(row => row[i]));
        }

        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const v = grid[r][c];
                if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
            }
        }

        const A = [true, false, true, true, true, false, true, false, false, false, false];
        const B = [false, false, false, false, true, false, true, true, true, false, true];
        const hasAt = (line, at, pattern) => pattern.every((v, i) => line[at + i] === v);
        for (let i = 0; i < size; i++) {
            const row = grid[i];
            const col = grid.map(r => r[i]);
            for (let j = 0; j + 11 <= size; j++) {
                if (hasAt(row, j, A) || hasAt(row, j, B)) score += 40;
                if (hasAt(col, j, A) || hasAt(col, j, B)) score += 40;
            }
        }

        let dark = 0;
        for (const row of grid) for (const v of row) if (v) dark++;
        const percent = (dark * 100) / (size * size);
        score += Math.floor(Math.abs(percent - 50) / 5) * 10;

        return score;
    }

    // ---- ทางเข้าใช้งาน ----
    function matrix(text) {
        const bytes = Array.from(new TextEncoder().encode(String(text)));
        const version = Object.keys(SPEC)
            .map(Number)
            .find(v => bytes.length + (v >= 10 ? 3 : 2) <= SPEC[v].data);
        if (!version) throw new Error('ข้อความยาวเกินกว่าที่ QR เวอร์ชัน 10 จะเก็บได้');

        const codewords = toCodewords(bytes, version);

        let best = null;
        for (let maskIndex = 0; maskIndex < 8; maskIndex++) {
            const base = buildBase(version);
            placeData(base, codewords);
            const grid = applyMask(base, maskIndex);
            writeFormat(grid, base.size, maskIndex);
            const score = penalty(grid, base.size);
            if (!best || score < best.score) best = { grid, score };
        }
        return best.grid;
    }

    // วาดเป็น SVG ชิ้นเดียว คมทุกขนาดจอและไม่ต้องใช้ canvas
    function svg(text, { size = 200, margin = 4, dark = '#000', light = '#fff' } = {}) {
        const grid = matrix(text);
        const count = grid.length;
        const span = count + margin * 2;

        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('viewBox', `0 0 ${span} ${span}`);
        node.setAttribute('width', size);
        node.setAttribute('height', size);
        node.setAttribute('shape-rendering', 'crispEdges');

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('width', span);
        bg.setAttribute('height', span);
        bg.setAttribute('fill', light);
        node.appendChild(bg);

        // รวมโมดูลดำที่ติดกันในแถวเดียวเป็นสี่เหลี่ยมเดียว จะได้ไม่ได้ SVG ที่มีหลายพัน element
        let path = '';
        for (let r = 0; r < count; r++) {
            let c = 0;
            while (c < count) {
                if (!grid[r][c]) { c++; continue; }
                let width = 1;
                while (c + width < count && grid[r][c + width]) width++;
                path += `M${c + margin} ${r + margin}h${width}v1h-${width}z`;
                c += width;
            }
        }
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', path);
        shape.setAttribute('fill', dark);
        node.appendChild(shape);

        return node;
    }

    return { matrix, svg };
})();
