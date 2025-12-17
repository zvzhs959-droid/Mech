// game.js - Main Game Loop & Logic
(function() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    
    // Constants
    const LANE_COUNT = 4;
    const LANE_WIDTH = canvas.width / LANE_COUNT;
    const TARGET_Y = canvas.height - 100;
    const LANE_COLORS = ['#ff0055', '#00ffff', '#00ff00', '#ffff00'];
    const ARROW_ANGLES = [Math.PI/2, 0, Math.PI, -Math.PI/2]; // Left, Down, Up, Right
    
    // Game State
let state = 'MENU'; // MENU, PLAYING, GAMEOVER
    let health = 100;
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let fever = 0;
    let feverActive = false;
    let level = 1;
    
    // Game Modes
    const GAME_MODES = {
        STANDARD: 'STANDARD',
        LEARN: 'LEARN',
        PRACTICE: 'PRACTICE'
    };
    let _gameMode = GAME_MODES.STANDARD;
    let _pausedForLearn = false;
let _currentPausedNotes = []; // The notes that caused the pause in LEARN mode
    let _isPracticePaused = false;
    // Entities
    let arrows = [];
    let particles = [];
    let popups = [];
    let stars = [];
    
    // Visuals
let camTilt = 0;
    let targetTilt = 0;
    let screenShake = 0;
    let beatPulse = 1.0;
    let comboScale = 1.0;
    let gridOffset = 0;
    let laneEffects = [0, 0, 0, 0];
    let hitStop = 0; // FRAME FREEZE for impact
    let chromaticAb = 0; // Chromatic Aberration intensity
    // Audio / MIDI
    let midiNotes = [];
    let nextNoteIndex = 0;
    let songStartTime = 0;
    let isMidiMode = false;
    let scrollSpeed = 8; // Pixels per frame
    
    // Input Map
    
// Input Map
    const KEYS = {
        'ArrowLeft': 0, 'KeyA': 0,
        'ArrowDown': 1, 'KeyS': 1,
        'ArrowUp': 2, 'KeyW': 2,
        'ArrowRight': 3, 'KeyD': 3
    };
    // Track held keys for Long Notes
    const _keyState = [false, false, false, false];

    // --- INITIALIZATION ---
// --- INITIALIZATION ---
// --- INITIALIZATION ---
function resetGame(mode = GAME_MODES.STANDARD) {
        score = 0;
        combo = 0;
        maxCombo = 0;
        health = 100;
        fever = 0;
        feverActive = false;
        level = 1;
        arrows = [];
        particles = [];
        popups = [];
        _gameMode = mode;
        _pausedForLearn = false;
        _currentPausedNotes = [];
        _isPracticePaused = false;
        
// Practice UI Visibility
// Practice UI Visibility
        const pUI = document.getElementById('practice-ui');
        if (pUI) {
            if (_gameMode === GAME_MODES.PRACTICE) {
                pUI.style.display = 'flex';
                // Reset Speed Display
                const speedVal = document.getElementById('p-speed-val');
                if(speedVal) speedVal.innerText = "1.0x";
                const pauseBtn = document.getElementById('p-pause');
                if(pauseBtn) pauseBtn.innerText = "PAUSE";
                window.dispatchEvent(new CustomEvent('set-speed', { detail: { speed: 1.0 } }));
            } else {
                pUI.style.display = 'none';
                window.dispatchEvent(new CustomEvent('set-speed', { detail: { speed: 1.0 } }));
            }
        }

        if (midiNotes && midiNotes.length > 0) {
            isMidiMode = true;
            nextNoteIndex = 0;
        } else {
            isMidiMode = false;
            songStartTime = Tone.now(); // For random mode
        }
    }

    // --- EVENTS ---
    window.addEventListener('midi-loaded', (e) => {
midiNotes = e.detail.notes;
        // Ensure we don't auto-start or anything, just wait for play button
        createPopup("SONG LOADED", "#0ff");
        // Reset to menu to wait for play
        state = 'MENU';
    });

window.addEventListener('song-start', (e) => {
        console.log("Song Starting...", e.detail.startTime, "Mode:", e.detail.mode);
        songStartTime = e.detail.startTime;
        resetGame(e.detail.mode); // Pass the selected mode
        state = 'PLAYING';
        isMidiMode = true;
    });

    // --- PHYSICS ENGINE ---



    // --- PHYSICS ENGINE ---
// --- PHYSICS ENGINE ---
function updatePhysics() {
        // Time Synchronization
        let songTime;
        if (isMidiMode) {
            songTime = Tone.Transport.seconds;
        } else {
            songTime = Tone.now() - songStartTime;
        }

        // Learn Mode Pause
// Learn Mode Pause
        if (_gameMode === GAME_MODES.LEARN && _pausedForLearn) {
            updateVisuals(songTime);
            return; 
        }
        
        // Practice Mode Pause
        if (_gameMode === GAME_MODES.PRACTICE && _isPracticePaused) {
            return;
        }

        // 1. Spawning & Moving Arrows
        if (state === 'PLAYING') {
            const pxPerSec = scrollSpeed * 60;

            if (isMidiMode) {
                const travelTime = (TARGET_Y + 50) / pxPerSec; 
                
                // Spawn notes
                let spawnCount = 0;
                while (nextNoteIndex < midiNotes.length && spawnCount < 50) {
                    const note = midiNotes[nextNoteIndex];
                    if (songTime >= note.time - travelTime) {
                        spawnArrow(note.lane, note.time, note.duration);
                        nextNoteIndex++;
                        spawnCount++;
                    } else {
                        break;
                    }
                }

                // Move Arrows
                arrows.forEach(a => {
                    const timeToHit = a.hitTime - songTime;
                    a.y = TARGET_Y - (timeToHit * pxPerSec);
                });

                // Check for Song End
                if (midiNotes.length > 0 && nextNoteIndex >= midiNotes.length && arrows.length === 0) {
                     const lastNoteTime = midiNotes[midiNotes.length-1].time;
                     if (songTime > lastNoteTime + 3) {
                        createPopup("SONG COMPLETE", "#fff");
                        state = 'GAMEOVER';
                     }
                }

            } else {
                // Random Mode
                if (Math.random() < 0.02 + (level * 0.005)) {
                    const travelTime = (TARGET_Y + 50) / pxPerSec;
                    spawnArrow(Math.floor(Math.random() * 4), songTime + travelTime, 0);
                }
                arrows.forEach(a => {
                    const timeToHit = a.hitTime - songTime;
                    a.y = TARGET_Y - (timeToHit * pxPerSec);
                });
            }
        }

        // 2. Learn Mode Logic (Simplified for brevity, same as before)
        if (_gameMode === GAME_MODES.LEARN && !_pausedForLearn) {
            const closestNote = arrows
                .filter(a => a.active && !a.isHolding && a.y > TARGET_Y - 30 && a.y < TARGET_Y + 30)
                .sort((a, b) => Math.abs(a.y - TARGET_Y) - Math.abs(b.y - TARGET_Y))[0];
            
            if (closestNote) {
                _pausedForLearn = true;
                _currentPausedNotes = arrows.filter(a => a.active && Math.abs(a.y - closestNote.y) < 20);
                window.dispatchEvent(new Event('pause-song'));
const dirs = ["◄", "▼", "▲", "►"];
                const lanes = [...new Set(_currentPausedNotes.map(n => n.lane))].sort((a,b)=>a-b);
                createPopup(lanes.map(l => dirs[l]).join("   "), "#ff0");
            }
        }

        // 3. Hit / Miss / Hold Logic
        arrows.forEach(a => {
            if (!a.active) return;

            // --- HOLD NOTE LOGIC ---
            if (a.isHolding) {
                // Check if key is still held
                if (!_keyState[a.lane]) {
                    // RELEASED TOO EARLY -> MISS
                    a.active = false;
                    a.isHolding = false;
                    combo = 0;
                    createPopup("DROP", "#888");
                    health -= 5;
                    return;
                }

                // Check if hold is complete (Tail passed target)
                // Tail end time = hitTime + duration
                if (songTime >= a.hitTime + a.duration) {
                    // COMPLETE!
                    a.active = false;
                    a.isHolding = false;
                    score += 100;
                    health = Math.min(100, health + 5);
                    createPopup("COMPLETE!", "#0f0");
                    createExplosion(a.x, TARGET_Y, a.color);
                    combo++;
                } else {
                    // STILL HOLDING - Tick Score
if (Math.random() < 0.3) { 
                        score += 5;
                        createExplosion(a.x, TARGET_Y, a.color); 
                    }
                    // Constant "Holding" Glow
                    laneEffects[a.lane] = 5; // Light up the lane beam
                    // Lock visual Y to target so tail flows through? 
                    // No, let it move, drawArrow handles the visual "consumption".
                }
                return;
            }

            // --- MISS LOGIC (Pass through bottom) ---
            // For hold notes, we check the HEAD. If head passes way below without being hit.
            if (a.y > TARGET_Y + 60) {
                a.active = false;
                combo = 0;
                if (_gameMode === GAME_MODES.STANDARD) health -= 10;
                fever = Math.max(0, fever - 20);
                createPopup("MISS", "#f00");
                screenShake = 10;
            }
        });
        
        // Cleanup
        arrows = arrows.filter(a => a.active || a.y < canvas.height + 500); // Increased buffer for long tails
        
        updateVisuals(songTime);
        
        if (_gameMode === GAME_MODES.STANDARD && health <= 0) {
            state = 'GAMEOVER';
        }
    }


    
function spawnArrow(lane, hitTime, duration = 0) {
        arrows.push({
            x: LANE_WIDTH * lane + LANE_WIDTH/2,
            y: -50,
            lane: lane,
            angle: ARROW_ANGLES[lane],
            color: LANE_COLORS[lane],
            active: true,
            hitTime: hitTime,
            duration: duration,
            isHolding: false
        });
    }

function updateVisuals(time) {
        // Camera & UI Physics
        camTilt += (targetTilt - camTilt) * 0.1;
        targetTilt *= 0.9;
        
        // Non-linear shake decay (snappier)
        if (screenShake > 0) screenShake = Math.max(0, screenShake * 0.85 - 0.1);
        if (chromaticAb > 0) chromaticAb *= 0.8;
        
        // Beat Pulse (Elastic decay)
        beatPulse = 1.0 + (beatPulse - 1.0) * 0.85;
        comboScale = 1.0 + (comboScale - 1.0) * 0.85;

        // Grid Movement
        gridOffset = (gridOffset + scrollSpeed * 0.5) % 80;

        // Lane Effects Decay (Exponential)
        for(let i=0; i<4; i++) if(laneEffects[i] > 0) laneEffects[i] *= 0.8;

        // Stars (Background Particles)
        if (stars.length < 50) {
            stars.push({
                x: (Math.random() - 0.5) * canvas.width * 1.5,
                y: (Math.random() - 0.5) * canvas.height * 1.5,
                z: Math.random() * 2 + 0.5,
                speed: Math.random() * 0.5 + 0.1
            });
        }
        stars.forEach(s => {
            s.z -= 0.02 * s.speed * (feverActive ? 4 : 1) * beatPulse; // Pulse speed with beat
            if (s.z <= 0.1) {
                s.z = 3;
                s.x = (Math.random() - 0.5) * canvas.width * 1.5;
                s.y = (Math.random() - 0.5) * canvas.height * 1.5;
            }
        });

        // Advanced Particle Physics
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            
            if (p.type === 'spark' || p.type === 'confetti') {
                p.vy += 0.5; // Gravity
                p.vx *= 0.95; // Air resistance
                p.angle += p.vAngle || 0;
            } else if (p.type === 'ring') {
                p.scale += 0.15;
                p.alpha -= 0.08;
            } else if (p.type === 'text') {
                p.y -= 1;
                p.vy += 0.2;
                p.alpha -= 0.02;
            }
        });
        particles = particles.filter(p => p.life > 0 && p.alpha > 0.01);
        
        // Popups (Judgement) with Physics
        popups.forEach(p => {
            p.y += p.vy;
            p.vy += 0.5; // Gravity
            p.life--;
            p.scale = Math.min(1.5, p.scale + 0.1); // Pop in
        });
        popups = popups.filter(p => p.life > 0);
    }

    // --- INPUT HANDLING ---
