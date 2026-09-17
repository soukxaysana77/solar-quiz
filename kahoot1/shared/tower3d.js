// ฉาก 3D ของโหมดต่อตึก (Tower Stack) — ใช้บนจอ host กับ popup ตัวอย่างโหมดเท่านั้น มือถือผู้เล่นไม่โหลดไฟล์นี้
//
// หลักการ: ความสูงตึกของแต่ละคน = คะแนนสะสมพอดี ตึกบนจอจึงตรงกับแท่นรับรางวัลตอนจบเสมอ
//   บล็อกหนึ่งก้อน = คะแนนที่ได้จากหนึ่งข้อ (ตอบไวได้คะแนนเยอะ บล็อกเลยสูงกว่า)
//   ตอบผิด = บล็อกหล่นลงมาชนขอบแล้วพลิกร่วงหลุดตึก ตึกไม่โต · ไม่ตอบ = ไม่มีบล็อก
// วาดจากสถานะทั้งก้อนทุกครั้ง (players[].gains คะแนนรายข้อจากเซิร์ฟเวอร์) ไม่จำอะไรข้ามข้อ
// host รีเฟรชกลางเกมก็ประกอบตึกใหม่ได้ทันที
//
// ไฟล์นี้เป็น ES module ถูกโหลดด้วย import() ตอนเล่นโหมดนี้ครั้งแรก ห้องที่เล่นโหมดอื่นไม่ต้องโหลด three.js เลย
import * as THREE from './vendor/three.module.js';

const POINTS_PER_UNIT = 1000;   // 1000 คะแนน = สูง 1 หน่วย (ราวหนึ่งข้อที่ตอบถูกเร็ว)
const BLOCK_SIZE = 1.1;
const SPACING = 2.1;            // ระยะห่างระหว่างตึกในแถวเดียวกัน
const ROW_DEPTH = 1.3;          // แถวหลังห่างกว่าแนวนอนนิดหน่อย ป้ายชื่อจะได้ไม่ทับกัน
const DROP_FROM = 7;            // บล็อกหล่นลงมาจากเหนือยอดตึกเท่านี้
const DROP_MS = 520;
const SQUASH_MS = 180;
const MISS_MS = 1300;
const STAGGER_MS = 90;
// หน้าเฉลยค้างไว้ 6 วิ (LEADERBOARD_HOLD_MS) ทุกตึกต้องหล่นเสร็จเหลือเวลาให้คนดูผลก่อนขึ้นข้อถัดไป
const STAGGER_MAX_MS = 1800;
// ห้องใหญ่กว่านี้ตึกต้องเรียงหลายแถว ป้ายทุกตึกทับกันอ่านไม่ออก (ลองกับ 50 คนแล้ว)
// จึงติดป้ายชื่อแค่ 5 อันดับแรก และไม่โชว์ป้าย +คะแนน รายตึก
const CROWDED = 16;
const CROWDED_LABELS = 5;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeIn = (value) => value * value;
const heightOf = (points) => Math.max(0, Number(points) || 0) / POINTS_PER_UNIT;

// เครื่องโปรเจกเตอร์รุ่นเก่า / ปิด hardware acceleration ไว้ จะไม่มี WebGL ผู้เรียกต้องมีทางสำรอง
export function supported() {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
    } catch {
        return false;
    }
}

