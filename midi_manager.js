// midi_manager.js - Handles MIDI file parsing and audio playback
window.flux = window.flux || {};

(function() {
const _songList = document.getElementById('song-list');
    const _status = document.getElementById('status');
    const _uiLayer = document.getElementById('ui-layer');
    const _highScoreVal = document.getElementById('high-score-val');
    const _mainMenu = document.getElementById('main-menu');
    const _resultsPanel = document.getElementById('results-panel');
    const _resultScore = document.getElementById('result-score');
    const _resultRank = document.getElementById('result-rank');
const _abortBtn = document.getElementById('abort-btn');
    const _retryBtn = document.getElementById('retry-btn');
    const _menuBtn = document.getElementById('menu-btn');
    
    let _synths = []; 
    let _midiData = null;
    let _gameNotes = null;
    let _isPlaying = false;
    let _currentSongName = "";
    let _endTimeout = null;
    let _lastSongParams = null; // Store for retry
    let _canDismiss = false; // Debounce for results screen
    // Global Score State (Shared with Game)
    window.flux.score = 0;
    window.flux.combo = 0;

// --- DEVICE DETECTION ---
// Used for ergonomic chart cleanup rules.
// (Keep it simple + conservative; touch devices behave like "mobile" here.)
window.flux.isMobile = (typeof window.flux.isMobile === 'boolean') ? window.flux.isMobile : (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 1)
);

// --- DATA & STATE ---
const FAVORITES_KEY_V2 = 'flux_ddr_favorites_v2';
const DIFF_CACHE_KEY_V2 = 'flux_ddr_diff_cache_v2';
const REPO_CACHE_KEY = 'flux_ddr_repo_cache_v1';

// Migrate favorites if needed (old format was just filename strings).
const _favoritesRaw = JSON.parse(
    localStorage.getItem(FAVORITES_KEY_V2) ||
    localStorage.getItem('flux_ddr_favorites') ||
    '[]'
);
const _favorites = new Set(_favoritesRaw.map(x => (typeof x === 'string' && x.includes('::')) ? x : `Uhhh::${x}`));

// Difficulty cache (keyed by repo::filename)
const _difficultyCache = JSON.parse(
    localStorage.getItem(DIFF_CACHE_KEY_V2) ||
    localStorage.getItem('flux_ddr_diff_cache') ||
    '{}'
);

let _allMidis = [];

// --- REPO DEFINITIONS ---
const REPOS = [
    { owner: 'zvzhs959-droid', repo: 'Uhhh', label: 'UHHH' },
    { owner: 'zvzhs959-droid', repo: 'music', label: 'MUSIC' }
];

function _songKey(repoId, filename) {
    return `${repoId}::${filename}`;
}

function _getHighScore(songKey) {
    const v = localStorage.getItem(`flux_ddr_highscore_${songKey}`);
    const n = parseInt(v || '0', 10);
    return Number.isFinite(n) ? n : 0;
}

    // --- SYNC SETTINGS ---
    // Positive = Delays Visuals (Wait for Audio)
    // Negative = Advances Visuals
    const _SYNC_OFFSET = 0.15; 
// --- REPO FETCHING LOGIC ---
async function _fetchRepoContents(owner, repo) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/?per_page=100`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            let extra = '';
            try {
                const j = await response.json();
                if (j && j.message) extra = ` (${j.message})`;
            } catch (_) {}
            throw new Error(`Repo Access Failed: ${owner}/${repo}${extra}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error(`Unexpected GitHub response for ${owner}/${repo}`);
        }

        return data
            .filter(f => f && f.type === 'file')
            .filter(f => f.name && (f.name.toLowerCase().endsWith('.mid') || f.name.toLowerCase().endsWith('.midi')))
            .map(f => ({
                name: f.name,
                download_url: f.download_url,
                _repo: repo,
                _owner: owner
            }));
    } finally {
        clearTimeout(timeout);
    }
}

