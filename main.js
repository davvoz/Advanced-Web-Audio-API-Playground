import { ModuleRegistry } from './modules/index.js';

// Simple id generator
let __id = 0;
const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(__id++).toString(36)}`;

// Audio context (lazy)
let audioCtx = null;
const getAudio = () => {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctx();
    }
    return audioCtx;
};

// UI Activity detection for transport throttling
let uiActivityTimeout = null;
function notifyUIActivity() {
    // Find all Transport modules and mark them as UI busy
    Object.values(modules).forEach(mod => {
        if (mod.type === 'Transport' && mod.setUIBusy) {
            mod.setUIBusy(true);
        }
    });
    
    // Clear any existing timeout and set a new one
    if (uiActivityTimeout) clearTimeout(uiActivityTimeout);
    uiActivityTimeout = setTimeout(() => {
        Object.values(modules).forEach(mod => {
            if (mod.type === 'Transport' && mod.setUIBusy) {
                mod.setUIBusy(false);
            }
        });
    }, 150); // Clear UI busy flag after 150ms of inactivity
}

// DOM
const workspace = document.getElementById('workspace');
const zoomLayer = document.getElementById('zoom-layer');
const cableLayer = document.getElementById('cable-layer');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const zoomLevelEl = document.getElementById('zoom-level');
const audioToggleBtn = document.getElementById('audio-toggle');
const presetSelect = document.getElementById('preset-select');
const presetLoadBtn = document.getElementById('preset-load');
const presetNewBtn = document.getElementById('preset-new');
const presetExportBtn = document.getElementById('preset-export');
const presetImportBtn = document.getElementById('preset-import');
const presetFileInput = document.getElementById('preset-file');
const speakerWarning = document.getElementById('speaker-warning');
const warnDismissBtn = document.getElementById('warn-dismiss');

// State
const modules = new Map(); // id -> module instance
const connections = new Map(); // id -> connection
let linking = null; // { fromPortEl, fromModuleId, fromPortName, previewPath }
let zoom = 1;

function setZoom(z) {
    zoom = Math.min(2, Math.max(0.4, z));
    if (zoomLayer) zoomLayer.style.transform = `scale(${zoom})`;
    if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(zoom * 100)}%`;
    // adjust svg viewport to match current visible area in unscaled units
    const r = zoomLayer.getBoundingClientRect();
    cableLayer.setAttribute('width', (r.width / zoom));
    cableLayer.setAttribute('height', (r.height / zoom));
    updateConnectedCables('ALL');
}
zoomInBtn?.addEventListener('click', () => setZoom(zoom + 0.1));
zoomOutBtn?.addEventListener('click', () => setZoom(zoom - 0.1));
zoomResetBtn?.addEventListener('click', () => setZoom(1));

function setButtonRunning(running) {
    if (running) {
        audioToggleBtn.textContent = 'Stop Audio';
        audioToggleBtn.classList.remove('stopped');
    } else {
        audioToggleBtn.textContent = 'Start Audio';
        audioToggleBtn.classList.add('stopped');
    }
}

audioToggleBtn.addEventListener('click', async () => {
    const ctx = getAudio();
    if (ctx.state === 'suspended') {
        await ctx.resume();
    } else if (ctx.state === 'running') {
        await ctx.suspend();
    } else if (ctx.state === 'closed') {
        // recreate
        audioCtx = null;
        getAudio();
    }
    setButtonRunning(getAudio().state === 'running');
    // inform modules
    modules.forEach(m => m.onAudioStateChange?.(getAudio().state));
});

// Palette drag and drop
document.getElementById('palette').addEventListener('dragstart', (e) => {
    const target = e.target.closest('.palette-item');
    if (!target) return;
    e.dataTransfer.setData('text/plain', target.dataset.moduleType);
});

workspace.addEventListener('dragover', (e) => {
    e.preventDefault();
});

workspace.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!type) return;
    const rect = zoomLayer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    createModule(type, { x, y });
});

// Module creation
function createModule(type, position, opts = {}) {
    const Ctor = ModuleRegistry[type];
    if (!Ctor) {
        alert(`Unsupported module type: ${type}`);
        return null;
    }
    const id = opts.id || uid('mod');
    const instance = new Ctor({
        id,
        audioCtx: getAudio(),
        workspace: zoomLayer || workspace,
        cableLayer,
        position,
        onPortClick: handlePortClick,
        onMove: updateConnectedCables,
        onRemove: removeModule,
        getConnectionsFrom: (modId) => [...connections.values()].filter(c => c.fromModuleId === modId),
        getModuleById: (modId) => modules.get(modId),
        getZoom: () => zoom,
    });
    modules.set(id, instance);
    return instance;
}

function removeModule(id) {
    const m = modules.get(id);
    if (!m) return;
    // remove connections related
    [...connections.values()].forEach((c) => {
        if (c.fromModuleId === id || c.toModuleId === id) {
            deleteConnection(c.id);
        }
    });
    m.dispose?.();
    modules.delete(id);
}