// --- INPUT HANDLING ---
function onInput(lane) {
        _keyState[lane] = true; // Mark key as held

        if (state === 'GAMEOVER') {
            state = 'MENU';
window.dispatchEvent(new Event('stop-song'));
            document.getElementById('practice-ui').style.display = 'none'; // Force hide on exit
            resetGame(_gameMode);
            return;
        }
        if (state === 'MENU') {
             if (midiNotes.length === 0) {
                 resetGame(_gameMode);
                 state = 'PLAYING';
             }
             return;
        }

        // Learn Mode Input
if (_gameMode === GAME_MODES.LEARN && _pausedForLearn) {
            // Find all notes in this lane that are currently paused
            const notesInLane = _currentPausedNotes.filter(n => n.lane === lane && n.active);
            
            if (notesInLane.length > 0) {
                // Hit the first one
                const hitNote = notesInLane[0];
                hitNote.active = false;
                
                // Anti-Frustration: If there are other notes in this lane very close (flams/bugs), clear them too
                // This fixes the "hit key but it won't go away" issue for overlapping notes
                notesInLane.forEach(n => {
                    if (Math.abs(n.y - hitNote.y) < 10) { // If within 10px (virtually identical)
                        n.active = false;
                    }
                });

                // Clean up inactive notes from the pause group
                _currentPausedNotes = _currentPausedNotes.filter(n => n.active);

                createPopup("GOOD!", "#0f0");
                createExplosion(LANE_WIDTH * lane + LANE_WIDTH/2, TARGET_Y, LANE_COLORS[lane]);
                score += 10;
                combo++;
                health = Math.min(100, health + 2);

                if (_currentPausedNotes.length === 0) {
                    _pausedForLearn = false;
                    window.dispatchEvent(new Event('resume-song'));
                }
            }
            return; 
        }
        
        laneEffects[lane] = 10;
        // Tilt
        if (lane === 0) targetTilt = -0.1;
        if (lane === 1) targetTilt = -0.05;
        if (lane === 2) targetTilt = 0.05;
        if (lane === 3) targetTilt = 0.1;

        // Hit Detection
        // Find closest active note in lane that isn't already being held
        const hit = arrows
            .filter(a => a.active && a.lane === lane && !a.isHolding)
            .sort((a, b) => Math.abs(a.y - TARGET_Y) - Math.abs(b.y - TARGET_Y))[0];

// Increased Hit Windows (More Forgiving)
// Increased Hit Windows (More Forgiving)
        if (hit && Math.abs(hit.y - TARGET_Y) < 80) { // Was 60
            const accuracy = Math.abs(hit.y - TARGET_Y);
            let text = "GOOD";
            let color = "#0ff";
            let pts = 10;
            let shake = 5;
            let freeze = 0;
            
            if (accuracy < 25) { 
                text = "MARVELOUS"; color = "#fff"; pts = 100; fever+=5; 
                shake = 20; freeze = 4; chromaticAb = 15;
            } 
            else if (accuracy < 45) { 
                text = "PERFECT"; color = "#ff0"; pts = 50; fever+=3; 
                shake = 10; freeze = 2; chromaticAb = 5;
            } 
            else if (accuracy < 70) { 
                text = "GREAT"; color = "#0f0"; pts = 20; fever+=1; 
                shake = 5;
            } 
            
            if (feverActive) pts *= 2;
            score += pts;
            combo++;
            maxCombo = Math.max(maxCombo, combo);
            health = Math.min(100, health + 2);
            
            createPopup(text, color);
            createExplosion(hit.x, hit.y, color);
            
            // JUICE: Impact
            screenShake = shake;
            hitStop = freeze;
            beatPulse = 1.2;
            comboScale = 1.5;

            // Handle Hold Notes
            if (hit.duration > 0) {
                hit.isHolding = true; // Start holding!
                // Don't set active=false yet
            } else {
                hit.active = false; // Instant kill for taps
            }
        }
    }

    function onRelease(lane) {
        _keyState[lane] = false;
        // Note: The actual "Miss" logic for releasing early is in updatePhysics
        // because we need to check if we are currently holding a specific note.
    }

    // --- DRAWING ---