async function _fetchRepoList() {
    try {
        _status.innerText = "ACCESSING MAINFRAME...";

        // Setup Filter Toggle
        const favToggle = document.getElementById('fav-toggle');
        if (favToggle) {
            favToggle.onchange = () => _renderSongList(_allMidis);
        }

        // 0) Render cached list first (prevents permanent CONNECTING hang)
        try {
            const cached = JSON.parse(localStorage.getItem(REPO_CACHE_KEY) || 'null');
            if (cached && cached.repos) {
                const flat = [];
                REPOS.forEach(r => {
                    const arr = cached.repos[r.repo];
                    if (Array.isArray(arr)) {
                        arr.forEach(f => flat.push({ ...f, _repo: r.repo, _owner: r.owner }));
                    }
                });
                if (flat.length) {
                    _allMidis = flat;
                    _renderSongList(_allMidis);
                    _status.innerText = `CACHED LIST READY: ${_allMidis.length} TRACKS`;
                }
            }
        } catch (_) {}

        // 1) Fetch both repos (if one fails, still show the other)
        const results = await Promise.allSettled(
            REPOS.map(r => _fetchRepoContents(r.owner, r.repo))
        );

        const flat = [];
        results.forEach((res, idx) => {
            if (res.status === 'fulfilled') {
                flat.push(...res.value);
            } else {
                console.warn('Repo Fetch Failed:', REPOS[idx], res.reason);
            }
        });

        _allMidis = flat;

        // 2) Cache the successful results so next boot is instant
        try {
            const repoBuckets = {};
            REPOS.forEach(r => { repoBuckets[r.repo] = []; });
            _allMidis.forEach(f => {
                if (!repoBuckets[f._repo]) repoBuckets[f._repo] = [];
                repoBuckets[f._repo].push({ name: f.name, download_url: f.download_url });
            });
            localStorage.setItem(REPO_CACHE_KEY, JSON.stringify({
                t: Date.now(),
                repos: repoBuckets
            }));
        } catch (_) {}

        _renderSongList(_allMidis);
        _status.innerText = _allMidis.length ? `SYSTEM READY: ${_allMidis.length} TRACKS` : 'NO TRACKS FOUND';
    } catch (e) {
        console.error("Repo Fetch Error:", e);
        _songList.innerHTML = '<div class="song-item">CONNECTION ERROR</div>';
        _status.innerText = "NETWORK FAILURE";
    }
}