export function createTowerScene(container) {
    if (!supported()) throw new Error('WebGL is not available');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const root = document.createElement('div');
    root.className = 'tower-stage';
    // ชื่อผู้เล่นเป็น HTML ซ้อนบน canvas (ตัวหนังสือไทยใน WebGL ทำยากและไม่คม) ใส่ด้วย textContent เท่านั้น
    const labelLayer = document.createElement('div');
    labelLayer.className = 'tower-labels';

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'tower-canvas';
    root.append(renderer.domElement, labelLayer);
    container.replaceChildren(root);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#bfe3ff');
    scene.fog = new THREE.Fog('#bfe3ff', 60, 180);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight('#ffffff', '#6f8f5a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(160, 48),
        new THREE.MeshStandardMaterial({ color: '#8fcf7a', roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // geometry/material ใช้ร่วมกันทุกบล็อก ไม่สร้างใหม่ทุกข้อ (50 คน × หลายข้อ = บล็อกเป็นพัน)
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const padGeometry = new THREE.BoxGeometry(BLOCK_SIZE * 1.5, 0.2, BLOCK_SIZE * 1.5);
    const padMaterial = new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.9 });
    const crownGeometry = new THREE.OctahedronGeometry(0.35);
    const crownMaterial = new THREE.MeshStandardMaterial({
        color: '#ffd23f', emissive: '#a86b00', emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.35
    });
    const materials = new Map();
    const blockMaterial = (color, shade) => {
        const key = `${color}|${shade}`;
        if (!materials.has(key)) {
            const base = new THREE.Color(color);
            // บล็อกสลับเฉดอ่อน/เข้ม จะได้นับได้ว่าตึกนี้ต่อมากี่ชั้น
            if (shade) base.offsetHSL(0, 0, -0.1);
            materials.set(key, new THREE.MeshStandardMaterial({ color: base, roughness: 0.55 }));
        }
        return materials.get(key);
    };
    const makeBlock = (material, height) => {
        const mesh = new THREE.Mesh(boxGeometry, material);
        mesh.scale.set(BLOCK_SIZE, height, BLOCK_SIZE);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    };

    const world = new THREE.Group();
    scene.add(world);

    let towers = [];
    let startedAt = 0;
    let settleAt = 0;
    let layout = { width: 4, depth: 2, height: 2, rows: 1 };
    const goal = { dist: 14, y: 6, lookY: 1 };
    const view = { dist: 14, y: 6, lookY: 1, ready: false };

    const clearWorld = () => {
        // บล็อกที่ร่วงมี material ของตัวเอง (ต้องจางหายได้โดยไม่ลากบล็อกสีเดียวกันจางตาม) ต้องคืนหน่วยความจำเอง
        towers.forEach((tower) => tower.miss?.mesh.material.dispose());
        towers = [];
        world.clear();
        labelLayer.replaceChildren();
    };

    // ถอยกล้องให้เห็นทุกตึกทั้งกว้างและสูง คำนวณใหม่ทุกครั้งที่ตึกสูงขึ้นหรือจอเปลี่ยนขนาด
    const fitCamera = () => {
        const { width, depth, height, rows } = layout;
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const needHeight = (height + 2.5) / 2 / tanHalf;
        const needWidth = (width / 2 + 1.2) / (tanHalf * (camera.aspect || 1));
        goal.dist = Math.max(9, needHeight, needWidth) + depth / 2;
        goal.lookY = height * 0.5;
        // แถวเดียวมองเกือบระดับสายตา ตึกดูสูง · หลายแถวต้องก้มมองจากสูงขึ้น ไม่งั้นตึกแถวหน้าบังแถวหลังมิด
        goal.y = goal.lookY + goal.dist * (rows > 1 ? 0.3 + Math.min(rows, 5) * 0.12 : 0.28);

        const extent = Math.max(width, depth, height) * 0.8 + 4;
        sun.position.set(extent * 0.6, extent * 1.6 + height, extent);
        Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.5, far: extent * 6 });
        sun.shadow.camera.updateProjectionMatrix();
    };

    // state: { players, questionIndex, reveal, correctIndexes }
    //   reveal = false → ช่วงถาม โชว์ตึกของข้อที่ผ่านมาแล้วนิ่ง ๆ
    //   reveal = true  → ช่วงเฉลย บล็อกของข้อ questionIndex หล่นลงมา (หรือร่วงถ้าตอบผิด)
    function show({ players = [], questionIndex = 0, reveal = false, correctIndexes = [] } = {}) {
        clearWorld();
        startedAt = performance.now();

        // เรียงตามชื่อ ไม่ใช่ตามคะแนน ตึกจะอยู่ที่เดิมทุกข้อ ไม่สลับที่จนคนดูหาตึกตัวเองไม่เจอ
        const ordered = [...players].sort((a, b) =>
            String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
        const count = ordered.length;
        const cols = Math.max(1, count <= 10 ? count : Math.ceil(Math.sqrt(count * 2.2)));
        const rows = Math.max(1, Math.ceil(count / cols));

        const byScore = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
        const crowded = count > CROWDED;
        const labelled = new Set(byScore.slice(0, crowded ? CROWDED_LABELS : count).map((player) => player.id));
        const topScore = byScore[0]?.score || 0;
        const stagger = count > 1 ? Math.min(STAGGER_MS, STAGGER_MAX_MS / (count - 1)) : 0;

        let tallest = 2;
        ordered.forEach((player, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const x = (col - (cols - 1) / 2) * SPACING;
            const z = ((rows - 1) / 2 - row) * SPACING * ROW_DEPTH; // แถวแรกอยู่หน้าสุด
            const gains = Array.isArray(player.gains) ? player.gains : [];

            const pad = new THREE.Mesh(padGeometry, padMaterial);
            pad.position.set(x, 0.1, z);
            pad.receiveShadow = true;
            world.add(pad);

            // ทุกข้อก่อนหน้าข้อนี้เป็นชั้นที่วางเสร็จแล้ว (เซิร์ฟเวอร์จดไว้ใน gains ตามลำดับข้อ)
            let top = 0.2;
            let layers = 0;
            for (let q = 0; q < questionIndex; q++) {
                const height = heightOf(gains[q]);
                if (height <= 0) continue;
                const mesh = makeBlock(blockMaterial(player.avatar, layers % 2), height);
                mesh.position.set(x, top + height / 2, z);
                world.add(mesh);
                top += height;
                layers++;
            }

            const tower = { x, z, base: top, final: top, top, delay: index * stagger, drop: null, miss: null, label: null, chip: null, crown: null };

            if (reveal) {
                const points = Number(gains[questionIndex]) || 0;
                const answered = player.answerIndex !== null && player.answerIndex !== undefined;
                if (points > 0) {
                    const height = heightOf(points);
                    const mesh = makeBlock(blockMaterial(player.avatar, layers % 2), height);
                    world.add(mesh);
                    tower.drop = { mesh, height, points };
                    tower.final = top + height;
                } else if (answered && !correctIndexes.includes(player.answerIndex)) {
                    const material = blockMaterial(player.avatar, 0).clone();
                    material.transparent = true;
                    const mesh = makeBlock(material, 0.6);
                    world.add(mesh);
                    tower.miss = { mesh, side: index % 2 ? 1 : -1 };
                }
                // ตอบถูกแต่ได้ 0 (ข้อไม่คิดคะแนน) หรือไม่ตอบ ไม่มีบล็อก ความสูงต้องตรงกับคะแนนเสมอ
            }

            if (topScore > 0 && (player.score || 0) === topScore) {
                tower.crown = new THREE.Mesh(crownGeometry, crownMaterial);
                tower.crown.castShadow = true;
                world.add(tower.crown);
            }

            if (labelled.has(player.id)) {
                const label = document.createElement('div');
                label.className = 'tower-label';
                if (tower.drop && !crowded) {
                    tower.chip = document.createElement('span');
                    tower.chip.className = 'tower-gain';
                    tower.chip.textContent = `+${tower.drop.points}`;
                    label.appendChild(tower.chip);
                }
                const name = document.createElement('span');
                name.className = 'tower-name';
                name.textContent = player.name;
                label.appendChild(name);
                labelLayer.appendChild(label);
                tower.label = label;
            }

            tallest = Math.max(tallest, tower.final);
            towers.push(tower);
        });

        const lastDelay = towers.reduce((max, tower) => Math.max(max, tower.delay), 0);
        settleAt = reveal && !reduceMotion ? lastDelay + DROP_MS + SQUASH_MS + 150 : 0;
        layout = { width: Math.max(4, cols * SPACING), depth: rows * SPACING * ROW_DEPTH, height: tallest, rows };
        fitCamera();
    }

    const animate = (now) => {
        const elapsed = now - startedAt;
        for (const tower of towers) {
            const local = reduceMotion ? Infinity : elapsed - tower.delay;
            tower.top = tower.base;

            if (tower.drop) {
                const { mesh, height } = tower.drop;
                const progress = clamp01(local / DROP_MS);
                // ยุบตัวนิดหน่อยตอนกระแทก ให้รู้สึกว่าบล็อกมีน้ำหนัก
                const squash = progress >= 1 ? Math.max(0, 1 - (local - DROP_MS) / SQUASH_MS) * 0.12 : 0;
                const scaleY = height * (1 - squash);
                mesh.scale.set(BLOCK_SIZE * (1 + squash), scaleY, BLOCK_SIZE * (1 + squash));
                mesh.position.set(tower.x, tower.base + scaleY / 2 + DROP_FROM * (1 - easeIn(progress)), tower.z);
                if (progress >= 1) {
                    tower.top = tower.final;
                    tower.chip?.classList.add('is-shown');
                }
            }

            if (tower.miss) {
                const { mesh, side } = tower.miss;
                const progress = clamp01(local / MISS_MS);
                const hit = 0.4;
                if (progress < hit) {
                    // ช่วงแรก: หล่นลงมาเยื้องไปทางขอบตึก
                    mesh.position.set(tower.x + side * 0.55, tower.base + 0.3 + DROP_FROM * (1 - easeIn(progress / hit)), tower.z);
                    mesh.rotation.set(0, 0, 0);
                    mesh.material.opacity = 1;
                } else {
                    // ช่วงหลัง: ชนขอบแล้วพลิกร่วงข้างตึก จางหายก่อนถึงพื้น
                    const fall = (progress - hit) / (1 - hit);
                    mesh.position.set(
                        tower.x + side * (0.55 + fall * 1.6),
                        Math.max(-0.5, tower.base + 0.3 - fall * fall * (tower.base + 1.5)),
                        tower.z
                    );
                    mesh.rotation.set(0, 0, -side * fall * 2.2);
                    mesh.material.opacity = 1 - fall;
                }
                mesh.visible = progress < 1;
            }

            if (tower.crown) {
                tower.crown.visible = elapsed >= settleAt;
                const bob = reduceMotion ? 0 : Math.sin(now / 400) * 0.08;
                tower.crown.position.set(tower.x, tower.final + 0.6 + bob, tower.z);
                tower.crown.rotation.y = reduceMotion ? 0 : now / 900;
            }
        }
    };

    const moveCamera = (now, dt) => {
        const blend = view.ready ? 1 - Math.exp(-dt / 350) : 1;
        view.ready = true;
        view.dist += (goal.dist - view.dist) * blend;
        view.y += (goal.y - view.y) * blend;
        view.lookY += (goal.lookY - view.lookY) * blend;
        const angle = reduceMotion ? 0 : Math.sin(now / 5000) * 0.14;
        camera.position.set(Math.sin(angle) * view.dist, view.y, Math.cos(angle) * view.dist);
        camera.lookAt(0, view.lookY, 0);
    };

    const point = new THREE.Vector3();
    const placeLabels = () => {
        const width = root.clientWidth;
        const height = root.clientHeight;
        for (const tower of towers) {
            if (!tower.label) continue;
            const lift = tower.crown?.visible ? 1.05 : 0.35;
            point.set(tower.x, tower.top + lift, tower.z).project(camera);
            const onScreen = point.z < 1 && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1;
            tower.label.style.visibility = onScreen ? 'visible' : 'hidden';
            tower.label.style.transform =
                `translate(${((point.x + 1) / 2) * width}px, ${((1 - point.y) / 2) * height}px) translate(-50%, -100%)`;
        }
    };

    let raf = 0;
    let active = false;
    let lastFrame = 0;
    const tick = (now) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(100, now - lastFrame);
        lastFrame = now;
        animate(now);
        moveCamera(now, dt);
        renderer.render(scene, camera);
        placeLabels();
    };

    // วาดวนเฉพาะตอนฉากโชว์อยู่ เล่นโหมดอื่น/อยู่ล็อบบี้/จบเกม หยุดลูปไว้ ไม่กินเครื่องจอใหญ่ฟรี ๆ
    function setActive(on) {
        if (Boolean(on) === active) return;
        active = Boolean(on);
        if (active) {
            lastFrame = performance.now();
            raf = requestAnimationFrame(tick);
        } else {
            cancelAnimationFrame(raf);
        }
    }

    const resize = () => {
        const width = Math.max(1, root.clientWidth);
        const height = Math.max(1, root.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fitCamera();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);

    // คืน WebGL context ด้วย ไม่งั้นเปิดปิด popup ตัวอย่างหลายรอบจะชนเพดานจำนวน context ของเบราว์เซอร์
    function dispose() {
        setActive(false);
        observer.disconnect();
        clearWorld();
        [boxGeometry, padGeometry, crownGeometry, ground.geometry].forEach((geometry) => geometry.dispose());
        [padMaterial, crownMaterial, ground.material, ...materials.values()].forEach((material) => material.dispose());
        materials.clear();
        renderer.dispose();
        renderer.forceContextLoss();
        root.remove();
    }

    return { show, setActive, dispose };
}