function drawGame() {
        // 1. Background (Cyberpunk Grid)
        ctx.fillStyle = '#050010';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.save();
        
        // JUICE: Beat Zoom
        const zoom = 1.0 + (beatPulse - 1.0) * 0.05;
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.scale(zoom, zoom);
        ctx.translate(-canvas.width/2, -canvas.height/2);

        // JUICE: Screen Shake & Tilt
        const sx = (Math.random() - 0.5) * screenShake;
        const sy = (Math.random() - 0.5) * screenShake;
        ctx.translate(canvas.width/2 + sx, canvas.height/2 + sy);
        ctx.rotate(camTilt);
        ctx.translate(-canvas.width/2, -canvas.height/2);

        drawBackgroundGrid();

        // 2. Lanes & Receptors
        for(let i=0; i<4; i++) {
            const x = LANE_WIDTH * i + LANE_WIDTH/2;
            
            // Lane Beam (When pressed) - Additive Blending
            if (laneEffects[i] > 0.1) {
                ctx.globalCompositeOperation = 'lighter';
                const alpha = Math.min(1, laneEffects[i] / 5);
                const grad = ctx.createLinearGradient(0, TARGET_Y, 0, 0);
                grad.addColorStop(0, LANE_COLORS[i]);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                
                ctx.fillStyle = grad;
                ctx.fillRect(x - LANE_WIDTH/2, 0, LANE_WIDTH, TARGET_Y);
                
                // Flash at bottom
                ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                ctx.fillRect(x - LANE_WIDTH/2, TARGET_Y - 10, LANE_WIDTH, 20);
                
                ctx.globalCompositeOperation = 'source-over';
            }

            // Receptor (Target)
            const scale = (i % 2 === 0 ? beatPulse : 1.0 + (beatPulse-1.0)*0.5); 
            drawArrow(x, TARGET_Y, ARROW_ANGLES[i], '#444', scale, false);
        }

        // 3. Arrows (Notes) with Chromatic Aberration
        arrows.forEach(a => {
            if (a.active) {
                // Ghost Trails (Juice)
                if (scrollSpeed > 10 || feverActive) {
                   ctx.globalAlpha = 0.3;
                   drawArrow(a.x, a.y - 30, a.angle, a.color, 0.9, true, 0, false);
                   ctx.globalAlpha = 1.0;
                }
                
                // Main Arrow
                // If heavy shake, draw RGB split
                if (chromaticAb > 2) {
                    ctx.globalCompositeOperation = 'screen';
                    // Red Channel
                    drawArrow(a.x - chromaticAb/2, a.y, a.angle, '#f00', 1.0, true, a.duration, a.isHolding);
                    // Blue Channel
                    drawArrow(a.x + chromaticAb/2, a.y, a.angle, '#00f', 1.0, true, a.duration, a.isHolding);
                    ctx.globalCompositeOperation = 'source-over';
                }
                
                drawArrow(a.x, a.y, a.angle, a.color, 1.0, true, a.duration, a.isHolding);
            }
        });

        // 4. Particles (Enhanced)
        ctx.globalCompositeOperation = 'lighter';
        particles.forEach(p => {
            if (p.type === 'spark' || p.type === 'confetti') {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle || 0);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.life / 40;
                const size = p.type === 'confetti' ? 6 : 3;
                ctx.fillRect(-size/2, -size/2, size, size);
                ctx.restore();
            } else if (p.type === 'ring') {
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 5;
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.scale * 40, 0, Math.PI * 2);
                ctx.stroke();
            } else if (p.type === 'impact') {
                ctx.fillStyle = '#fff';
                ctx.globalAlpha = p.alpha;
                ctx.beginPath();
                for(let i=0; i<5; i++) {
                    const a = (Math.PI*2/5)*i;
                    ctx.lineTo(p.x + Math.cos(a)*40, p.y + Math.sin(a)*40);
                    ctx.lineTo(p.x + Math.cos(a+0.5)*15, p.y + Math.sin(a+0.5)*15);
                }
                ctx.fill();
            }
        });
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;

        // 5. UI Overlay
        drawUI();

        ctx.restore();
    }
    