function _renderSongList(midis) {
    _songList.innerHTML = '';
    const showFavsOnly = document.getElementById('fav-toggle')?.checked;

    // Filter
    let displayList = midis;
    if (showFavsOnly) {
        displayList = midis.filter(m => _favorites.has(_songKey((m._repo || 'Uhhh'), m.name)));
    }

    if (displayList.length === 0) {
        _songList.innerHTML = '<div class="song-item">NO TRACKS FOUND</div>';
        return;
    }

    // Group by repo and render sections in a stable order
    const byRepo = new Map();
    displayList.forEach(f => {
        const repoId = f._repo || 'Uhhh';
        if (!byRepo.has(repoId)) byRepo.set(repoId, []);
        byRepo.get(repoId).push(f);
    });

    REPOS.forEach(repoInfo => {
        const files = byRepo.get(repoInfo.repo) || [];
        if (!files.length) return;

        const header = document.createElement('div');
        header.className = 'repo-header';
        header.innerText = repoInfo.label;
        _songList.appendChild(header);

        // Sort: Favorites first, then Alphabetical (within repo)
        files.sort((a, b) => {
            const keyA = _songKey(a._repo || 'Uhhh', a.name);
            const keyB = _songKey(b._repo || 'Uhhh', b.name);
            const isFavA = _favorites.has(keyA);
            const isFavB = _favorites.has(keyB);
            if (isFavA && !isFavB) return -1;
            if (!isFavA && isFavB) return 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(file => {
            const displayName = file.name.replace(/\.mid$/i, '').replace(/\.midi$/i, '').replace(/_/g, ' ');
            const key = _songKey(file._repo || 'Uhhh', file.name);
            const diffStars = _difficultyCache[key] || "<span style='opacity:0.3'>???</span>";
            const isFav = _favorites.has(key);
            const highScore = _getHighScore(key);

            const item = document.createElement('div');
            item.className = 'song-item';

            item.innerHTML = `
                <div class="song-content">
                    <div class="song-name">${displayName}</div>
                    <div class="song-score">BEST: ${highScore.toString().padStart(6, '0')}</div>
                </div>
                <div class="song-meta">
                    <div class="star-rating">${diffStars}</div>
                    <div class="fav-icon ${isFav ? 'is-fav' : ''}">♥</div>
                </div>
            `;

            // Click Handler (Play)
            item.onclick = (e) => {
                if (e.target.classList.contains('fav-icon')) return;

                document.querySelectorAll('.song-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                _loadAndPlay(file.download_url, file.name, item, (file._repo || 'Uhhh'));
            };

            // Favorite Handler
            const favBtn = item.querySelector('.fav-icon');
            favBtn.onclick = (e) => {
                e.stopPropagation();
                _toggleFavorite(key, favBtn);
            };

            _songList.appendChild(item);
        });
    });
}

function _toggleFavorite(songKey, btnElement) {
    if (_favorites.has(songKey)) {
        _favorites.delete(songKey);
        btnElement.classList.remove('is-fav');
    } else {
        _favorites.add(songKey);
        btnElement.classList.add('is-fav');
    }
    localStorage.setItem(FAVORITES_KEY_V2, JSON.stringify([..._favorites]));

    // Re-render if in "Favorites Only" mode to remove it instantly
    if (document.getElementById('fav-toggle')?.checked) {
        _renderSongList(_allMidis);
    }
}

_fetchRepoList();
// --- HIGH SCORE SYSTEM ---
function _updateHighScoreDisplay(songKey) {
    const score = _getHighScore(songKey);
    _highScoreVal.innerText = score.toString().padStart(6, '0');
}

function _saveHighScore(songKey, score) {
    const key = `flux_ddr_highscore_${songKey}`;
    const currentHigh = parseInt(localStorage.getItem(key) || 0);
    if (score > currentHigh) {
        localStorage.setItem(key, score);
        return true; // New Record
    }
    return false;
}


    // --- LOAD & PLAY ---
async function _loadAndPlay(url, name, uiElement, repoId) {
        if (_isPlaying) return;
        
        // Store for retry
        _lastSongParams = { url, name, uiElement, repoId: (repoId || 'Uhhh') };

        const prevText = uiElement ? uiElement.innerText : "";
        if (uiElement) {
            uiElement.innerText = "DOWNLOADING...";
            uiElement.classList.add('loading');
        }
        const songKey = _songKey((repoId || 'Uhhh'), name);
        _status.innerText = `LOADING: ${name}`;
        _currentSongName = songKey;
        _updateHighScoreDisplay(songKey);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Download failed");
            const buff = await response.arrayBuffer();
            
            await _parseMidi(buff);
            
if (_midiData && _gameNotes) {
                // Calculate and Cache Difficulty
                const diff = _calculateDifficulty(_gameNotes, _midiData.duration);
                _difficultyCache[songKey] = diff; // key is repo::filename
                localStorage.setItem(DIFF_CACHE_KEY_V2, JSON.stringify(_difficultyCache));
                
                // Update UI immediately if possible
                if (uiElement) {
                    const starEl = uiElement.querySelector('.star-rating');
                    if (starEl) starEl.innerText = diff;
                }

                await Tone.start();
                _playSong(_midiData, _gameNotes);
            }
        } catch (e) {
            console.error(e);
            _status.innerText = "LOAD ERROR";
            uiElement.innerText = "ERROR";
        } finally {
if (uiElement && uiElement.innerText === "DOWNLOADING...") {
                uiElement.innerText = prevText;
            }
            if (uiElement) uiElement.classList.remove('loading');
        }
    }

    // --- PARSING ---
async function _parseMidi(arrayBuffer) {
        const midi = new Midi(arrayBuffer);
        _midiData = midi;
        
        let rawNotes = [];
        midi.tracks.forEach(track => {
            if (track.notes.length > 0) {
                track.notes.forEach(note => {
                    rawNotes.push({
                        time: note.time,
                        lane: note.midi % 4,
                        duration: note.duration,
                        midi: note.midi,
                        velocity: note.velocity
                    });
                });
            }
        });

        // Sort by time
        rawNotes.sort((a, b) => a.time - b.time);

        // --- STEP 1: QUANTIZATION (Snap close notes) ---
        // If notes are within 50ms of each other, align them to the first one's time.
        // This fixes "flams" or messy chords.
        for (let i = 0; i < rawNotes.length - 1; i++) {
            const curr = rawNotes[i];
            const next = rawNotes[i+1];
            if (Math.abs(next.time - curr.time) < 0.05) { 
                next.time = curr.time; 
            }
        }

        // --- STEP 2: MERGE & DEDUPLICATE (Same Lane) ---
        const uniqueNotes = [];
        if (rawNotes.length > 0) {
            uniqueNotes.push(rawNotes[0]);
            
            for (let i = 1; i < rawNotes.length; i++) {
                const prev = uniqueNotes[uniqueNotes.length - 1];
                const curr = rawNotes[i];
                
                // If same lane...
                if (curr.lane === prev.lane) {
                    // Calculate gap between end of Prev and start of Curr
                    const prevEnd = prev.time + prev.duration;
                    const gap = curr.time - prevEnd;

                    // If they overlap or are virtually on top of each other (< 0.1s gap)
                    if (gap < 0.1) {
                        // MERGE: Extend the previous note to cover this one
                        // New duration = (End of Curr) - (Start of Prev)
                        const newEnd = Math.max(prevEnd, curr.time + curr.duration);
                        prev.duration = newEnd - prev.time;
                        
                        // Skip adding 'curr' as a separate note
                        continue; 
                    }
                }
                uniqueNotes.push(curr);
            }
        }
        
// --- STEP 3: ERGONOMIC CLEANUP (Touch Optimization) ---
// Goal: On mobile/touch devices, never require more than 2 simultaneous inputs
// (holds count as "occupied fingers" while active).

// A) Filter short holds (legato vs intentional hold)
uniqueNotes.forEach(n => {
    if (n.duration < 0.3) n.duration = 0;
});

const isMobile = !!window.flux.isMobile;
const maxFingers = isMobile ? 2 : 4;
const TIME_EPS = 0.001;

// B) Finger-budget filter (caps simultaneous holds + chord starts)
const cleaned = [];
let activeHolds = []; // { endTime: number }

let i = 0;
while (i < uniqueNotes.length) {
    const t = uniqueNotes[i].time;

    // Remove expired holds
    activeHolds = activeHolds.filter(h => h.endTime > t + 0.0001);

    // Gather chord group (same snapped time)
    const group = [];
    while (i < uniqueNotes.length && Math.abs(uniqueNotes[i].time - t) < TIME_EPS) {
        group.push(uniqueNotes[i]);
        i++;
    }

    let available = maxFingers - activeHolds.length;
    if (available <= 0) {
        continue; // cannot start anything new right now
    }

    // Rank notes: prefer taps slightly over holds (holds create long commitments)
    group.sort((a, b) => {
        const va = (a.velocity ?? 0);
        const vb = (b.velocity ?? 0);
        const pa = va + (a.duration > 0 ? -0.05 : 0);
        const pb = vb + (b.duration > 0 ? -0.05 : 0);
        if (pb !== pa) return pb - pa;
        return (a.midi ?? 0) - (b.midi ?? 0);
    });

    const kept = group.slice(0, available);
    kept.forEach(n => {
        cleaned.push(n);
        if (n.duration > 0) {
            activeHolds.push({ endTime: n.time + n.duration });
        }
    });
}

// Maintain stable order for the renderer
cleaned.sort((a, b) => (a.time - b.time) || (a.lane - b.lane));

_gameNotes = cleaned;

        
        window.dispatchEvent(new CustomEvent('midi-loaded', { 
            detail: { notes: _gameNotes, midi: midi } 
        }));
    }

    function _calculateDifficulty(notes, duration) {
        if (duration <= 0 || notes.length === 0) return "★";
        const nps = notes.length / duration;
        
        if (nps < 2) return "★";
        if (nps < 4) return "★★";
        if (nps < 6) return "★★★";
        if (nps < 9) return "★★★★";
        return "★★★★★";
    }

    // --- AUDIO ENGINE (OSRS STYLE) ---
let _limiter = null;

    // --- AUDIO ENGINE (OSRS STYLE - OPTIMIZED) ---
function _getSynthForInstrument(program, isDrums) {
        // --- PERFORMANCE OPTIMIZED SYNTHS ---
        // Drastically reduced polyphony to prevent audio engine crashes/glitches
        
        if (isDrums) {
            return new Tone.PolySynth(Tone.MembraneSynth, {
                maxPolyphony: 2, // Strict limit for drums
                pitchDecay: 0.02,
                octaves: 2,
                oscillator: { type: "square4" },
                envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
            });
        }

        // Bass (32-39) - Always Mono
        if (program >= 32 && program <= 39) {
            return new Tone.MonoSynth({
                oscillator: { type: "triangle" },
                envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.1 }, // Short release
                filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.2, baseFrequency: 200, octaves: 2 }
            });
        }

        // Strings / Pads (40-55) - Limited Polyphony
        if (program >= 40 && program <= 55) {
            return new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 3, // Reduced from 6
                oscillator: { type: "sawtooth" },
                envelope: { attack: 0.2, decay: 0.3, sustain: 0.6, release: 0.5 }
            });
        }

        // Brass / Trumpet (56-63)
        if (program >= 56 && program <= 63) {
            return new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 2,
                oscillator: { type: "sawtooth" },
                envelope: { attack: 0.05, decay: 0.1, sustain: 0.6, release: 0.2 }
            });
        }

        // Flute / Pipe (72-79)
        if (program >= 72 && program <= 79) {
            return new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 2,
                oscillator: { type: "sine" },
                envelope: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.2 }
            });
        }

        // Lead (80-95)
        if (program >= 80 && program <= 95) {
            return new Tone.PolySynth(Tone.Synth, {
                maxPolyphony: 2,
                oscillator: { type: "square" },
                envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2 }
            });
        }

        // Default (Piano-ish)
        return new Tone.PolySynth(Tone.Synth, {
            maxPolyphony: 3,
            oscillator: { type: "triangle" },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.3 }
        });
    }
