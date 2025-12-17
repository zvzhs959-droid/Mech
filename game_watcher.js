// game_watcher.js - Detects Game Over state from Canvas calls to trigger UI
(function() {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    const originalStrokeText = CanvasRenderingContext2D.prototype.strokeText;
let gameOverTriggered = false;
    let isGracePeriod = false; // Immunity window
    
    // SMART JUDGMENT FILTER
    // We track the last user input time. 
    // If the game draws "MISS" but the user hasn't pressed anything recently,
    // we assume it's a "Flyby Miss" and suppress the text.
    let lastInputTime = 0;
    window.addEventListener('keydown', () => { lastInputTime = Date.now(); });

// --- ADVANCED JUDGMENT ENGINE ---
    let lastJudgedInputTime = 0; 
    let _globalJudgmentTimer = 0; // The "Iron Fist" timer
    const VISUAL_HARD_LIMIT_MS = 120; // STRICT LIMIT: Max 1 judgment every 120ms. No exceptions.

    function shouldDrawText(text) {
        if (!text || typeof text !== 'string') return true;
        const now = Date.now();
        const cleanText = text.toUpperCase();

        // 1. WHITELIST: UI / SCORE / COMBO (Always Allow)
        // These patterns bypass all filters to ensure Score/Combo never disappear.
        if (/^\d+$/.test(cleanText) || // Pure numbers (Score)
            /SCORE|COMBO|TIME|READY|WAIT/.test(cleanText) || 
            cleanText.length < 3) { 
            return true;
        }
        
        // 2. JUDGMENT FILTER (The "Fountain" Controller)
        const isJudgment = /MISS|BAD|GOOD|GREAT|PERFECT|MARVELOUS|OK/.test(cleanText);

        if (isJudgment) {
            // A. FLYBY REMOVAL: If user hasn't pressed a key recently, it's a "ghost" miss. Hide it.
            if (cleanText.includes("MISS")) {
                if (now - lastInputTime > 300) return false; 
            }

            // B. INPUT LOCK: One judgment per physical keypress.
            // If this keypress has already triggered a text, BLOCK future texts for it.
            // This stops the "Machine Gun" effect when holding a key.
            if (lastInputTime === lastJudgedInputTime) {
                return false; 
            }

            // C. VISUAL HARD LIMIT: The "Clean Screen" Rule.
            // If we drew ANY judgment in the last 120ms, block this one.
            // This prevents stacking/overlapping text during jumps or fast streams.
            if (now - _globalJudgmentTimer < VISUAL_HARD_LIMIT_MS) {
                return false;
            }

            // --- PASS ---
            // Text is allowed. Update trackers.
            _globalJudgmentTimer = now;      // Reset visual timer
            lastJudgedInputTime = lastInputTime; // Mark this input as "spent"
            return true;
        }
        
        // Default: Allow unknown text (safety fallback)
        return true;
    }

    function checkText(text) {
        if (gameOverTriggered || isGracePeriod) return;
        if (!text || typeof text !== 'string') return;

        // OPTIMIZATION: Quick reject based on length
        if (text.length < 9) return;

        const cleanText = text.toUpperCase(); 
        // Detect Game Over text drawn by game.js
        if (cleanText.includes("GAME OVER") || cleanText.includes("TAP TO RETURN")) {
            console.log("Game Watcher: Game Over detected via Canvas Text!");
            gameOverTriggered = true;
            
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('stop-song'));
            }, 100);
        }
    }

    // Hook fillText
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
        // 1. Check if we should hide this judgment
        if (!shouldDrawText(text)) return;

        // 2. Check for Game Over trigger
        checkText(text);
        
        return originalFillText.apply(this, arguments);
    };

    // Hook strokeText (just in case)
    CanvasRenderingContext2D.prototype.strokeText = function(text, x, y, maxWidth) {
        if (!shouldDrawText(text)) return;
        checkText(text);
        return originalStrokeText.apply(this, arguments);
    };

    // Reset flag when song starts
// --- RESTART LOGIC ---
    let _lastSongEventDetail = null;

    window.addEventListener('song-start', (e) => {
        // Capture song data for restart capability
        _lastSongEventDetail = e.detail;

        gameOverTriggered = false;
        isGracePeriod = true;
        setTimeout(() => { isGracePeriod = false; }, 2000);
        console.log("Game Watcher: Song Started (Data Captured)");
    });

// --- CONTROL BUTTONS (RESTART & EXIT) ---
const restartBtn = document.getElementById('quick-restart-btn');
    const abortBtn = document.getElementById('abort-btn');

    // Helper: Bind both touch and click, ensuring priority over game inputs
    function bindSafeControl(btn, action) {
        if (!btn) return;
        
        const handler = (e) => {
            // Stop this event from bubbling to window (where touch_controls.js lives)
            e.stopPropagation();
            
            // If touch, prevent default (stops ghost clicks/zoom)
            if (e.type === 'touchstart') {
                e.preventDefault();
            }
            
            action();
        };

        btn.addEventListener('touchstart', handler, { passive: false });
        btn.addEventListener('click', handler);
    }

    // 1. Quick Restart
    // When the restart button is pressed we want to stop the current song, reload it,
    // and restart the visual/game state cleanly. We use the last captured song event
    // detail (from `song-start`) to restore the game mode and timing.
    bindSafeControl(restartBtn, () => {
        console.log("Game Watcher: Quick Restart...");
        /*
         * Rather than juggling multiple custom events to restart the game,
         * simply trigger the same logic used by the results screen's RETRY
         * button. Clicking the hidden retry button causes midi_manager.js
         * to reset the UI and call `_loadAndPlay` with the stored song
         * parameters. This avoids race conditions between different events
         * and ensures a clean restart regardless of the current game state.
         */
        const retryBtn = document.getElementById('retry-btn');
        if (retryBtn) {
            // If the button is disabled (during an end-of-song cooldown), remove
            // the disabled state so the click will register.
            retryBtn.classList.remove('disabled');
            retryBtn.click();
        } else {
            // Fallback: if retry button isn't found, fall back to the original
            // quick restart mechanism.
            window.dispatchEvent(new CustomEvent('quick-restart'));
        }
    });

    // 2. Sure‑Fire Exit
    // Tapping the abort button should cleanly stop the song, return to the menu
    // and restore the UI. We do all of that inside one handler.
    bindSafeControl(abortBtn, () => {
        console.log("Game Watcher: Aborting to Menu...");
        // Tell the MIDI manager to stop the current song and perform its own cleanup.
        window.dispatchEvent(new CustomEvent('abort-to-menu'));

        // Explicitly stop anything still playing for safety.
        window.dispatchEvent(new CustomEvent('stop-song'));

        // Simulate clicking the back button in the results/menu UI to restore the menu state.
        const nativeBackBtn = document.getElementById('menu-btn');
        if (nativeBackBtn) nativeBackBtn.click();

        // Force a UI reset shortly after stopping to ensure visuals are correct.
        setTimeout(() => {
            const uiLayer = document.getElementById('ui-layer');
            const mainMenu = document.getElementById('main-menu');
            const resultsPanel = document.getElementById('results-panel');
            const songList = document.getElementById('song-list');

            if (uiLayer) uiLayer.style.opacity = '1';
            if (mainMenu) mainMenu.style.display = 'flex';
            if (resultsPanel) resultsPanel.style.display = 'none';

            if (songList) {
                songList.style.display = 'block';
                songList.scrollTop = 0;
            }

            gameOverTriggered = false;
        }, 50);
    });

    console.log("Game Watcher: Active (Monitoring Canvas + Restart Logic)");
})();