function drawBackgroundGrid() {
        ctx.save();
        
        // Rotating Hyperspace Tunnel
        const time = Date.now() / 1000;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Dynamic Gradient Background
        const grad = ctx.createRadialGradient(centerX, centerY, 50, centerX, centerY, canvas.height);
        grad.addColorStop(0, '#200000');
        grad.addColorStop(1, '#000000');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.translate(centerX, centerY);
        ctx.rotate(time * 0.2); // Slow rotation

        ctx.strokeStyle = 'rgba(255, 0, 50, 0.3)';
        ctx.lineWidth = 2;

        // Draw Starburst Lines
        for (let i = 0; i < 12; i++) {
            ctx.rotate(Math.PI / 6);
            ctx.beginPath();
            ctx.moveTo(0, 50);
            ctx.lineTo(0, canvas.height);
            ctx.stroke();
        }

        // Draw Pulsing Rings
        ctx.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
            const size = (i * 100 + (time * 100)) % 600;
            const alpha = 1 - (size / 600);
            ctx.strokeStyle = `rgba(255, 0, 50, ${alpha})`;
            ctx.beginPath();
            
            // Hexagon Rings
            for(let j=0; j<6; j++) {
                const angle = (Math.PI / 3) * j;
                const r = size;
                const px = Math.cos(angle) * r;
                const py = Math.sin(angle) * r;
                if (j===0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }

        ctx.restore();
    }

function drawArrow(x, y, angle, color, scale = 1.0, isNote = false, duration = 0, isHolding = false) {
        ctx.save();
        ctx.translate(x, y);
        
        // --- DRAW HOLD TAIL ---
if (isNote && duration > 0) {
            const pxPerSec = scrollSpeed * 60;
            const tailLen = duration * pxPerSec;
            
            // Tail Gradient
            const grad = ctx.createLinearGradient(0, 0, 0, -tailLen);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'rgba(0,0,0,0)'); // Fade out at top

            // 1. Inner Glow
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(-10, -tailLen, 20, tailLen);
            
            // 2. Solid Borders for visibility
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(-10, 0);
            ctx.lineTo(-10, -tailLen);
            ctx.moveTo(10, 0);
            ctx.lineTo(10, -tailLen);
            ctx.stroke();

            // 3. Center Line for "Rail" look
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -tailLen);
            ctx.stroke();
            
            // 4. End Cap
            ctx.fillStyle = color;
            ctx.globalAlpha = 1.0;
            ctx.fillRect(-10, -tailLen - 2, 20, 4);
        }

        ctx.rotate(angle);
        ctx.scale(scale, scale);
        
        // Glow
        if (isNote) {
            ctx.fillStyle = color;
            ctx.globalAlpha = isHolding ? 0.8 : 0.3; // Brighter glow if holding
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(25, 25);
            ctx.lineTo(0, 15);
            ctx.lineTo(-25, 25);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Arrow Body
        // If holding, maybe make the core white pulse?
        ctx.fillStyle = isNote ? (isHolding ? '#fff' : '#eee') : '#222'; 
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(20, 20);
        ctx.lineTo(0, 10);
        ctx.lineTo(-20, 20);
        ctx.closePath();
        ctx.fill();
        
        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Center Detail
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 5, 4, 0, Math.PI*2);
        ctx.fill();

        ctx.restore();
    }

