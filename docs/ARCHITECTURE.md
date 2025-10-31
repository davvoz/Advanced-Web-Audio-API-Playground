# Architecture Documentation

## Overview

The Advanced Web Audio API Playground has been refactored to separate the audio engine (backend) from the user interface (frontend), enabling multiple UI implementations ("skins") while maintaining a single, stable audio core.

## Directory Structure

```
Advanced-Web-Audio-API-Playground/
├── src/
│   ├── engine/              # Audio engine (backend)
│   │   ├── AudioEngine.js   # Core audio graph manager
│   │   ├── ParameterRegistry.js  # Parameter management
│   │   └── MIDIManager.js   # MIDI input and mapping
│   ├── ui/                  # UI layer
│   │   └── SkinRuntime.js   # Dynamic skin loader
│   ├── skins/               # UI implementations
│   │   ├── default/         # Canvas-based UI (current)
│   │   │   ├── index.js
│   │   │   └── skin-config.json
│   │   └── reason-like/     # Rack-mounted UI
│   │       ├── index.js
│   │       └── skin-config.json
│   ├── shared/              # Shared utilities
│   │   ├── EventBus.js      # Event communication
│   │   └── schemas.js       # JSON schemas
│   └── app.js               # Application entry point
├── modules/                 # Audio modules
│   └── ...
├── index.html               # Main HTML
├── style.css                # Styles
└── main.js                  # Legacy entry point
```

## Core Components

### 1. AudioEngine (`src/engine/AudioEngine.js`)

The AudioEngine is the heart of the system, managing:
- Module lifecycle (create, destroy)
- Audio connections
- Patch serialization/deserialization
- Audio context state

**Key Methods:**
```javascript
// Initialize engine
await engine.init();

// Create module
const osc = engine.createModule('Oscillator', {
  position: { x: 100, y: 100 }
});

// Connect modules
engine.connect(osc.id, 'out', filter.id, 'in');

// Disconnect
engine.disconnect(connectionId);

// Serialize patch
const patch = engine.serialize();

// Load patch
engine.loadPatch(patch);

// Audio state
await engine.setAudioState(true); // Start
```

**Events:**
- `initialized` - Engine ready
- `audioStateChanged` - Audio context state changed
- `moduleCreated` - Module created
- `moduleRemoved` - Module removed
- `connected` - Modules connected
- `disconnected` - Modules disconnected
- `patchLoaded` - Patch loaded

### 2. ParameterRegistry (`src/engine/ParameterRegistry.js`)

Manages all parameters with metadata (range, unit, taper, smoothing).

**Example:**
```javascript
const registry = engine.getParameterRegistry();

// Register parameter
registry.register('osc-1.freq', {
  min: 20,
  max: 20000,
  default: 440,
  unit: 'Hz',
  taper: 'exponential',
  smoothing: 0.01
});

// Set value
registry.setValue('osc-1.freq', 880);

// Get value
const freq = registry.getValue('osc-1.freq');

// Subscribe to changes
registry.subscribe('osc-1.freq', (value) => {
  console.log('Frequency changed:', value);
});
```

### 3. MIDIManager (`src/engine/MIDIManager.js`)

Handles MIDI input, learn mode, and CC mapping at the engine level.

**Features:**
- Automatic MIDI device detection
- MIDI learn mode
- CC-to-parameter mapping
- Taper-aware value scaling

**Example:**
```javascript
const midi = engine.getMIDIManager();

// Initialize MIDI
await midi.init();

// Start MIDI learn
midi.startLearn('osc-1.freq');
// Move a MIDI controller...

// Manual mapping
midi.addMapping(1, 'filter-1.cutoff'); // CC 1 -> cutoff

// Listen to MIDI events
midi.addEventListener('cc', (e) => {
  console.log('CC:', e.detail.ccNumber, e.detail.value);
});
```

### 4. SkinRuntime (`src/ui/SkinRuntime.js`)

