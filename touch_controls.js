// touch_controls.js - Element-Relative Coordinate Input (v6 - Stable)
(function() {
    const canvas = document.getElementById('gameCanvas');
    const touchLayer = document.getElementById('touch-layer');
    
    // Configuration
    const KEY_MAP = [
        { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
    ];

    // State
    // activeTouches: Map<TouchIdentifier, LaneIndex>
    const activeTouches = new Map(); 
    // laneCounts: Array<Integer> - How many fingers are currently on this lane
    const laneCounts = [0, 0, 0, 0];

    // Visual Feedback Elements
    const cols = [
        document.getElementById('col-0'),
        document.getElementById('col-1'),
        document.getElementById('col-2'),
        document.getElementById('col-3')
    ];

// Input Smoothing State
const MIN_PRESS_MS = 50; // 50ms window to merge rapid jitter inputs
    const MIN_INTER_PRESS_DELAY = 80; // Absolute minimum time between distinct presses
    const _keyUpTimers = [null, null, null, null];
    const _lastPressTimes = [0, 0, 0, 0];
    
    // Global Keyboard Safety: Prevent "Auto-Repeat" spam when holding keys on desktop
    window.addEventListener('keydown', (e) => {
        if (e.repeat) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, { capture: true });

    // Internal function to actually fire the event
    function dispatchKey(laneIndex, type) {
        if (laneIndex < 0 || laneIndex > 3) return;
        
        const map = KEY_MAP[laneIndex];
        const event = new KeyboardEvent(type, {
            key: map.key,
            code: map.code,
            keyCode: map.keyCode, 
            which: map.keyCode,
            bubbles: true,
            cancelable: true,
            view: window,
            repeat: false
        });
        
        canvas.dispatchEvent(event);

        // Visual Feedback (Synced to Virtual State)
        if (type === 'keydown') {
            if (cols[laneIndex]) cols[laneIndex].classList.add('active');
            if (navigator.vibrate) navigator.vibrate(2); 
        } else {
            if (cols[laneIndex]) cols[laneIndex].classList.remove('active');
        }
    }

    // Public wrapper with Debounce/Smoothing Logic
function triggerKey(laneIndex, type) {
        const now = Date.now();

        if (type === 'keydown') {
            // 1. Debounce: Cancel pending release (merge jitter)
            if (_keyUpTimers[laneIndex] !== null) {
                clearTimeout(_keyUpTimers[laneIndex]);
                _keyUpTimers[laneIndex] = null;
                return; 
            }
            
            // 2. Rate Limit: Prevent inhumanly fast re-presses (spam protection)
            // If the last press was less than 80ms ago, ignore this new one.
            if (now - _lastPressTimes[laneIndex] < MIN_INTER_PRESS_DELAY) {
                return;
            }
            
            // Valid new press
            dispatchKey(laneIndex, 'keydown');
            _lastPressTimes[laneIndex] = now;
        }
        else if (type === 'keyup') {
            const heldTime = now - _lastPressTimes[laneIndex];
            const remaining = MIN_PRESS_MS - heldTime;

            if (remaining > 0) {
                // Released too fast! Delay the virtual release.
                // If the user presses again during this window, we'll merge it.
                _keyUpTimers[laneIndex] = setTimeout(() => {
                    dispatchKey(laneIndex, 'keyup');
                    _keyUpTimers[laneIndex] = null;
                }, remaining);
            } else {
                // Held long enough, release immediately
                dispatchKey(laneIndex, 'keyup');
            }
        }
    }

// CACHED METRICS (Performance Optimization)
    // accessing getBoundingClientRect() in a touchmove handler forces a layout reflow
    // which kills performance. We cache it instead.
    let cachedRect = { left: 0, width: 375 };
    
    function updateMetrics() {
        if (touchLayer) {
            const r = touchLayer.getBoundingClientRect();
            // Store simple values to avoid object referencing in hot path
            cachedRect = { 
                left: r.left, 
                width: r.width 
            };
        }
    }
    
    // Update on resize or scroll
    window.addEventListener('resize', updateMetrics);
    window.addEventListener('scroll', updateMetrics);
    // Initial measure
    setTimeout(updateMetrics, 100); 

    function getLaneFromCoords(clientX, currentLane) {
        // Fallback if not initialized
        if (cachedRect.width === 0) updateMetrics();

        const relativeX = clientX - cachedRect.left;
        const width = cachedRect.width;
        const pct = relativeX / width;

        // Base thresholds
        // By default, the touch layer is divided into four 25% lanes.  Player
        // feedback indicated the rightmost lane was still tricky to hit, so
        // these thresholds bias the divisions leftwards.  The values below
        // allocate roughly 22%, 22%, 23% and 33% of the surface to lanes 0–3
        // respectively (t1=22%, t2=44%, t3=67%).  Adjusting these numbers
        // directly changes the physical portion of the screen belonging to each
        // lane.
        let t1 = 0.22;
        let t2 = 0.44;
        let t3 = 0.67;

        // Hysteresis buffer: how much to expand the currently active lane to
        // prevent rapid lane‑hopping when a finger wobbles near the edges.
        // A 10% buffer offers stability without making adjacent lanes overly
        // difficult to trigger.  If players still find it hard to hit a lane,
        // reduce this value rather than increasing the thresholds further.
        const buffer = 0.10;

        if (typeof currentLane === 'number') {
            if (currentLane === 0) t1 += buffer;
            else if (currentLane === 1) { t1 -= buffer; t2 += buffer; }
            else if (currentLane === 2) { t2 -= buffer; t3 += buffer; }
            else if (currentLane === 3) { t3 -= buffer; }
        }

        if (pct < t1) return 0;
        if (pct < t2) return 1;
        if (pct < t3) return 2;
        return 3;
    }

function handleTouch(e) {
        // 1. UI Protection: Check if touching any UI layer
        let target = e.target;
        if (target.nodeType === 3) target = target.parentNode; // Fix for text nodes

        if (target.closest('#main-menu') || target.closest('#game-overlay') || target.closest('#practice-ui')) {
            // If interacting with a control, let the browser handle the click
            if (target.closest('button') || 
                target.tagName === 'INPUT' || 
                target.tagName === 'LABEL' || 
                target.closest('.song-item') ||
                target.closest('.mode-btn') ||
                target.closest('.filter-btn')) { 
                return;
            }
            // Otherwise, block game input and default gestures (scrolling) on the UI background
            if (e.cancelable && e.type !== 'touchend') e.preventDefault();
            return;
        }

        // 2. Prevent default to stop scrolling/zooming
        if (e.cancelable && e.type !== 'touchend' && e.type !== 'touchcancel') {
            e.preventDefault();
        }

        const changed = e.changedTouches;
        
        for (let i = 0; i < changed.length; i++) {
            const t = changed[i];
            const id = t.identifier;
            
let newLane = -1;
            
            // Only calculate lane for active touches (start/move)
            if (e.type !== 'touchend' && e.type !== 'touchcancel') {
                newLane = getLaneFromCoords(t.clientX, activeTouches.get(id));
            }

            const oldLane = activeTouches.get(id);

            // Optimization: If lane hasn't changed, ignore
            if (newLane === oldLane) continue;

            // Handle Release (Old Lane)
// Handle Release (Old Lane)
            if (oldLane !== undefined) {
                laneCounts[oldLane]--;
                if (laneCounts[oldLane] <= 0) { // Trigger keyup when the last finger leaves
                    laneCounts[oldLane] = 0; // Ensure count doesn't go negative
                    triggerKey(oldLane, 'keyup');
                }
            }

            // Handle Press (New Lane)
            if (newLane !== -1) {
                // Only trigger keydown if this is the *first* finger on this lane
                if (laneCounts[newLane] === 0) { 
                    triggerKey(newLane, 'keydown');
                }
                laneCounts[newLane]++;
            }

            // Update Map
            if (newLane !== -1) {
                activeTouches.set(id, newLane);
            } else {
                activeTouches.delete(id);
            }
        }
    }

// Bind listeners to window to catch touches even if they drift slightly off-canvas
    window.addEventListener('touchstart', handleTouch, { passive: false });
    window.addEventListener('touchmove', handleTouch, { passive: false });
    window.addEventListener('touchend', handleTouch, { passive: false });
    window.addEventListener('touchcancel', handleTouch, { passive: false });

// (Event listener removed: It was blocking heart icon clicks)
    console.log("Touch Controls: ACTIVE (v6.1 - Relative Coords + Event Isolation)");
})();