function drawUI() {
        // Sync Score to Global for MidiManager
        window.flux.score = score;
        window.flux.combo = combo;

        // --- HUD: Top Bar ---
        ctx.save();
        // Skewed Background for Score
        ctx.transform(1, 0, -0.3, 1, 0, 0); // Skew
        ctx.fillStyle = '#fff';
        ctx.fillRect(-50, 0, 250, 45);
        ctx.fillStyle = '#000';
        ctx.fillRect(-50, 42, 250, 5); // Underline
        
        ctx.font = 'bold 28px Anton';
        ctx.fillStyle = '#000';
        ctx.fillText(`SCORE: ${score}`, 10, 32);
        ctx.restore();

        // --- HUD: Health (Jagged Polygon) ---
        const barX = canvas.width - 20;
        const barY = canvas.height / 2;
        const barH = 300;
        const barW = 30;
        
        ctx.save();
        ctx.translate(barX, barY);
        
        // Draw Container (Jagged)
        ctx.beginPath();
        ctx.moveTo(0, -barH/2);
        ctx.lineTo(10, -barH/2 + 20);
        ctx.lineTo(-5, -barH/2 + 40);
        ctx.lineTo(5, barH/2);
        ctx.lineTo(-15, barH/2);
        ctx.lineTo(-20, -barH/2 + 50);
        ctx.lineTo(-10, -barH/2);
        ctx.closePath();
        
        ctx.fillStyle = '#333';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Clip for fill
        ctx.clip();
        
        // Fill based on health
        const fillY = (barH/2) - (health/100 * barH);
        ctx.fillStyle = health > 50 ? '#00ff00' : (health > 20 ? '#ffff00' : '#ff0000');
        ctx.fillRect(-30, fillY, 60, barH);
        
        ctx.restore();

        // --- COMBO (Explosive) ---
        if (combo > 5) {
            ctx.save();
            ctx.translate(canvas.width / 2, 180);
            
            // Thumping Scale
            const throb = 1.0 + Math.sin(Date.now() / 50) * 0.1;
            ctx.scale(comboScale * throb, comboScale * throb);
            ctx.rotate(-0.1); // Slight tilt
            
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.font = 'bold 80px Anton';
            ctx.textAlign = 'center';
            ctx.fillText(combo, 5, 5);
            
            // Main Text
            ctx.fillStyle = '#fff';
            // Outline
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 4;
            ctx.strokeText(combo, 0, 0);
            ctx.fillText(combo, 0, 0);
            
            ctx.font = 'bold 24px Anton';
            ctx.fillStyle = '#ffe600';
            ctx.fillText("COMBO!!", 0, 30);
            
            ctx.restore();
        }

        // Popups (Judgement)
// Popups (Judgement)
        popups.forEach(p => {
            ctx.save();
            ctx.translate(canvas.width/2, p.y);
            ctx.scale(p.scale, p.scale);
            
            // Clean, standard arcade style
            ctx.font = 'bold 36px Anton'; 
            ctx.textAlign = 'center';
            
            // Black Outline
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#000';
            ctx.strokeText(p.text, 0, 0);
            
            // Solid Color Fill
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, 0, 0);
            
            ctx.restore();
        });

        // Learn Mode Pause Indicator
