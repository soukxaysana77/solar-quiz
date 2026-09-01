document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const pinForm = document.querySelector('form');
    const pinInput = document.querySelector('.pin-input');
    const joinBtn = document.querySelector('.join-btn');
    const formMessage = document.querySelector('.form-message');

    // ปุ่มสลับภาษา ไทย/EN อยู่ใน shared/i18n.js ใช้ร่วมกับหน้าอื่นทั้งหมด
    const t = KG.i18n.t;
    KG.i18n.apply();
    KG.i18n.mountToggle();

    // --- Input Handling & Validation ---
    
    // Auto-focus input on page load
    if (pinInput) {
        pinInput.focus();
    }

    // Format PIN input (Only numbers allowed, auto-spaces every 3 digits if desired)
    pinInput.addEventListener('input', (e) => {
        // Remove non-numeric characters
        let cleanedValue = e.target.value.replace(/\D/g, '');
        
        // Limit max length to 6 digits (matches the PINs server.js generates)
        if (cleanedValue.length > 6) {
            cleanedValue = cleanedValue.slice(0, 6);
        }

        e.target.value = cleanedValue;

        // Visual feedback on button state
        if (cleanedValue.length >= 6) {
            joinBtn.classList.add('ready');
            joinBtn.style.opacity = '1';
            joinBtn.style.transform = 'scale(1.02)';
        } else {
            joinBtn.classList.remove('ready');
            joinBtn.style.opacity = '0.9';
            joinBtn.style.transform = 'scale(1)';
        }
    });

    // --- Form Submission ---
    pinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const pinValue = pinInput.value.trim();

        // Validate length
        if (pinValue.length < 6) {
            showInputError(t('page.pinTooShort'));
            return;
        }

        // Verify the PIN with the backend before entering the lobby.
        setLoadingState(true);
        fetch('../api/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pinValue })
        }).then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || t('page.joinFailed'));
            sessionStorage.setItem('mangosgo.activePin', pinValue);
            window.location.href = `../lobby/?pin=${encodeURIComponent(pinValue)}`;
        }).catch((error) => {
            setLoadingState(false);
            showInputError(error.message);
        });
    });

    // Display inline visual error indicator
    function showInputError(message) {
        pinInput.style.border = '2px solid #e21b3c';
        pinInput.style.animation = 'shake 0.3s ease-in-out';
        formMessage.textContent = message;
        
        // Remove shake animation class after completion
        setTimeout(() => {
            pinInput.style.animation = '';
            pinInput.style.border = '';
        }, 300);
    }

    // Toggle button UI loading state
    function setLoadingState(isLoading) {
        if (isLoading) {
            joinBtn.disabled = true;
            joinBtn.textContent = t('page.connecting');
            joinBtn.style.cursor = 'wait';
        } else {
            joinBtn.disabled = false;
            joinBtn.textContent = t('page.joinBtn');
            joinBtn.style.cursor = 'pointer';
        }
    }
});