function _initAudio(midi) {
        _synths = [];

        // Master Limiter
        if (!_limiter) {
            _limiter = new Tone.Limiter(-6).toDestination();
        }

        // --- TRACK OPTIMIZATION (CULLING) ---
        // Browser can't handle 10+ synths. We pick the Top 5 most important tracks.
        
        let scoredTracks = midi.tracks.map((t, i) => ({ 
            track: t, 
            index: i, 
            score: 0 
        }));

        scoredTracks.forEach(t => {
            const inst = t.track.instrument.number;
            const noteCount = t.track.notes.length;

            if (noteCount < 5) {
                t.score = -1; // Ignore empty/dummy tracks
                return;
            }

            // Priority Heuristics
            if (t.track.instrument.percussion || t.track.channel === 9) t.score += 10000; // Drums = Critical
            else if (inst >= 32 && inst <= 39) t.score += 5000; // Bass = Critical for rhythm
            else if (inst >= 80 && inst <= 95) t.score += 2000; // Leads
            
            // Prefer tracks with moderate note counts (Melody) over spam (Arpeggios/Black MIDI)
            if (noteCount < 1000) t.score += noteCount;
            else t.score += 500; // Cap score for spammy tracks
        });

        // Sort by importance and take Top 5
        scoredTracks.sort((a, b) => b.score - a.score);
        const activeTracks = scoredTracks.filter(t => t.score > 0).slice(0, 5);

        activeTracks.forEach(tItem => {
            const track = tItem.track;
            const instNum = track.instrument.number;
            const isDrums = track.instrument.percussion || (track.channel === 9);
            
            const synth = _getSynthForInstrument(instNum, isDrums);
            synth.connect(_limiter);
            
            // Volume balancing
            if (isDrums) synth.volume.value = -6;
            else if (instNum >= 32 && instNum <= 39) synth.volume.value = -4; 
            else synth.volume.value = -9;

            track._synth = synth; // Attach synth to track for playback
            _synths.push(synth);
        });
        
        console.log(`Audio Initialized: Playing ${_synths.length} tracks out of ${midi.tracks.length}`);
    }

