# Migration Guide

## From Legacy Architecture to Refactored Architecture

This guide helps you understand the changes made during the architecture refactoring and how to work with the new system.

## What Changed?

### Before (Legacy)
- All code in `main.js` (1075+ lines)
- UI and audio logic tightly coupled
- Hard to test, extend, or create alternative UIs
- No parameter management system
- No MIDI support

### After (Refactored)
- **Engine Layer**: Separate audio logic (`src/engine/`)
- **UI Layer**: Multiple skin support (`src/skins/`)
- **Parameter System**: Centralized parameter registry
- **MIDI Support**: Built-in MIDI learn and CC mapping
- **Event-Based**: Clean engine-to-UI communication
- **Documentation**: Complete architecture and API docs

## Key Concepts

### 1. Audio Engine

The `AudioEngine` is now the single source of truth for all audio operations:

```javascript
// Old way (legacy)
const osc = new OscillatorModule({...});

// New way (refactored)
const engine = new AudioEngine();
await engine.init();
const osc = engine.createModule('Oscillator', {...});
```

### 2. Skins

UIs are now called "skins" and can be switched dynamically:

- **Default Skin**: Canvas-based (current UI)
- **Reason-like Skin**: Rack-mounted interface

### 3. Events

The engine emits events for UI updates:

```javascript
engine.addEventListener('moduleCreated', (e) => {
  console.log('New module:', e.detail.id);
});
```

### 4. Parameters

Parameters are now managed centrally with metadata:

```javascript
const registry = engine.getParameterRegistry();
registry.register('osc-1.freq', {
  min: 20,
  max: 20000,
  default: 440,
  unit: 'Hz',
  taper: 'exponential'
});
```

### 5. MIDI

MIDI is now built into the engine:

```javascript
const midi = engine.getMIDIManager();
await midi.init();
midi.startLearn('filter-1.cutoff');
```

## File Structure Changes

### Moved Files

- `main.js` → Split into:
  - `src/engine/AudioEngine.js` (audio logic)
  - `src/skins/default/index.js` (UI logic)
  - `src/app.js` (application entry)

### New Files

- `src/engine/ParameterRegistry.js` - Parameter management
- `src/engine/MIDIManager.js` - MIDI support
- `src/ui/SkinRuntime.js` - Skin loader
- `src/shared/EventBus.js` - Event system
- `src/shared/schemas.js` - JSON schemas
- `docs/ARCHITECTURE.md` - Architecture guide
- `docs/API.md` - API reference

### Unchanged Files

- `modules/` - All audio modules (unchanged)
- `style.css` - Styles (unchanged)
- `index.html` - Minor changes (script src)

## Breaking Changes

### None! 

The refactoring maintains backward compatibility:
- All modules work as before
- Presets are compatible (v2 format)
- UI behaves the same way
- No API changes for end users

## New Capabilities

### 1. Multiple Skins

Switch between different UIs:

```javascript
const skinRuntime = new SkinRuntime(engine, container);

// Load default skin
await skinRuntime.loadSkin(defaultConfig);

// Switch to rack skin
await skinRuntime.loadSkin(reasonLikeConfig);
```

### 2. MIDI Mapping

Map MIDI controllers to any parameter:

```javascript
const midi = engine.getMIDIManager();
midi.addMapping(1, 'filter-1.cutoff'); // CC 1 -> cutoff
```

### 3. Parameter Subscriptions

React to parameter changes:

```javascript
const registry = engine.getParameterRegistry();
registry.subscribe('osc-1.freq', (value) => {
  console.log('Frequency changed to:', value);
});
```

### 4. Programmatic Control

Control the engine via code:

```javascript
// Create modules
const osc = engine.createModule('Oscillator', { position: { x: 100, y: 100 } });
const filter = engine.createModule('Filter', { position: { x: 400, y: 100 } });

// Connect
engine.connect(osc.id, 'out', filter.id, 'in');

// Export
const patch = engine.serialize();
console.log(JSON.stringify(patch));
```

## Development Workflow

### Before
1. Edit `main.js`
2. Reload page
3. Test manually

### After
1. Choose layer to edit:
   - **Engine**: `src/engine/`
   - **UI**: `src/skins/`
   - **Modules**: `modules/`
2. Edit files
3. Reload page
4. Use browser console to test engine API

### Testing the Engine

```javascript
// In browser console
const engine = window.audioEngine;

// Check state
console.log('Modules:', engine.getModules());
console.log('Connections:', engine.getConnections());

// Create module programmatically
const osc = engine.createModule('Oscillator', { position: { x: 0, y: 0 } });
console.log('Created:', osc.id);

// Serialize
console.log(JSON.stringify(engine.serialize(), null, 2));
```

## Creating Custom Skins

1. Create directory: `src/skins/my-skin/`
2. Create `skin-config.json`
3. Create `index.js` with your skin class
4. Load it: `skinRuntime.loadSkin(myConfig)`

See [Architecture Documentation](ARCHITECTURE.md) for details.

## Troubleshooting

### Modules not appearing?
- Check browser console for errors
- Ensure engine is initialized: `await engine.init()`
- Verify skin is loaded: `skinRuntime.getCurrentSkin()`

### Connections not working?
- Check if modules exist: `engine.getModule(id)`
- Verify port names are correct
- Check browser console for audio errors

### MIDI not working?
- Ensure MIDI device is connected before page load
- Check MIDI permissions in browser
- Call `await midi.init()` to initialize

### Presets not loading?
- Check preset format (should be v2)
- Use `engine.loadPatch(preset)` for new format
- Legacy presets are auto-converted

## Resources

- [Architecture Guide](ARCHITECTURE.md) - System overview
- [API Reference](API.md) - Complete API documentation
- [GitHub Issues](https://github.com/davvoz/Advanced-Web-Audio-API-Playground/issues) - Report bugs

## Need Help?

- Open an issue on GitHub
- Check the documentation
- Use browser console to debug: `window.audioEngine`