if (_gameMode === GAME_MODES.LEARN && _pausedForLearn) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
            ctx.fillStyle = '#ff0';
            ctx.font = 'bold 30px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2 + 10);
        }
        
        if (_gameMode === GAME_MODES.PRACTICE && _isPracticePaused) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 40px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
        }
    }

function createPopup(text, color) {
        // Popups now have velocity for a "Bounce" effect
        popups.push({ 
            text, color, 
            y: TARGET_Y - 80, 
            vy: -8, // Initial jump velocity
            life: 60, 
            scale: 0.5 
        });
    }


    
function createExplosion(x, y, color) {
        // 1. Sparks (High velocity)
        for(let i=0; i<15; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 0.5) * 20,
                life: 30 + Math.random() * 20,
                color,
                type: 'spark',
                angle: Math.random() * Math.PI
            });
        }
        
        // 2. Confetti (Slower, floating)
        for(let i=0; i<8; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 10,
                vy: -5 - Math.random() * 10, // Upward burst
                life: 60,
                color: Math.random() < 0.5 ? '#fff' : color,
                type: 'confetti',
                angle: Math.random() * Math.PI,
                vAngle: (Math.random()-0.5) * 0.2
            });
        }

        // 3. Shockwave Ring
        particles.push({
            x, y,
            scale: 0.1,
            alpha: 1.0,
            life: 20,
            color,
            type: 'ring',
            vx:0, vy:0
        });

        // 4. Impact Flash
        particles.push({
            x, y,
            scale: 0.5,
            alpha: 1.0,
            life: 8,
            color: '#fff',
            type: 'impact',
            vx:0, vy:0
        });
    }

    // --- LOOP ---