// --- OPTIMIZED AUDIO SCHEDULER (CHUNKED) ---
let _audioSchedulerId = null;

    async function _playSong(midi, notes) {
        if (_isPlaying) return;
        
        if (Tone.context.state !== 'running') await Tone.context.resume();
        
        // Reset Transport
        Tone.Transport.stop();
        Tone.Transport.cancel();
        
        _isPlaying = true;
        
        // UI State
        _uiLayer.style.opacity = '0';
        _uiLayer.style.pointerEvents = 'none';
        _abortBtn.style.display = 'block';
        
        window.flux.score = 0;
        window.flux.combo = 0;

        _initAudio(midi);

        // Get selected mode from UI
        const selectedModeRadio = document.querySelector('input[name="gameMode"]:checked');
        _currentMode = selectedModeRadio ? selectedModeRadio.value : 'STANDARD';

        // Notify Game to Start (Using Transport Time logic)
        // We start Transport at 0, so visual start time is effectively 0 + offset
        // But game.js will use Tone.Transport.seconds directly.
        window.dispatchEvent(new CustomEvent('song-start', { detail: { startTime: 0, mode: _currentMode } }));
        
        // --- SCHEDULE AUDIO ON TRANSPORT ---
        // This replaces the custom setInterval scheduler to allow native Pause/Resume
        
        // We iterate all tracks and schedule their notes
        midi.tracks.forEach(track => {
            if (!track._synth) return; // Skip inactive tracks
            
            track.notes.forEach(note => {
                // Schedule note on Transport
Tone.Transport.schedule((time) => {
                    // 'time' here is the precise AudioContext time for the event
                    // Scale duration by playbackRate so notes don't get short at slow speeds
                    const rate = Tone.Transport.playbackRate;
                    const adjustedDuration = note.duration / rate;
                    
                    track._synth.triggerAttackRelease(
                        note.name,
                        adjustedDuration,
                        time,
                        note.velocity
                    );
                }, note.time);
            });
        });

        // Schedule End of Song
        Tone.Transport.schedule((time) => {
             _endSong(true);
        }, midi.duration + 2);

        // Start Playback
        Tone.Transport.start();
    }