// Connection handling
function handlePortClick({ moduleId, portEl, portName, direction }) {
    if (!linking) {
        if (direction === 'in') {
            // If this input already has a connection, clicking it will unplug
            const existing = [...connections.values()].find(c => c.toModuleId === moduleId && c.toPortName === portName);
            if (existing) { deleteConnection(existing.id); return; }
            return; // cannot start linking from input
        }
        if (direction !== 'out') return; // start only from output
        linking = {
            fromModuleId: moduleId,
            fromPortEl: portEl,
            fromPortName: portName,
            previewPath: createCablePath(true),
        };
        updatePreviewCableToMouse(linking.fromPortEl);
        workspace.addEventListener('mousemove', onWorkspaceMouseMove);
    } else {
        // second click must be input
        if (direction !== 'in') {
            // cancel if clicked another output
            cancelLinking();
            return;
        }
        const toModuleId = moduleId;
        const toPortEl = portEl;
        const toPortName = portName;
        completeLink(toModuleId, toPortEl, toPortName);
    }
}

function cancelLinking() {
    if (linking?.previewPath) {
        cableLayer.removeChild(linking.previewPath.path);
        cableLayer.removeChild(linking.previewPath.hit);
    }
    linking = null;
    workspace.removeEventListener('mousemove', onWorkspaceMouseMove);
}

function onWorkspaceMouseMove(e) {
    notifyUIActivity(); // Notify transport of UI activity
    if (!linking) return;
    updatePreviewCableToMouse(linking.fromPortEl, e);
}

function portCenter(portEl) {
    const rectZ = zoomLayer.getBoundingClientRect();
    const rect = portEl.getBoundingClientRect();
    // Normal case: visible element contributes size/position
    if (rect.width > 0 && rect.height > 0) {
        return {
            x: (rect.left - rectZ.left + rect.width / 2) / zoom,
            y: (rect.top - rectZ.top + rect.height / 2) / zoom,
        };
    }
    // Fallback for hidden ports (display:none): aim at the corresponding port-list container edge
    const container = portEl.closest('.port-list') || portEl.closest('.module') || zoomLayer;
    const crect = container.getBoundingClientRect();
    const isIn = portEl.classList.contains('in');
    const x = (crect.left - rectZ.left + (isIn ? 6 : crect.width - 6)) / zoom;
    const y = (crect.top - rectZ.top + crect.height / 2) / zoom;
    return { x, y };
}

function createCablePath(isPreview = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `cable${isPreview ? ' active' : ''}`);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('class', 'cable hit');
    // small delete icon as separate path circle for usability
    const del = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    del.setAttribute('r', '6');
    del.setAttribute('class', 'cable-del');
    del.style.cursor = 'pointer';
    cableLayer.appendChild(path);
    cableLayer.appendChild(hit);
    if (!isPreview) cableLayer.appendChild(del);
    if (!isPreview) {
        hit.addEventListener('dblclick', () => {
            // find and delete by path node
            const conn = [...connections.values()].find(c => c.path === path);
            if (conn) deleteConnection(conn.id);
        });
        del.addEventListener('click', () => {
            const conn = [...connections.values()].find(c => c.path === path);
            if (conn) deleteConnection(conn.id);
        });
    }
    return { path, hit, del };
}

function cubicPath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    const c1x = x1 + dx;
    const c1y = y1;
    const c2x = x2 - dx;
    const c2y = y2;
    return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

function updatePreviewCableToMouse(fromEl, e) {
    const { x: x1, y: y1 } = portCenter(fromEl);
    const { x: x2, y: y2 } = e
        ? { x: (e.clientX - zoomLayer.getBoundingClientRect().left) / zoom, y: (e.clientY - zoomLayer.getBoundingClientRect().top) / zoom }
        : { x: x1 + 60, y: y1 };
    const d = cubicPath(x1, y1, x2, y2);
    linking.previewPath.path.setAttribute('d', d);
    linking.previewPath.hit.setAttribute('d', d);
}

function completeLink(toModuleId, toPortEl, toPortName) {
    const fromModule = modules.get(linking.fromModuleId);
    const toModule = modules.get(toModuleId);
    if (!fromModule || !toModule) return cancelLinking();

    const outInfo = fromModule.getOutputPortInfo(linking.fromPortName);
    const inInfo = toModule.getInputPortInfo(toPortName);
    if (!outInfo || !inInfo) return cancelLinking();

    // One connection per input: remove existing
    const existing = [...connections.values()].find(c => c.toModuleId === toModuleId && c.toPortName === toPortName);
    if (existing) deleteConnection(existing.id);

    try {
        if (inInfo.param) {
            outInfo.node.connect(inInfo.param);
        } else if (inInfo.node) {
            outInfo.node.connect(inInfo.node);
        } else {
            throw new Error('Ingresso non valido');
        }
    } catch (err) {
        console.error('Audio connect error', err);
        cancelLinking();
        return;
    }

    // Draw permanent cable
    const { x: x1, y: y1 } = portCenter(linking.fromPortEl);
    const { x: x2, y: y2 } = portCenter(toPortEl);
    const pathNodes = createCablePath(false);
    const d = cubicPath(x1, y1, x2, y2);
    pathNodes.path.setAttribute('d', d);
    pathNodes.hit.setAttribute('d', d);
    // position delete icon at mid-point
    const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
    if (pathNodes.del) { pathNodes.del.setAttribute('cx', mx); pathNodes.del.setAttribute('cy', my); }

    const id = uid('conn');
    const conn = {
        id,
        fromModuleId: fromModule.id,
        fromPortName: linking.fromPortName,
        fromPortEl: linking.fromPortEl,
        toModuleId: toModule.id,
        toPortName,
        toPortEl,
        path: pathNodes.path,
        hit: pathNodes.hit,
        del: pathNodes.del,
    };
    connections.set(id, conn);

    // notify parameter connection with source context
    if (inInfo.param) {
        toModule.onParamConnected?.(toPortName, fromModule.id, linking.fromPortName);
    }

    // cleanup preview
    cancelLinking();
}