Dynamically loads and manages UI skins.

**Example:**
```javascript
const skinRuntime = new SkinRuntime(engine, container);

// Load skin
await skinRuntime.loadSkin(skinConfig);

// Switch skins
await skinRuntime.loadSkin(otherSkinConfig);
```

## Skins

### Default Skin

Canvas-based modular interface (wraps the current UI).

**Features:**
- Drag-and-drop modules
- Visual cable routing
- Zoom controls (40%-200%)
- Full module palette

**Config:** `src/skins/default/skin-config.json`

### Reason-like Skin

Rack-mounted interface inspired by Propellerhead Reason.

**Features:**
- Vertical rack layout
- Fixed module positions
- Connection list panel
- Rack screws visual

**Config:** `src/skins/reason-like/skin-config.json`

### Creating a Custom Skin

1. Create directory: `src/skins/my-skin/`
2. Create `skin-config.json`:
```json
{
  "name": "My Skin",
  "version": 1,
  "layout": "canvas",
  "theme": {
    "primaryColor": "#333",
    "accentColor": "#0a0"
  },
  "features": {
    "dragAndDrop": true,
    "zoom": true
  }
}
```

3. Create `index.js`:
```javascript
export default class MySkin {
  constructor(engine, container, skinDescriptor) {
    this.engine = engine;
    this.container = container;
    this.config = skinDescriptor;
    this.init();
  }

  init() {
    // Setup UI
    this.setupEngineListeners();
  }

  setupEngineListeners() {
    this.engine.addEventListener('moduleCreated', (e) => {
      // Handle module creation
    });
  }

  dispose() {
    // Cleanup
  }
}
```

4. Load skin:
```javascript
const config = await fetch('./src/skins/my-skin/skin-config.json').then(r => r.json());
await skinRuntime.loadSkin(config);
```

## Patch Format

Patches use a stable ID-based format (v2):

```json
{
  "version": 2,
  "modules": [
    {
      "id": "mod-xyz",
      "type": "Oscillator",
      "position": { "x": 100, "y": 200 },
      "state": { "freq": 440, "type": "sine", "level": 0.5 },
      "bgColor": "#123456"
    }
  ],
  "connections": [
    {
      "from": { "moduleId": "mod-xyz", "port": "out" },
      "to": { "moduleId": "mod-abc", "port": "in" }
    }
  ]
}
```

## Event Flow

```
User Action (UI)
    ↓
SkinRuntime
    ↓
AudioEngine API
    ↓
Audio Graph (Web Audio API)
    ↓
AudioEngine Events
    ↓
SkinRuntime (updates UI)
```

## Benefits

1. **Separation of Concerns**: Audio logic is completely independent of UI
2. **Multiple UIs**: Support different "skins" without changing audio code
3. **Testable**: Engine can be tested without a browser UI
4. **Extensible**: Easy to add new skins or modules
5. **Maintainable**: Clear boundaries between layers
6. **MIDI Support**: Built-in MIDI mapping at engine level
7. **Parameter System**: Unified parameter management with metadata

## Migration Guide

### From Legacy Code

**Old:**
```javascript
import { ModuleRegistry } from './modules/index.js';
const osc = new ModuleRegistry.Oscillator({...});
```

**New:**
```javascript
const engine = new AudioEngine();
await engine.init();
const osc = engine.createModule('Oscillator', {...});
```

### Accessing the Engine

The engine is available globally:
```javascript
window.audioEngine.createModule('Filter', {...});
```

## Future Enhancements

- [ ] AudioWorklet support for custom DSP
- [ ] Automation lanes and recording
- [ ] Module presets and favorites
- [ ] Collaborative patching (WebRTC)
- [ ] VST/CLAP plugin bridge
- [ ] Mobile-optimized skin
- [ ] Keyboard shortcuts system
- [ ] Undo/redo functionality