function _endSong(completed) {
        _isPlaying = false;
if (_endTimeout) clearTimeout(_endTimeout);
        if (_audioSchedulerId) clearInterval(_audioSchedulerId);
        
        // Aggressive Cleanup to stop glitches
        _synths.forEach(s => { try { s.releaseAll(); s.dispose(); } catch(e){} });
        _synths = [];
        
        _abortBtn.style.display = 'none';

        if (completed) {
            // Show Results
            const finalScore = window.flux.score || 0;
            const isNewRecord = _saveHighScore(_currentSongName, finalScore);
            
            _resultScore.innerText = finalScore.toString().padStart(6, '0');
            _resultRank.innerText = _calculateRank(finalScore);
            
            _songList.style.display = 'none';
            document.querySelector('.panel-header').innerText = "TRACK COMPLETE";
            if (document.getElementById('score-panel')) document.getElementById('score-panel').style.display = 'none';
            
_resultsPanel.style.display = 'block';
            _uiLayer.style.opacity = '1';
            _uiLayer.style.pointerEvents = 'auto';
            // Force z-index to ensure it's on top of canvas
            _uiLayer.style.zIndex = '100';
            _status.innerText = isNewRecord ? "NEW HIGH SCORE!" : "TRACK COMPLETE";
            
// --- INPUT COOLDOWN (Fixes accidental retries) ---
            // 1. Disable buttons initially
            _retryBtn.classList.add('disabled');
            _menuBtn.classList.add('disabled');
            
// 2. Wait 0.5s (Reduced from 1.5s for better responsiveness)
            setTimeout(() => {
                // Enable Buttons
                _retryBtn.classList.remove('disabled');
                _menuBtn.classList.remove('disabled');
                
// Buttons are now the ONLY way to navigate (Fixes mis-taps)
                console.log("Input Cooldown Over - Buttons Active");
}, 500);

        } else {
            // Aborted - Go straight to menu
            _returnToMenu();
        }
    }

    function _calculateRank(score) {
        if (score > 10000) return "S";
        if (score > 5000) return "A";
        if (score > 2500) return "B";
        if (score > 1000) return "C";
        return "F";
    }

