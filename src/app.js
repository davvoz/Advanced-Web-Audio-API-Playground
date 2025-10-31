/**
 * Main Application Entry Point
 * Uses the refactored audio engine and skin system
 */
import { AudioEngine } from './engine/AudioEngine.js';
import { SkinRuntime } from './ui/SkinRuntime.js';

// Load skin config
const DefaultSkinConfig = await fetch('./src/skins/default/skin-config.json').then(r => r.json());

// Simple id generator (legacy compatibility)
let __id = 0;
const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(__id++).toString(36)}`;

// Initialize engine
const engine = new AudioEngine();
engine.init();

// Make engine globally accessible for legacy modules
window.audioEngine = engine;

// DOM elements
const audioToggleBtn = document.getElementById('audio-toggle');
const presetSelect = document.getElementById('preset-select');
const presetLoadBtn = document.getElementById('preset-load');
const presetNewBtn = document.getElementById('preset-new');
const presetExportBtn = document.getElementById('preset-export');
const presetImportBtn = document.getElementById('preset-import');
const presetFileInput = document.getElementById('preset-file');
const speakerWarning = document.getElementById('speaker-warning');
const warnDismissBtn = document.getElementById('warn-dismiss');

// Initialize skin runtime with default skin
const container = document.getElementById('workspace');
const skinRuntime = new SkinRuntime(engine, container);

// Load default skin
await skinRuntime.loadSkin(DefaultSkinConfig);

// Audio state control
function setButtonRunning(running) {
    if (running) {
        audioToggleBtn.textContent = 'Stop Audio';
        audioToggleBtn.classList.remove('stopped');
    } else {
        audioToggleBtn.textContent = 'Start Audio';
        audioToggleBtn.classList.add('stopped');
    }
}

audioToggleBtn?.addEventListener('click', async () => {
    const ctx = engine.getAudioContext();
    const shouldRun = ctx.state !== 'running';
    await engine.setAudioState(shouldRun);
    setButtonRunning(ctx.state === 'running');
});

// Listen to engine audio state changes
engine.addEventListener('audioStateChanged', (e) => {
    setButtonRunning(e.detail.running);
});

// Preset management
const BuiltinPresets = {
    'FM Simple Bell': {
        modules: [
            { type: 'FM', position: { x: 220, y: 100 }, state: { car: { type: 'sine', freq: 440 }, mod: { type: 'sine', freq: 660 }, index: 600, level: 0.5 } },
            { type: 'Destination', position: { x: 560, y: 180 }, state: { level: 0.9 } },
        ],
        connections: [
            { from: { moduleId: null, port: 'out' }, to: { moduleId: null, port: 'in' } }
        ]
    },
    'Simple Bass': {
        modules: [
            { type: 'Oscillator', position: { x: 180, y: 90 }, state: { type: 'square', freq: 55, level: 0.4 } },
            { type: 'Filter', position: { x: 480, y: 120 }, state: { type: 'lowpass', cutoff: 300, q: 8 } },
            { type: 'ADSR', position: { x: 480, y: 260 }, state: { A: 0.01, D: 0.08, S: 0.6, R: 0.2 } },
            { type: 'Gain', position: { x: 780, y: 160 }, state: { gain: 0.8 } },
            { type: 'Destination', position: { x: 1080, y: 200 }, state: { level: 0.9 } },
        ],
        connections: []
    },
};

function initPresets() {
    Object.keys(BuiltinPresets).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        presetSelect?.appendChild(opt);
    });
}

function loadPreset(preset) {
    // Convert legacy format to v2 if needed
    const converted = convertLegacyPreset(preset);
    engine.loadPatch(converted);
}

function convertLegacyPreset(preset) {
    if (!preset || preset.version === 2) return preset;
    
    // Assign IDs to modules
    const modulesWithIds = (preset.modules || []).map(m => ({
        ...m,
        id: m.id || uid('mod'),
    }));
    
    // Convert connections to use module IDs
    const connections = [];
    if (preset.connections && preset.connections.length > 0) {
        preset.connections.forEach((conn, idx) => {
            if (idx < modulesWithIds.length - 1) {
                connections.push({
                    from: { moduleId: modulesWithIds[idx].id, port: conn.from?.port || 'out' },
                    to: { moduleId: modulesWithIds[idx + 1].id, port: conn.to?.port || 'in' }
                });
            }
        });
    }
    
    return {
        version: 2,
        modules: modulesWithIds,
        connections: connections,
    };
}

presetLoadBtn?.addEventListener('click', () => {
    const name = presetSelect?.value;
    if (!name) return;
    loadPreset(BuiltinPresets[name]);
});

presetNewBtn?.addEventListener('click', () => {
    engine.clear();
});

presetExportBtn?.addEventListener('click', () => {
    const data = engine.serialize();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patch.json';
    a.click();
    URL.revokeObjectURL(url);
});

presetImportBtn?.addEventListener('click', () => presetFileInput?.click());

presetFileInput?.addEventListener('change', async () => {
    const file = presetFileInput?.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
        const data = JSON.parse(text);
        loadPreset(data);
    } catch (e) {
        alert('Invalid preset file');
    }
    presetFileInput.value = '';
});

// Warning banner dismiss
warnDismissBtn?.addEventListener('click', () => speakerWarning?.remove());

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    setButtonRunning(false);
    initPresets();
    
    // Create example patch
    createExamplePatch();
});

function createExamplePatch() {
    try {
        const osc = engine.createModule('Oscillator', { position: { x: 220, y: 80 } });
        const fil = engine.createModule('Filter', { position: { x: 520, y: 120 } });
        const g = engine.createModule('Gain', { position: { x: 820, y: 160 } });
        const dest = engine.createModule('Destination', { position: { x: 1120, y: 200 } });
        
        // Connect modules
        engine.connect(osc.id, 'out', fil.id, 'in');
        engine.connect(fil.id, 'out', g.id, 'in');
        engine.connect(g.id, 'out', dest.id, 'in');
    } catch (err) {
        console.warn('Failed to create example patch:', err);
    }
}