// --- LOOP ---
function loop() {
        try {
            if (state === 'PLAYING') {
                // HIT STOP LOGIC (Freeze Frames)
                if (hitStop > 0) {
                    hitStop--;
                    // Still decay shake slightly so it doesn't look broken
                    if (screenShake > 0) screenShake *= 0.9;
                    drawGame(); // Redraw static frame
                } else {
                    updatePhysics();
                    drawGame();
                }
            } else if (state === 'MENU') {
                ctx.fillStyle = '#000';
                ctx.fillRect(0,0,canvas.width, canvas.height);
                
                // Stars in Menu
                ctx.fillStyle = '#fff';
                stars.forEach(s => {
                    const scale = 1/s.z;
                    const x = canvas.width/2 + s.x * scale;
                    const y = canvas.height/2 + s.y * scale;
                    if (x > 0 && x < canvas.width && y > 0 && y < canvas.height) ctx.fillRect(x, y, scale, scale);
                });

                ctx.fillStyle = '#0ff';
                ctx.textAlign = 'center';
                ctx.font = 'bold 30px Courier New';
                ctx.fillText("NEON DANCE", canvas.width/2, canvas.height/2 - 50);
                
                ctx.fillStyle = '#fff';
                ctx.font = '16px Courier New';
                if (midiNotes.length > 0) {
                     ctx.fillText("SONG LOADED!", canvas.width/2, canvas.height/2);
                     ctx.fillText("PRESS 'PLAY SONG' BUTTON", canvas.width/2, canvas.height/2 + 30);
                } else {
                    ctx.fillText("LOAD MIDI OR TAP TO START DEMO", canvas.width/2, canvas.height/2);
                }
            } else if (state === 'GAMEOVER') {
                 ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(0,0,canvas.width, canvas.height);
                ctx.fillStyle = '#f00';
                ctx.textAlign = 'center';
                ctx.font = 'bold 40px Courier New';
                ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2);
                ctx.font = '20px Courier New';
                ctx.fillStyle = '#fff';
                ctx.fillText(`SCORE: ${score}`, canvas.width/2, canvas.height/2 + 40);
                ctx.fillText("Tap to Return to Menu", canvas.width/2, canvas.height - 100);
            }
        } catch (e) {
            console.error("Game Loop Error:", e);
        }
        requestAnimationFrame(loop);
    }

    // --- LISTENERS ---