function deleteConnection(id) {
    const c = connections.get(id);
    if (!c) return;
    const fromModule = modules.get(c.fromModuleId);
    const toModule = modules.get(c.toModuleId);
    try {
        const outInfo = fromModule.getOutputPortInfo(c.fromPortName);
        const inInfo = toModule.getInputPortInfo(c.toPortName);
        if (inInfo?.param) {
            outInfo?.node?.disconnect?.(inInfo.param);
        } else {
            outInfo?.node?.disconnect?.(inInfo?.node);
        }
    } catch (err) {
        console.warn('Audio disconnect error', err);
    }
    // notify parameter disconnection
    const inInfo2 = toModule.getInputPortInfo(c.toPortName);
    if (inInfo2?.param) {
        toModule.onParamDisconnected?.(c.toPortName, c.fromModuleId, c.fromPortName);
    }
    c.path.remove();
    c.hit.remove();
    c.del?.remove?.();
    connections.delete(id);
}

function updateConnectedCables(moduleId) {
    // Notify UI activity during cable updates (especially during drag)
    if (moduleId !== 'ALL') {
        notifyUIActivity();
    }
    
    // Update cables containing this module; if moduleId === 'ALL', update all
    connections.forEach((c) => {
        if (moduleId !== 'ALL' && c.fromModuleId !== moduleId && c.toModuleId !== moduleId) return;
        const { x: x1, y: y1 } = portCenter(c.fromPortEl);
        const { x: x2, y: y2 } = portCenter(c.toPortEl);
        const d = cubicPath(x1, y1, x2, y2);
        c.path.setAttribute('d', d);
        c.hit.setAttribute('d', d);
        // move delete icon
        const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
        if (c.del) { c.del.setAttribute('cx', mx); c.del.setAttribute('cy', my); }
    });
}

// Auto example: Oscillator → Filter → Gain → Destination
function createExample() {
    const osc = createModule('Oscillator', { x: 220, y: 80 });
    const fil = createModule('Filter', { x: 520, y: 120 });
    const g = createModule('Gain', { x: 820, y: 160 });
    const dest = createModule('Destination', { x: 1120, y: 200 });

    // wire automatically
    // find port elements by names
    const findPortEl = (mod, direction, portName) => mod.getPortEl(direction, portName);

    const oscOut = findPortEl(osc, 'out', 'out');
    const filIn = findPortEl(fil, 'in', 'in');
    const filOut = findPortEl(fil, 'out', 'out');
    const gIn = findPortEl(g, 'in', 'in');
    const gOut = findPortEl(g, 'out', 'out');
    const destIn = findPortEl(dest, 'in', 'in');

    // connect programmatically using same flow as UI
    const connectPair = (fromMod, fromEl, fromName, toMod, toEl, toName) => {
        linking = { fromModuleId: fromMod.id, fromPortEl: fromEl, fromPortName: fromName, previewPath: createCablePath(true) };
        completeLink(toMod.id, toEl, toName);
    };

    connectPair(osc, oscOut, 'out', fil, filIn, 'in');
    connectPair(fil, filOut, 'out', g, gIn, 'in');
    connectPair(g, gOut, 'out', dest, destIn, 'in');
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    setButtonRunning(false);
    // Warning banner dismiss
    warnDismissBtn?.addEventListener('click', () => speakerWarning?.remove());
    // ensure SVG proper size
    const resize = () => {
        const r = zoomLayer.getBoundingClientRect();
        cableLayer.setAttribute('width', (r.width / zoom));
        cableLayer.setAttribute('height', (r.height / zoom));
    };
    resize();
    window.addEventListener('resize', () => { resize(); updateConnectedCables('ALL'); });
    workspace.addEventListener('scroll', () => {
        notifyUIActivity(); // Notify transport of UI activity during scroll
        updateConnectedCables('ALL');
    });
    
    // Add additional UI activity listeners
    workspace.addEventListener('wheel', notifyUIActivity, { passive: true });
    workspace.addEventListener('touchstart', notifyUIActivity, { passive: true });
    workspace.addEventListener('touchmove', notifyUIActivity, { passive: true });
    
    setZoom(1);

    // create demo
    createExample();
    initPresets();
});