function _returnToMenu() {
        _uiLayer.onclick = null; 
        _canDismiss = false;
        _uiLayer.style.opacity = '1';
        _uiLayer.style.pointerEvents = 'auto';
        
        // Reset UI to Main Menu state
        _resultsPanel.style.display = 'none';
        _songList.style.display = 'block';
        if (document.getElementById('score-panel')) document.getElementById('score-panel').style.display = 'block';
        document.querySelector('.panel-header').innerText = "SELECT TRACK";
        _status.innerText = "SELECT TRACK";
        _abortBtn.style.display = 'none';
    }

// --- BUTTON HANDLERS ---
    
    // Retry
    _retryBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent bubbling to _uiLayer
        if (!_lastSongParams) return;
        
        _returnToMenu(); // Reset UI first
        // Small delay to allow UI reset
        setTimeout(() => {
            _loadAndPlay(_lastSongParams.url, _lastSongParams.name, _lastSongParams.uiElement);
        }, 100);
    };

    // Menu
    _menuBtn.onclick = (e) => {
        e.stopPropagation();
        _returnToMenu();
    };

    // Abort

    // Abort Button
    _abortBtn.onclick = () => {
        window.dispatchEvent(new CustomEvent('stop-song'));
    };

// Stop listener
    window.addEventListener('stop-song', () => {
        _endSong(false);
    });

    // Quick Restart (in-game RESTART button)
    window.addEventListener('quick-restart', () => {
        if (!_lastSongParams) return;
        _endSong(false);
        setTimeout(() => {
            _loadAndPlay(_lastSongParams.url, _lastSongParams.name, _lastSongParams.uiElement, _lastSongParams.repoId);
        }, 150);
    });

    // Abort to Menu (in-game EXIT button)
    window.addEventListener('abort-to-menu', () => {
        _endSong(false);
    });

// --- GLOBAL CONTROLS ---
    
    // Speed Control
    window.addEventListener('set-speed', (e) => {
        const rate = Math.max(0.25, Math.min(2.0, e.detail.speed));
        Tone.Transport.playbackRate = rate;
        console.log("Playback Rate:", rate);
    });

    // Pause/Resume (Generic)
    window.addEventListener('pause-song', () => {
        if (Tone.Transport.state === 'started') {
            Tone.Transport.pause();
        }
    });

    window.addEventListener('resume-song', () => {
        if (Tone.Transport.state === 'paused') {
            Tone.Transport.start();
        }
    });
    
    window.addEventListener('toggle-pause', () => {
        if (Tone.Transport.state === 'started') {
            Tone.Transport.pause();
            window.dispatchEvent(new CustomEvent('song-paused-state', { detail: true }));
        } else if (Tone.Transport.state === 'paused') {
            Tone.Transport.start();
            window.dispatchEvent(new CustomEvent('song-paused-state', { detail: false }));
        }
    });
})();
