document.addEventListener('DOMContentLoaded', () => {
    KG.i18n.apply();
    KG.i18n.mountToggle();
    KG.auth.mountChip();
    // ข้อความที่ JS วาดเองต้องวาดซ้ำด้วย ไม่ใช่แค่ apply() ที่ดูแลเฉพาะ data-i18n
    // กล่องใส่รูปกับข้อความใต้การ์ดคำตอบถูกสร้างด้วย innerHTML เลยไม่มี data-i18n ให้ apply() จับ
    KG.i18n.onChange(() => {
        KG.i18n.apply();
        relabelTrueFalse();
        loadSlideData(activeSlideIndex, true);
        renderSidebar();
    });

    // --- State Management ---
    let slides = [
        {
            id: 1,
            question: '',
            type: 'Quiz',
            timeLimit: '20 seconds',
            points: 'Standard',
            answerOptions: 'Single select',
            answers: ['', '', '', ''],
            correctIndex: 0,
            correctIndexes: [0],
            mediaUrl: null
        }
    ];
    let activeSlideIndex = 0;

    // คำตอบถูกเก็บเป็นชุดเสมอ ข้อที่ตั้ง "หลายคำตอบถูก" มีได้หลายข้อ ข้ออื่นมีข้อเดียว
    // correctIndex ยังเขียนคู่ไว้ (ข้อแรกของชุด) ให้ชุดคำถามเปิดกับเซิร์ฟเวอร์รุ่นเก่าได้
    const correctSet = (slide) => (Array.isArray(slide.correctIndexes) && slide.correctIndexes.length
        ? slide.correctIndexes
        : [slide.correctIndex ?? 0]);
    const isMulti = (slide) => slide.answerOptions === 'Multi-select' && slide.type !== 'True/False';
    const setCorrect = (slide, indexes) => {
        slide.correctIndexes = [...new Set(indexes)].sort((a, b) => a - b);
        slide.correctIndex = slide.correctIndexes[0];
    };
    const STORAGE_KEY = 'mangosgo.creatorDraft';

    // --- DOM Elements ---
    const titleInput = document.querySelector('.title-input');
    const saveBtn = document.querySelector('.btn-save');
    const questionInput = document.querySelector('.question-input');
    const answerInputs = document.querySelectorAll('.answer-input');
    const leftSidebar = document.querySelector('.left-sidebar');
    const addSlideBtn = document.querySelector('.add-slide-btn');
    const createSlideBtn = document.querySelector('.create-slide-btn');
    const mediaBox = document.querySelector('.media-box');
    const hostLink = document.querySelector('.host-link');

    // ชุดคำถามอยู่ที่เซิร์ฟเวอร์ ผูกกับบัญชีคนสร้าง เปิด /Make/?pin=... จากเครื่องไหนก็ได้ชุดเดิม
    // currentPin = null คือชุดใหม่ที่ยังไม่เคยบันทึก กด Save ครั้งแรกได้ PIN แล้วครั้งต่อไปบันทึกทับ PIN เดิม
    let currentPin = new URLSearchParams(location.search).get('pin');

    const showHostLink = (pin) => {
        hostLink.href = `../host/?pin=${encodeURIComponent(pin)}`;
        hostLink.hidden = false;
    };

    // คำ "จริง/เท็จ" ของข้อถูก/ผิดแสดงตามภาษาที่เปิดอยู่เสมอ (ในเกมผู้เล่นเห็นตามภาษาเครื่องตัวเองอยู่แล้ว)
    const relabelTrueFalse = () => {
        slides.forEach((slide) => {
            if (slide.type === 'True/False') slide.answers = [KG.i18n.t('make.true'), KG.i18n.t('make.false'), '', ''];
        });
    };

    // ข้อมูลเก่า (ร่างในเครื่อง หรือชุดที่บันทึกก่อนมีฟิลด์ใหม่) ต้องเติมให้ครบก่อนใช้
    const normalizeSlides = (list) => list.map((slide) => ({
        type: 'Quiz',
        timeLimit: '20 seconds',
        points: 'Standard',
        answerOptions: 'Single select',
        mediaUrl: null,
        ...slide,
        answers: [...(slide.answers || []), '', '', '', ''].slice(0, 4),
        correctIndexes: correctSet(slide)
    }));

    async function saveDraft() {
        saveBtn.disabled = true;
        // เขียนทับข้อความชั่วคราว ตอนจบต้องให้ i18n สร้างกล่องสองภาษากลับมาเอง
        saveBtn.textContent = KG.i18n.t('make.saving');
        try {
            const response = await fetch('../api/quizzes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: currentPin, title: titleInput.value.trim(), slides })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || result.code || 'Save failed');
            currentPin = result.pin;
            // ใส่ PIN ลง URL รีเฟรชหรือคัดลอกลิงก์ไปเปิดเครื่องอื่นจะได้ชุดเดิม
            history.replaceState(null, '', `?pin=${encodeURIComponent(result.pin)}`);
            // ของจริงอยู่ที่เซิร์ฟเวอร์แล้ว ร่างในเครื่องไม่ต้องเก็บ ไม่งั้นเปิดชุดใหม่ครั้งหน้าจะเด้งร่างเก่าขึ้นมา
            localStorage.removeItem(STORAGE_KEY);
            saveBtn.textContent = KG.i18n.t('make.savedPin', { pin: result.pin });
            localStorage.setItem('mangosgo.lastPin', result.pin);
            showHostLink(result.pin);
        } catch (error) {
            // บันทึกขึ้นเซิร์ฟเวอร์ไม่ได้ (เน็ตหลุด ฯลฯ) เก็บร่างไว้ในเครื่องก่อน งานจะได้ไม่หาย
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ pin: currentPin, title: titleInput.value, slides }));
            saveBtn.textContent = KG.i18n.t('make.savedLocal');
            console.warn(error.message);
        } finally {
            setTimeout(() => { saveBtn.textContent = ''; KG.i18n.apply(saveBtn.parentElement); }, 2500);
            titleInput.dispatchEvent(new Event('input'));
        }
    }

    // ร่างในเครื่องใช้เฉพาะชุดใหม่ที่ยังไม่เคยบันทึกขึ้นเซิร์ฟเวอร์ (หรือชุดเดียวกับที่บันทึกไม่สำเร็จ)
    function loadDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!draft || !Array.isArray(draft.slides) || !draft.slides.length) return;
            if ((draft.pin || null) !== currentPin) return;
            titleInput.value = draft.title || '';
            slides = normalizeSlides(draft.slides);
            activeSlideIndex = 0;
        } catch (error) {
            console.warn('Unable to load saved draft.', error);
        }
    }

    async function loadFromServer(pin) {
        try {
            const response = await fetch(`../api/quizzes/get?pin=${encodeURIComponent(pin)}`);
            const result = await response.json();
            if (!response.ok || !Array.isArray(result.slides) || !result.slides.length) throw new Error(result.code || 'load failed');
            titleInput.value = result.title || '';
            slides = normalizeSlides(result.slides);
            activeSlideIndex = 0;
            showHostLink(result.pin);
        } catch (error) {
            console.warn(error.message);
            currentPin = null;
            history.replaceState(null, '', location.pathname);
            alert(KG.i18n.t('make.loadFailed'));
        }
    }
    
    // Property Selects
    const propertySelects = document.querySelectorAll('.property-select');
    const questionTypeSelect = propertySelects[0];
    const timeLimitSelect = propertySelects[1];
    const pointsSelect = propertySelects[2];
    const answerOptionsSelect = propertySelects[3];

    // Sidebar Action Buttons
    const deleteBtn = document.querySelectorAll('.btn-action')[0];
    const duplicateBtn = document.querySelectorAll('.btn-action')[1];

    // --- Core Functions ---

    // Enable Save button when a title is entered
    titleInput.addEventListener('input', () => {
        if (titleInput.value.trim().length > 0) {
            saveBtn.removeAttribute('disabled');
            saveBtn.style.cursor = 'pointer';
            saveBtn.style.backgroundColor = '#1368ce';
            saveBtn.style.color = '#ffffff';
        } else {
            saveBtn.setAttribute('disabled', 'true');
            saveBtn.style.cursor = 'not-allowed';
            saveBtn.style.backgroundColor = '#e0e0e0';
            saveBtn.style.color = '#a0a0a0';
        }
    });
    saveBtn.addEventListener('click', saveDraft);

    // Update active slide state from input changes
    questionInput.addEventListener('input', (e) => {
        slides[activeSlideIndex].question = e.target.value;
    });

    answerInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            slides[activeSlideIndex].answers[index] = e.target.value;
        });
    });

    const answerGrid = document.querySelector('.answers-grid');
    const correctHint = answerGrid.querySelector('.correct-hint');

    // ข้อความใต้การ์ดคำตอบ JS เป็นเจ้าของที่เดียว (ถอด data-i18n ออกจาก HTML แล้ว)
    // ของเดิมเขียนทับด้วยข้อความไทยตายตัว ทำให้ element ที่ผูก data-i18n หายไป
    // พอกดเลือกคำตอบครั้งแรกแล้ว บรรทัดนี้จะค้างเป็นภาษาไทยตลอด สลับภาษาก็ไม่เปลี่ยน
    // null = ยังไม่ได้กดเลือกในรอบนี้ ให้โชว์คำแนะนำ กดแล้วค่อยเปลี่ยนเป็นข้อความยืนยัน
    // null = ยังไม่ได้กดเลือกในรอบนี้ / array = ชุดข้อที่เพิ่งเลือก
    let pickedHint = null;
    const paintCorrectHint = () => {
        const lead = document.createElement('span');
        if (pickedHint === null) lead.textContent = KG.i18n.t('make.pickCorrect');
        else if (pickedHint.length > 1) lead.textContent = KG.i18n.t('make.pickedCorrectMany', { list: pickedHint.map((i) => i + 1).join(', ') });
        else lead.textContent = KG.i18n.t('make.pickedCorrect', { n: pickedHint[0] + 1 });
        const mark = document.createElement('strong');
        mark.textContent = KG.i18n.t('make.greenIsCorrect');
        correctHint.replaceChildren(lead, document.createTextNode(' '), mark);
    };

    const answerCards = [...answerGrid.querySelectorAll('.answer-card')];
    const paintCorrectShapes = (slide) => {
        const set = correctSet(slide);
        answerCards.forEach((card, i) => card.querySelector('.answer-shape').classList.toggle('correct', set.includes(i)));
    };

    // ถูก/ผิด ใช้แค่สองการ์ดแรกและล็อกข้อความเป็น "จริง/เท็จ" ส่วน "หลายคำตอบถูก" ไม่มีความหมายกับคำถามแบบนี้
    const applyTypeLayout = (slide) => {
        const trueFalse = slide.type === 'True/False';
        answerCards.forEach((card, i) => { card.style.display = trueFalse && i > 1 ? 'none' : ''; });
        answerInputs.forEach((input, i) => { input.readOnly = trueFalse && i < 2; });
        answerOptionsSelect.disabled = trueFalse;
    };

    answerGrid.addEventListener('click', (event) => {
        const card = event.target.closest('.answer-card');
        if (!card || event.target.closest('.answer-input, .answer-media-btn')) return;
        const index = answerCards.indexOf(card);
        if (index < 0) return;
        const slide = slides[activeSlideIndex];
        if (isMulti(slide)) {
            // กดซ้ำเพื่อเอาออกได้ แต่ต้องเหลือคำตอบถูกอย่างน้อยหนึ่งข้อเสมอ
            const set = new Set(correctSet(slide));
            if (set.has(index) && set.size > 1) set.delete(index);
            else set.add(index);
            setCorrect(slide, [...set]);
        } else {
            setCorrect(slide, [index]);
        }
        paintCorrectShapes(slide);
        pickedHint = slide.correctIndexes;
        paintCorrectHint();
    });

    // Handle Dropdown Changes
    questionTypeSelect.addEventListener('change', (e) => {
        const slide = slides[activeSlideIndex];
        slide.type = e.target.value;
        if (slide.type === 'True/False') {
            slide.answers = [KG.i18n.t('make.true'), KG.i18n.t('make.false'), '', ''];
            slide.answerOptions = 'Single select';
            const first = correctSet(slide)[0];
            setCorrect(slide, [first > 1 ? 0 : first]);
        }
        loadSlideData(activeSlideIndex);
        renderSidebar();
    });

    timeLimitSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].timeLimit = e.target.value;
    });

    // ใช้เวลาของข้อนี้กับทุกข้อในชุด แล้วเปลี่ยนสีลิงก์แวบหนึ่งให้รู้ว่ากดติด
    const applyAllLink = document.querySelector('.apply-all-link');
    applyAllLink.addEventListener('click', () => {
        const value = slides[activeSlideIndex].timeLimit;
        slides.forEach((slide) => { slide.timeLimit = value; });
        applyAllLink.classList.add('is-done');
        setTimeout(() => applyAllLink.classList.remove('is-done'), 1200);
    });

    pointsSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].points = e.target.value;
    });

    answerOptionsSelect.addEventListener('change', (e) => {
        const slide = slides[activeSlideIndex];
        slide.answerOptions = e.target.value;
        // กลับเป็นคำตอบเดียว เก็บไว้แค่ข้อแรกของชุด
        if (!isMulti(slide)) setCorrect(slide, [correctSet(slide)[0]]);
        pickedHint = null;
        loadSlideData(activeSlideIndex, true);
    });

    // Load active slide data into UI
    // keepHint = true ใช้ตอนสลับภาษา ให้วาดข้อความใหม่แต่ไม่รีเซ็ตว่าเพิ่งเลือกคำตอบข้อไหน
    function loadSlideData(index, keepHint = false) {
        const slide = slides[index];
        questionInput.value = slide.question || '';
        
        answerInputs.forEach((input, i) => {
            input.value = slide.answers[i] || '';
        });

        questionTypeSelect.value = slide.type;
        timeLimitSelect.value = slide.timeLimit;
        pointsSelect.value = slide.points;
        answerOptionsSelect.value = slide.answerOptions;
        applyTypeLayout(slide);
        paintCorrectShapes(slide);
        // เปลี่ยนสไลด์แล้วกลับไปโชว์คำแนะนำ ไม่ใช่ค้างข้อความยืนยันของสไลด์ก่อน
        if (!keepHint) pickedHint = null;
        paintCorrectHint();
        mediaBox.style.backgroundImage = slide.mediaUrl ? `url(${slide.mediaUrl})` : '';
        mediaBox.style.backgroundSize = slide.mediaUrl ? 'cover' : '';
        mediaBox.style.backgroundPosition = slide.mediaUrl ? 'center' : '';
        // ข้อความในกล่องนี้ JS วาดเอง ไม่ได้ผ่าน data-i18n
        // ซ้อนคำแปลทุกภาษาไว้ในช่องเดียว กล่องจะได้กว้างเท่ากันเสมอ สลับภาษาแล้วข้อความไม่ขยับ
        mediaBox.replaceChildren();
        if (slide.mediaUrl) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'media-remove';
            KG.i18n.stack(remove, KG.i18n.all('make.removeMedia'));
            remove.addEventListener('click', (event) => {
                event.stopPropagation();
                slides[activeSlideIndex].mediaUrl = null;
                loadSlideData(activeSlideIndex, true);
            });
            mediaBox.append(remove);
        } else {
            const tools = document.createElement('div');
            tools.className = 'media-tools';
            tools.textContent = '🎭 🎬 🔊';

            const icon = document.createElement('div');
            icon.className = 'media-icon';
            icon.textContent = '+';
            icon.addEventListener('click', () => fileInput.click());

            const text = document.createElement('div');
            text.className = 'media-text';
            KG.i18n.stack(text, KG.i18n.all('make.findMedia'));

            const link = document.createElement('div');
            link.className = 'media-link';
            const underline = document.createElement('u');
            KG.i18n.stack(underline, KG.i18n.all('make.uploadFile'));
            const rest = document.createElement('span');
            KG.i18n.stack(rest, KG.i18n.all('make.dragHere'));
            link.append(underline, rest);
            link.addEventListener('click', () => fileInput.click());

            mediaBox.append(tools, icon, text, link);
        }
    }

    // Render Left Sidebar Thumbnails
    function renderSidebar() {
        // Remove existing slide thumbs except buttons
        const existingThumbs = leftSidebar.querySelectorAll('.slide-thumb');
        existingThumbs.forEach(thumb => thumb.remove());

        slides.forEach((slide, index) => {
            const thumb = document.createElement('div');
            thumb.className = `slide-thumb ${index === activeSlideIndex ? 'active' : ''}`;
            thumb.style.border = index === activeSlideIndex ? '2px solid #1368ce' : '1px solid #ccc';
            thumb.style.borderRadius = '4px';
            thumb.style.padding = '6px';
            thumb.style.background = '#f8f8f8';
            thumb.style.cursor = 'pointer';
            thumb.style.marginBottom = '8px';

            // slide.type เก็บค่าดิบไว้เหมือนเดิม (เป็น value ของ <select>) แต่ที่โชว์ต้องเป็นคำแปล
            const typeLabel = slide.type === 'True/False' ? KG.i18n.t('make.typeTF') : KG.i18n.t('make.typeQuiz');
            // สร้างด้วย textContent ไม่ใช่ innerHTML ข้อความคำถามเป็นสิ่งที่ครูพิมพ์เอง
            // ถ้าใส่ <img onerror=...> ไว้ จะไปรันบนเครื่องแอดมินที่เปิดชุดนี้มาแก้
            const title = document.createElement('div');
            title.className = 'slide-thumb-title';
            title.style.cssText = 'font-size: 10px; font-weight: 700;';
            title.textContent = `${index + 1} ${typeLabel}`;
            const preview = document.createElement('div');
            preview.className = 'slide-thumb-preview';
            preview.style.cssText = 'height: 50px; border: 1px dashed #ccc; border-radius: 2px; display: flex; align-items: center; justify-content: center; background: #fff; font-size: 9px; color: #888; overflow: hidden; padding: 2px; text-align: center;';
            preview.textContent = slide.question ? slide.question : KG.i18n.t('make.emptyQuestion');
            thumb.replaceChildren(title, preview);

            thumb.addEventListener('click', () => {
                activeSlideIndex = index;
                loadSlideData(activeSlideIndex);
                renderSidebar();
            });

            leftSidebar.insertBefore(thumb, addSlideBtn);
        });
    }

    // Add New Slide
    function addNewSlide() {
        const newSlide = {
            id: Date.now(),
            question: '',
            type: 'Quiz',
            timeLimit: '20 seconds',
            points: 'Standard',
            answerOptions: 'Single select',
            answers: ['', '', '', ''],
            correctIndex: 0,
            correctIndexes: [0],
            mediaUrl: null
        };
        slides.push(newSlide);
        activeSlideIndex = slides.length - 1;
        loadSlideData(activeSlideIndex);
        renderSidebar();
    }

    addSlideBtn.addEventListener('click', addNewSlide);
    createSlideBtn.addEventListener('click', addNewSlide);

    // Duplicate Current Slide
    duplicateBtn.addEventListener('click', () => {
        const current = slides[activeSlideIndex];
        const clonedSlide = JSON.parse(JSON.stringify(current));
        clonedSlide.id = Date.now();
        
        slides.splice(activeSlideIndex + 1, 0, clonedSlide);
        activeSlideIndex++;
        loadSlideData(activeSlideIndex);
        renderSidebar();
    });

    // Delete Current Slide
    deleteBtn.addEventListener('click', () => {
        if (slides.length <= 1) {
            alert("A quiz must have at least one question!");
            return;
        }
        slides.splice(activeSlideIndex, 1);
        activeSlideIndex = Math.max(0, activeSlideIndex - 1);
        loadSlideData(activeSlideIndex);
        renderSidebar();
    });

    // ใส่รูปได้ทั้งกดอัปโหลดและลากไฟล์มาวางบนกล่อง
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    const insertImage = (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        // จำไว้ว่าเป็นรูปของข้อไหน อ่านไฟล์เสร็จช้ากว่าที่ผู้ใช้กดเปลี่ยนข้อได้
        const target = slides[activeSlideIndex];
        const reader = new FileReader();
        reader.onload = (event) => {
            target.mediaUrl = event.target.result;
            if (slides[activeSlideIndex] === target) loadSlideData(activeSlideIndex, true);
        };
        reader.readAsDataURL(file);
    };

    fileInput.addEventListener('change', () => {
        insertImage(fileInput.files[0]);
        // ล้างค่าไว้ ลบรูปแล้วเลือกไฟล์เดิมซ้ำจะได้ยังเกิด change
        fileInput.value = '';
    });

    mediaBox.addEventListener('dragover', (event) => {
        event.preventDefault();
        mediaBox.classList.add('is-dragover');
    });
    mediaBox.addEventListener('dragleave', () => mediaBox.classList.remove('is-dragover'));
    mediaBox.addEventListener('drop', (event) => {
        event.preventDefault();
        mediaBox.classList.remove('is-dragover');
        insertImage(event.dataTransfer.files[0]);
    });

    // วาดหน้าเปล่าก่อนทันที แล้วค่อยเติมชุดจากเซิร์ฟเวอร์เมื่อโหลดเสร็จ
    const render = () => {
        relabelTrueFalse();
        loadSlideData(activeSlideIndex);
        renderSidebar();
        titleInput.dispatchEvent(new Event('input'));
    };
    loadDraft();
    render();
    if (currentPin) loadFromServer(currentPin).then(() => { loadDraft(); render(); });
    console.log("MangosGo Creator Studio JS initialized.");
});