// Presets
const BuiltinPresets = {
    'FM Simple Bell': {
        modules: [
            { type: 'FM', x: 220, y: 100, state: { car: { type: 'sine', freq: 440 }, mod: { type: 'sine', freq: 660 }, index: 600, level: 0.5 } },
            { type: 'Destination', x: 560, y: 180, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['FM','out'], to: ['Destination','in'] }
        ]
    },
    'Simple Bass': {
        modules: [
            { type: 'Oscillator', x: 180, y: 90, state: { type: 'square', freq: 55, level: 0.4 } },
            { type: 'Filter', x: 480, y: 120, state: { type: 'lowpass', cutoff: 300, q: 8 } },
            { type: 'ADSR', x: 480, y: 260, state: { A: 0.01, D: 0.08, S: 0.6, R: 0.2 } },
            { type: 'Gain', x: 780, y: 160, state: { gain: 0.8 } },
            { type: 'Destination', x: 1080, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['ADSR', 'out'], to: ['Gain', 'gain'] },
        ]
    },
    'Vibrato Pad': {
        modules: [
            { type: 'Oscillator', x: 180, y: 90, state: { type: 'triangle', freq: 220, level: 0.3 } },
            { type: 'LFO', x: 180, y: 240, state: { rate: 5, depth: 8, offset: 0 } },
            { type: 'Filter', x: 480, y: 120, state: { type: 'lowpass', cutoff: 1500, q: 0.7 } },
            { type: 'Gain', x: 780, y: 160, state: { gain: 0.7 } },
            { type: 'Destination', x: 1080, y: 200, state: { level: 0.8 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['LFO', 'out'], to: ['Oscillator', 'freq'] },
        ]
    }
    ,
    'Tremolo': {
        modules: [
            { type: 'Oscillator', x: 180, y: 90, state: { type: 'sine', freq: 220, level: 0.4 } },
            { type: 'LFO', x: 180, y: 250, state: { rate: 5, depth: 0.6, offset: 0 } },
            { type: 'Gain', x: 520, y: 140, state: { gain: 0.5 } },
            { type: 'Destination', x: 820, y: 180, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['LFO', 'out'], to: ['Gain', 'gain'] },
        ]
    },
    'Auto Wah': {
        modules: [
            { type: 'Oscillator', x: 180, y: 90, state: { type: 'sawtooth', freq: 180, level: 0.35 } },
            { type: 'LFO', x: 180, y: 250, state: { rate: 1.8, depth: 1200, offset: 800 } },
            { type: 'Filter', x: 520, y: 120, state: { type: 'bandpass', cutoff: 800, q: 6 } },
            { type: 'Gain', x: 820, y: 160, state: { gain: 0.7 } },
            { type: 'Destination', x: 1120, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['LFO', 'out'], to: ['Filter', 'cutoff'] },
        ]
    },
    'Pluck': {
        modules: [
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'triangle', freq: 330, level: 0.25 } },
            { type: 'ADSR', x: 160, y: 240, state: { A: 0.002, D: 0.12, S: 0.2, R: 0.25 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 1800, q: 8 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.9 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['ADSR', 'out'], to: ['Gain', 'gain'] },
            { from: ['ADSR', 'out'], to: ['Filter', 'cutoff'] },
        ]
    },
    'Echo Space': {
        modules: [
            { type: 'Oscillator', x: 160, y: 90, state: { type: 'sine', freq: 440, level: 0.3 } },
            { type: 'Gain', x: 460, y: 140, state: { gain: 0.8 } },
            { type: 'Delay', x: 760, y: 160, state: { time: 0.4, feedback: 0.45 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Delay', 'in'] },
            { from: ['Delay', 'out'], to: ['Destination', 'in'] },
        ]
    },
    'Wobble Bass': {
        modules: [
            { type: 'Oscillator', x: 160, y: 90, state: { type: 'square', freq: 55, level: 0.35 } },
            { type: 'LFO', x: 160, y: 250, state: { rate: 2, depth: 1200, offset: 400 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 500, q: 12 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.9 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
            { from: ['LFO', 'out'], to: ['Filter', 'cutoff'] },
        ]
    }
    ,
    'Sidechain Duck': {
        modules: [
            { type: 'Oscillator', x: 120, y: 80, state: { type: 'sawtooth', freq: 220, level: 0.35 } },
            { type: 'Gain', x: 420, y: 120, state: { gain: 0.9 } },
            { type: 'Sidechain', x: 720, y: 160, state: { threshold: 0.25, amount: 0.8, attack: 0.01, release: 0.25 } },
            { type: 'Destination', x: 1040, y: 200, state: { level: 0.9 } },
            // Kick as sidechain source: short oscillator burst
            { type: 'Oscillator', x: 120, y: 260, state: { type: 'sine', freq: 60, level: 0.0 } },
            { type: 'ADSR', x: 420, y: 260, state: { A: 0.001, D: 0.1, S: 0, R: 0.12, depth: 1 } },
            { type: 'Transport', x: 80, y: 60, state: { bpm: 120, running: true } },
            { type: 'Sequencer', x: 140, y: 360, state: { steps: 8, gateLen: 0.1, running: true, pattern: [
                { on: true, midi: 36 }, { on: false, midi: 36 }, { on: false, midi: 36 }, { on: false, midi: 36 },
                { on: true, midi: 36 }, { on: false, midi: 36 }, { on: false, midi: 36 }, { on: false, midi: 36 }
            ] } },
        ],
        connections: [
            // Pad path
            { from: ['Oscillator','out'], to: ['Gain','in'] },
            { from: ['Gain','out'], to: ['Sidechain','in'] },
            { from: ['Sidechain','out'], to: ['Destination','in'] },
            // Kick synth to sidechain input (we don't route it to Destination by default)
            { from: ['Sequencer','gate'], to: ['ADSR','gate'] },
            { from: ['Sequencer','pitch'], to: ['Oscillator','freq'] },
            { from: ['ADSR','out'], to: ['Oscillator','level'] },
            { from: ['Oscillator','out'], to: ['Sidechain','sidechain'] },
            // Transport sync
            { from: ['Transport','clock'], to: ['Sequencer','clock'] },
            { from: ['Transport','bpm'], to: ['Sequencer','bpm'] },
        ]
    },
    'Seq Demo': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 110, steps: 8, gateLen: 0.5, running: true, pattern: [
                        { on: true, midi: 48 }, { on: false, midi: 50 }, { on: true, midi: 55 }, { on: false, midi: 53 },
                        { on: true, midi: 50 }, { on: false, midi: 55 }, { on: true, midi: 57 }, { on: false, midi: 55 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'sawtooth', freq: 110, level: 0.2 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 1200, q: 6 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.8 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'Seq Bassline': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 120, steps: 8, gateLen: 0.5, running: true, pattern: [
                        { on: true, midi: 36 }, { on: false, midi: 38 }, { on: true, midi: 43 }, { on: false, midi: 41 },
                        { on: true, midi: 36 }, { on: false, midi: 38 }, { on: true, midi: 43 }, { on: false, midi: 41 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'square', freq: 110, level: 0.25 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 800, q: 10 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.8 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    },
    'Seq Arp Minor': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 110, steps: 8, gateLen: 0.45, running: true, pattern: [
                        { on: true, midi: 57 }, { on: true, midi: 60 }, { on: true, midi: 64 }, { on: true, midi: 57 },
                        { on: true, midi: 60 }, { on: true, midi: 64 }, { on: true, midi: 69 }, { on: true, midi: 64 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'triangle', freq: 220, level: 0.22 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 1500, q: 4 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.75 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.85 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    },
    'Seq Techno 16th': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 135, steps: 8, gateLen: 0.3, running: true, pattern: [
                        { on: true, midi: 36 }, { on: true, midi: 36 }, { on: true, midi: 43 }, { on: true, midi: 36 },
                        { on: true, midi: 36 }, { on: true, midi: 48 }, { on: true, midi: 43 }, { on: true, midi: 36 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'sawtooth', freq: 110, level: 0.22 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 900, q: 8 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.85 } },
            { type: 'Delay', x: 960, y: 180, state: { time: 0.25, feedback: 0.35 } },
            { type: 'Destination', x: 1260, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Delay', 'in'] },
            { from: ['Delay', 'out'], to: ['Destination', 'in'] },
        ]
    },
    'Seq Staccato': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 120, steps: 8, gateLen: 0.2, running: true, pattern: [
                        { on: true, midi: 60 }, { on: true, midi: 62 }, { on: true, midi: 64 }, { on: true, midi: 65 },
                        { on: true, midi: 67 }, { on: true, midi: 69 }, { on: true, midi: 71 }, { on: true, midi: 72 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'sine', freq: 220, level: 0.25 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 1800, q: 2 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.8 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.85 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    },
    'Seq Octaves': {
        modules: [
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 100, steps: 8, gateLen: 0.5, running: true, pattern: [
                        { on: true, midi: 48 }, { on: true, midi: 60 }, { on: true, midi: 48 }, { on: true, midi: 60 },
                        { on: true, midi: 48 }, { on: true, midi: 60 }, { on: true, midi: 48 }, { on: true, midi: 60 }
                    ]
                }
            },
            { type: 'Oscillator', x: 160, y: 80, state: { type: 'sawtooth', freq: 110, level: 0.22 } },
            { type: 'Filter', x: 460, y: 120, state: { type: 'lowpass', cutoff: 1200, q: 6 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.85 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'Seq Transport Sync': {
        modules: [
            { type: 'Transport', x: 100, y: 60, state: { bpm: 120, running: true } },
            {
                type: 'Sequencer', x: 140, y: 260, state: {
                    bpm: 120, steps: 8, gateLen: 0.5, running: true, pattern: [
                        { on: true, midi: 48 }, { on: false, midi: 50 }, { on: true, midi: 55 }, { on: false, midi: 53 },
                        { on: true, midi: 50 }, { on: false, midi: 55 }, { on: true, midi: 57 }, { on: false, midi: 55 }
                    ]
                }
            },
            { type: 'Oscillator', x: 460, y: 80, state: { type: 'sawtooth', freq: 110, level: 0.22 } },
            { type: 'Filter', x: 760, y: 120, state: { type: 'lowpass', cutoff: 1200, q: 6 } },
            { type: 'Gain', x: 1060, y: 160, state: { gain: 0.85 } },
            { type: 'Destination', x: 1360, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Transport', 'clock'], to: ['Sequencer', 'clock'] },
            { from: ['Transport', 'bpm'], to: ['Sequencer', 'bpm'] },
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'ADSR Sequence Pad': {
        modules: [
            { type: 'Transport', x: 80, y: 60, state: { bpm: 100, running: true } },
            {
                type: 'Sequencer', x: 130, y: 260, state: {
                    steps: 8, gateLen: 0.6, pattern: [
                        { on: true, midi: 57 }, { on: false, midi: 60 }, { on: true, midi: 64 }, { on: false, midi: 69 },
                        { on: true, midi: 60 }, { on: false, midi: 64 }, { on: true, midi: 69 }, { on: false, midi: 72 }
                    ]
                }
            },
            { type: 'Oscillator', x: 460, y: 80, state: { type: 'triangle', freq: 220, level: 0.25 } },
            { type: 'ADSR', x: 460, y: 240, state: { A: 0.05, D: 0.2, S: 0.6, R: 0.8 } },
            { type: 'Filter', x: 760, y: 120, state: { type: 'lowpass', cutoff: 1200, q: 4 } },
            { type: 'Gain', x: 1060, y: 160, state: { gain: 0.9 } },
            { type: 'Destination', x: 1360, y: 200, state: { level: 0.85 } },
        ],
        connections: [
            { from: ['Transport', 'clock'], to: ['Sequencer', 'clock'] },
            { from: ['Transport', 'bpm'], to: ['Sequencer', 'bpm'] },
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['Gain', 'gain'] },
            { from: ['Oscillator', 'out'], to: ['Filter', 'in'] },
            { from: ['ADSR', 'out'], to: ['Filter', 'cutoff'] },
            { from: ['Filter', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'ADSR Volume Lead': {
        modules: [
            { type: 'Transport', x: 80, y: 60, state: { bpm: 112, running: true } },
            {
                type: 'Sequencer', x: 130, y: 260, state: {
                    steps: 8, gateLen: 0.5, pattern: [
                        { on: true, midi: 72 }, { on: false, midi: 74 }, { on: true, midi: 76 }, { on: false, midi: 79 },
                        { on: true, midi: 76 }, { on: false, midi: 74 }, { on: true, midi: 72 }, { on: false, midi: 79 }
                    ]
                }
            },
            { type: 'Oscillator', x: 460, y: 80, state: { type: 'sawtooth', freq: 440, level: 0.3 } },
            { type: 'ADSR', x: 460, y: 240, state: { A: 0.01, D: 0.12, S: 0.0, R: 0.25, depth: 1 } },
            { type: 'Gain', x: 760, y: 160, state: { gain: 0.9 } },
            { type: 'Destination', x: 1060, y: 200, state: { level: 0.85 } },
        ],
        connections: [
            { from: ['Transport', 'clock'], to: ['Sequencer', 'clock'] },
            { from: ['Transport', 'bpm'], to: ['Sequencer', 'bpm'] },
            { from: ['Sequencer', 'pitch'], to: ['Oscillator', 'freq'] },
            { from: ['Sequencer', 'gate'], to: ['ADSR', 'gate'] },
            { from: ['Oscillator', 'out'], to: ['Gain', 'in'] },
            { from: ['ADSR', 'out'], to: ['Gain', 'gain'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'TB-303 Acid': {
        modules: [
            { type: 'Transport', x: 80, y: 60, state: { bpm: 132, running: true } },
            {
                type: 'TB-303 Seq', x: 140, y: 260, state: {
                    steps: 16, rootMidi: 48, gatePct: 55, pattern: [
                        { note: 0, octave: 1, gate: true, accent: true, slide: true },
                        { note: 0, octave: 1, gate: true, accent: false, slide: false },
                        { note: 7, octave: 1, gate: true, accent: true, slide: true },
                        { note: 0, octave: 1, gate: true, accent: false, slide: false },
                        { note: 5, octave: 1, gate: true, accent: false, slide: false },
                        { note: 0, octave: 1, gate: false, accent: false, slide: false },
                        { note: -2, octave: 1, gate: true, accent: true, slide: true },
                        { note: 0, octave: 1, gate: true, accent: false, slide: false },
                        { note: 0, octave: 2, gate: true, accent: true, slide: true },
                        { note: 12, octave: 1, gate: true, accent: false, slide: false },
                        { note: 7, octave: 1, gate: true, accent: true, slide: true },
                        { note: 0, octave: 1, gate: true, accent: false, slide: false },
                        { note: 5, octave: 1, gate: true, accent: false, slide: false },
                        { note: -2, octave: 1, gate: true, accent: false, slide: false },
                        { note: 0, octave: 1, gate: true, accent: true, slide: true },
                        { note: 0, octave: 1, gate: true, accent: false, slide: false },
                    ]
                }
            },
            { type: 'TB-303', x: 460, y: 100, state: { wave: 'sawtooth', volume: 0.8, cutoff: 900, resonance: 14, envModHz: 2200, decay: 0.35, accentAmt: 0.7, slideTime: 0.08 } },
            { type: 'Distortion', x: 780, y: 140, state: { amount: 0.7 } },
            { type: 'Gain', x: 1040, y: 160, state: { gain: 0.85 } },
            { type: 'Destination', x: 1340, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Transport', 'clock'], to: ['TB-303 Seq', 'clock'] },
            { from: ['TB-303 Seq', 'pitch'], to: ['TB-303', 'pitch'] },
            // Audio chain
            { from: ['TB-303', 'out'], to: ['Distortion', 'in'] },
            { from: ['Distortion', 'out'], to: ['Gain', 'in'] },
            { from: ['Gain', 'out'], to: ['Destination', 'in'] },
        ]
    }
    ,
    'Drum Station Starter': {
        modules: [
            { type: 'Transport', x: 80, y: 60, state: { bpm: 120, running: true } },
            {
                type: 'Drum Station', x: 460, y: 120, state: {
                    steps: 16, velocity: 1.0,
                    pattern: [
                        [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
                        [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
                        [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
                        [false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false],
                        [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
                    ],
                    accent: [
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
                        [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
                    ],
                    master: 0.9,
                    slots: [
                        { vol: 1, pan: 0 }, { vol: 0.95, pan: 0 }, { vol: 0.7, pan: -0.2 }, { vol: 0.7, pan: 0.2 },
                        { vol: 0.8, pan: 0 }, { vol: 0.8, pan: -0.1 }, { vol: 0.8, pan: 0.1 }, { vol: 0.8, pan: 0 }
                    ]
                }
            },
            { type: 'Destination', x: 980, y: 200, state: { level: 0.9 } },
        ],
        connections: [
            { from: ['Transport', 'clock'], to: ['Drum Station', 'clock'] },
            { from: ['Drum Station', 'out'], to: ['Destination', 'in'] },
        ]
    }
};

function initPresets() {
    // fill select
    Object.keys(BuiltinPresets).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        presetSelect.appendChild(opt);
    });
    presetLoadBtn.addEventListener('click', () => {
        const name = presetSelect.value;
        if (!name) return;
        loadPreset(BuiltinPresets[name]);
    });
    presetNewBtn.addEventListener('click', () => {
        clearWorkspace();
    });
    presetExportBtn.addEventListener('click', () => {
        const data = exportPatch();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'patch.json'; a.click();
        URL.revokeObjectURL(url);
    });
    presetImportBtn.addEventListener('click', () => presetFileInput.click());
    presetFileInput.addEventListener('change', async () => {
        const file = presetFileInput.files?.[0];
        if (!file) return;
        const text = await file.text();
        try { const data = JSON.parse(text); loadPreset(data); } catch (e) { alert('Invalid preset'); }
        presetFileInput.value = '';
    });
}

function clearWorkspace() {
    // remove connections first
    [...connections.keys()].forEach(id => deleteConnection(id));
    // remove modules
    [...modules.keys()].forEach(id => removeModule(id));
}

function exportPatch() {
    // v2: serialize by stable module ids to avoid ambiguity with duplicate types
    const list = [...modules.values()].map(m => ({
        id: m.id,
        type: m.constructor.name.replace('Module', ''),
        x: m.x, y: m.y,
        state: { ...(m.toJSON?.() || {}), _bg: m.getBgColor?.() },
    }));
    const conns = [...connections.values()].map(c => ({
        from: { moduleId: c.fromModuleId, port: c.fromPortName },
        to: { moduleId: c.toModuleId, port: c.toPortName },
    }));
    return { version: 2, modules: list, connections: conns };
}

function preprocessPreset(preset) {
    // Return a shallow-cloned preset with TB-303 Seq merged into TB-303
    if (!preset) return preset;
    const clone = { modules: (preset.modules || []).map(m => ({ ...m, state: { ...(m.state || {}) } })), connections: (preset.connections || []).map(c => Array.isArray(c) ? [...c] : { ...c }) };

    const isV2 = !!preset?.version || (Array.isArray(preset?.connections) && preset.connections.some(c => c?.from?.moduleId));
    const isSeqType = (t) => t === 'TB-303 Seq' || t === 'TB303Seq' || t === 'TB303Sequencer';

    if (!isV2) {
        // v1 conversion using type strings
        const seqMods = clone.modules.filter(m => isSeqType(m.type));
        if (seqMods.length === 0) return clone;
        // Map of seq type strings for quick check
        const seqTypeSet = new Set(['TB-303 Seq','TB303Seq','TB303Sequencer']);
        // For each seq module, find a TB-303 it was driving and migrate state
        seqMods.forEach(seq => {
            // Try to find TB-303 target from connections
            const toPairs = clone.connections.filter(c => Array.isArray(c.from) ? (c.from[0] === seq.type && c.from[1] === 'pitch') : false);
            const toTB = toPairs.map(c => c.to && c.to[0]).find(t => t === 'TB-303' || t === 'TB303');
            const tbMod = clone.modules.find(m => m.type === (toTB || 'TB-303'));
            if (tbMod) {
                // Move sequencer state into TB-303
                const s = seq.state || {};
                tbMod.state = tbMod.state || {};
                tbMod.state.sequencer = { steps: s.steps || 16, rootMidi: s.rootMidi || 48, gatePct: s.gatePct || 55, pattern: Array.isArray(s.pattern) ? s.pattern : [] };
            }
            // If Transport was feeding clock to seq, mirror to TB-303
            clone.connections.forEach((c) => {
                if (Array.isArray(c.from) && Array.isArray(c.to) && c.to[0] === seq.type && c.to[1] === 'clock') {
                    // Rewire to TB-303 clock
                    c.to = ['TB-303', 'clock'];
                }
            });
        });
        // Remove all connections involving seq modules
        clone.connections = clone.connections.filter(c => !(Array.isArray(c.from) && seqTypeSet.has(c.from[0])) && !(Array.isArray(c.to) && seqTypeSet.has(c.to[0])));
        // Ensure at least one Transport->TB-303 clock connection exists if any Transport present
        const hasTransport = clone.modules.some(m => m.type === 'Transport');
        const hasTB = clone.modules.some(m => m.type === 'TB-303' || m.type === 'TB303');
        const hasClockConn = clone.connections.some(c => Array.isArray(c.from) && Array.isArray(c.to) && c.from[0] === 'Transport' && c.from[1] === 'clock' && (c.to[0] === 'TB-303' || c.to[0] === 'TB303') && c.to[1] === 'clock');
        if (hasTransport && hasTB && !hasClockConn) {
            clone.connections.push({ from: ['Transport','clock'], to: ['TB-303','clock'] });
        }
        // Drop seq modules from list
        clone.modules = clone.modules.filter(m => !isSeqType(m.type));
        return clone;
    }

    // v2 id-based format
    const toRemoveIds = new Set();
    const byId = new Map(clone.modules.map(m => [m.id, m]));
    clone.modules.forEach(m => {
        if (!isSeqType(m.type)) return;
        // Find TB-303 target by connection from this module's pitch
        const toTBConn = clone.connections.find(c => c?.from?.moduleId === m.id && c?.from?.port === 'pitch');
        const tbMod = byId.get(toTBConn?.to?.moduleId);
        if (tbMod && (tbMod.type === 'TB-303' || tbMod.type === 'TB303')) {
            const s = m.state || {};
            tbMod.state = tbMod.state || {};
            tbMod.state.sequencer = { steps: s.steps || 16, rootMidi: s.rootMidi || 48, gatePct: s.gatePct || 55, pattern: Array.isArray(s.pattern) ? s.pattern : [] };
        }
        // Rewire any Transport->seq clock to TB-303 clock
        clone.connections.forEach(c => {
            if (c?.to?.moduleId === m.id && c?.to?.port === 'clock' && tbMod) {
                c.to = { moduleId: tbMod.id, port: 'clock' };
            }
        });
        toRemoveIds.add(m.id);
    });
    // Remove all connections involving removed ids
    clone.connections = clone.connections.filter(c => !(c?.from?.moduleId && toRemoveIds.has(c.from.moduleId)) && !(c?.to?.moduleId && toRemoveIds.has(c.to.moduleId)));
    // Remove modules
    clone.modules = clone.modules.filter(m => !toRemoveIds.has(m.id));
    clone.version = 2; // normalize
    return clone;
}

function loadPreset(preset) {
    preset = preprocessPreset(preset);
    clearWorkspace();

    // detect v2 format (id-based)
    const isV2 = !!preset?.version || (Array.isArray(preset?.connections) && preset.connections.some(c => c?.from?.moduleId));

    const createdByType = {};
    const idToInst = new Map();

        // create modules, preserving id if present; skip unknown types safely
    (preset.modules || []).forEach(m => {
                    const inst = createModule(m.type, { x: m.x, y: m.y }, { id: m.id });
                    if (!inst) { console.warn('Skipping unknown module type in preset:', m.type); return; }
                    // load module state
                    inst.fromJSON?.(m.state || {});
                    if (m.state?._bg) inst.setBackgroundColor?.(m.state._bg);
                    if (!createdByType[m.type]) createdByType[m.type] = [];
                    createdByType[m.type].push(inst);
                    if (m.id) idToInst.set(m.id, inst);
            });

    // connect
    (preset.connections || []).forEach(c => {
        let fromMod, toMod, fromPort, toPort;

        if (isV2) {
            fromMod = idToInst.get(c.from?.moduleId);
            toMod = idToInst.get(c.to?.moduleId);
            fromPort = c.from?.port; toPort = c.to?.port;
        } else {
            // v1 legacy: [type, port]
            const [fromType, fromP] = c.from || [];
            const [toType, toP] = c.to || [];
            fromPort = fromP; toPort = toP;
            const fromList = createdByType[fromType] || [];
            const toList = createdByType[toType] || [];
            // legacy had no index, pick first
            fromMod = fromList[0];
            toMod = toList[0];
        }

        if (!fromMod || !toMod || !fromPort || !toPort) return;
        const fromEl = fromMod.getPortEl('out', fromPort);
        const toEl = toMod.getPortEl('in', toPort);
        if (!fromEl || !toEl) return;
        linking = { fromModuleId: fromMod.id, fromPortEl: fromEl, fromPortName: fromPort, previewPath: createCablePath(true) };
        completeLink(toMod.id, toEl, toPort);
    });
}