document.addEventListener('keydown', e => {
        if (KEYS[e.code] !== undefined && !e.repeat) onInput(KEYS[e.code]);
    });
    document.addEventListener('keyup', e => {
        if (KEYS[e.code] !== undefined) onRelease(KEYS[e.code]);
    });
// --- PRACTICE CONTROLS ---
    let currentSpeed = 1.0;
    
const _pSlower = document.getElementById('p-slower');
    if (_pSlower) {
        _pSlower.addEventListener('click', () => {
            currentSpeed = Math.max(0.25, currentSpeed - 0.25);
            document.getElementById('p-speed-val').innerText = currentSpeed.toFixed(1) + "x";
            window.dispatchEvent(new CustomEvent('set-speed', { detail: { speed: currentSpeed } }));
        });
        
        document.getElementById('p-faster').addEventListener('click', () => {
            currentSpeed = Math.min(2.0, currentSpeed + 0.25);
            document.getElementById('p-speed-val').innerText = currentSpeed.toFixed(1) + "x";
            window.dispatchEvent(new CustomEvent('set-speed', { detail: { speed: currentSpeed } }));
        });
        
        document.getElementById('p-pause').addEventListener('click', () => {
            window.dispatchEvent(new Event('toggle-pause'));
        });
        
        document.getElementById('p-exit').addEventListener('click', () => {
            window.dispatchEvent(new Event('stop-song'));
        });
    }

    // Sync Pause State
    window.addEventListener('song-paused-state', (e) => {
        _isPracticePaused = e.detail;
        document.getElementById('p-pause').innerText = _isPracticePaused ? "RESUME" : "PAUSE";
    });

    // Start
    loop();
})();