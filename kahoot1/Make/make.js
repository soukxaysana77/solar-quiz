document.addEventListener('DOMContentLoaded', () => {
    KG.i18n.apply();
    KG.i18n.mountToggle();
    KG.i18n.onChange(() => KG.i18n.apply());

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
            mediaUrl: null
        }
    ];
    let activeSlideIndex = 0;
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

    async function saveDraft() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ title: titleInput.value, slides }));
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            const response = await fetch('../api/quizzes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: titleInput.value.trim(), slides })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Save failed');
            saveBtn.textContent = `Saved (PIN ${result.pin})`;
            localStorage.setItem('mangosgo.lastPin', result.pin);
            hostLink.href = `../host/?pin=${encodeURIComponent(result.pin)}`;
            hostLink.hidden = false;
        } catch (error) {
            // localStorage remains available when the page is opened without the server.
            saveBtn.textContent = 'Saved locally';
            console.warn(error.message);
        } finally {
            setTimeout(() => { saveBtn.textContent = 'Save'; }, 2500);
            titleInput.dispatchEvent(new Event('input'));
        }
    }

    function loadDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!draft || !Array.isArray(draft.slides) || !draft.slides.length) return;
            titleInput.value = draft.title || '';
            slides = draft.slides;
            activeSlideIndex = 0;
        } catch (error) {
            console.warn('Unable to load saved draft.', error);
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
    answerGrid.addEventListener('click', (event) => {
        const card = event.target.closest('.answer-card');
        if (!card || event.target.closest('.answer-input, .answer-media-btn')) return;
        const cards = [...answerGrid.querySelectorAll('.answer-card')];
        const index = cards.indexOf(card);
        if (index < 0) return;
        slides[activeSlideIndex].correctIndex = index;
        cards.forEach((item, i) => item.querySelector('.answer-shape').classList.toggle('correct', i === index));
        const hint = answerGrid.querySelector('.correct-hint');
        hint.innerHTML = `เลือกคำตอบที่ ${index + 1} เป็นคำตอบที่ถูกต้อง <strong>✓ สีเขียว = คำตอบถูก</strong>`;
    });

    // Handle Dropdown Changes
    questionTypeSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].type = e.target.value;
        renderSidebar();
    });

    timeLimitSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].timeLimit = e.target.value;
    });

    pointsSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].points = e.target.value;
    });

    answerOptionsSelect.addEventListener('change', (e) => {
        slides[activeSlideIndex].answerOptions = e.target.value;
    });

    // Load active slide data into UI
    function loadSlideData(index) {
        const slide = slides[index];
        questionInput.value = slide.question || '';
        
        answerInputs.forEach((input, i) => {
            input.value = slide.answers[i] || '';
        });

        questionTypeSelect.value = slide.type;
        timeLimitSelect.value = slide.timeLimit;
        pointsSelect.value = slide.points;
        answerOptionsSelect.value = slide.answerOptions;
        document.querySelectorAll('.answer-shape').forEach((shape, i) => shape.classList.toggle('correct', i === (slide.correctIndex ?? 0)));
        mediaBox.style.backgroundImage = slide.mediaUrl ? `url(${slide.mediaUrl})` : '';
        mediaBox.style.backgroundSize = slide.mediaUrl ? 'cover' : '';
        mediaBox.innerHTML = slide.mediaUrl ? '' : '<div class="media-tools">🎭 🎬 🔊</div><div class="media-icon">+</div><div class="media-text">Find and insert media</div><div class="media-link"><u>Upload file</u> or drag here to upload</div>';
        mediaBox.querySelector('.media-link')?.addEventListener('click', () => fileInput.click());
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

            thumb.innerHTML = `
                <div class="slide-thumb-title" style="font-size: 10px; font-weight: 700;">${index + 1} ${slide.type}</div>
                <div class="slide-thumb-preview" style="height: 50px; border: 1px dashed #ccc; border-radius: 2px; display: flex; align-items: center; justify-content: center; background: #fff; font-size: 9px; color: #888; overflow: hidden; padding: 2px; text-align: center;">
                    ${slide.question ? slide.question : 'Question'}
                </div>
            `;

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

    // File Upload Handler (Simulated Media Insert)
    const mediaLink = document.querySelector('.media-link');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    mediaLink.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                slides[activeSlideIndex].mediaUrl = event.target.result;
                mediaBox.style.backgroundImage = `url(${event.target.result})`;
                mediaBox.style.backgroundSize = 'cover';
                mediaBox.style.backgroundPosition = 'center';
                mediaBox.innerHTML = ''; // Hide placeholders
            };
            reader.readAsDataURL(file);
        }
    });

    loadDraft();
    loadSlideData(activeSlideIndex);
    renderSidebar();
    titleInput.dispatchEvent(new Event('input'));
    console.log("MangosGo Creator Studio JS initialized.");
});
