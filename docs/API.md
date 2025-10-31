# API Reference

## AudioEngine

### Constructor

```javascript
const engine = new AudioEngine();
```

### Methods

#### `async init()`
Initialize the audio engine and MIDI system.

**Returns:** `Promise<void>`

#### `getAudioContext()`
Get the Web Audio API context.

**Returns:** `AudioContext`

#### `async setAudioState(running)`
Start or stop audio.

**Parameters:**
- `running` (boolean): true to start, false to stop

**Returns:** `Promise<void>`

#### `createModule(type, config)`
Create a new module.

**Parameters:**
- `type` (string): Module type (e.g., 'Oscillator', 'Filter')
- `config` (object): Module configuration
  - `id` (string, optional): Module ID
  - `position` (object): { x, y } coordinates

**Returns:** Module instance

**Example:**
```javascript
const osc = engine.createModule('Oscillator', {
  position: { x: 100, y: 100 }
});
```

#### `removeModule(id)`
Remove a module and its connections.

**Parameters:**
- `id` (string): Module ID

#### `getModule(id)`
Get a module by ID.

**Parameters:**
- `id` (string): Module ID

**Returns:** Module instance or undefined

#### `getModules()`
Get all modules.

**Returns:** `Map<string, Module>`

#### `connect(fromModuleId, fromPort, toModuleId, toPort)`
Connect two modules.

**Parameters:**
- `fromModuleId` (string): Source module ID
- `fromPort` (string): Source port name
- `toModuleId` (string): Destination module ID
- `toPort` (string): Destination port name

**Returns:** Connection ID (string)

**Throws:** Error if modules or ports not found

**Example:**
```javascript
engine.connect(osc.id, 'out', filter.id, 'in');
```

#### `disconnect(connectionId)`
Disconnect modules.

**Parameters:**
- `connectionId` (string): Connection ID

#### `getConnections()`
Get all connections.

**Returns:** `Map<string, Connection>`

#### `setParameter(parameterId, value)`
Set a parameter value.

**Parameters:**
- `parameterId` (string): Parameter ID (e.g., 'mod-1.freq')
- `value` (number): New value

#### `getParameter(parameterId)`
Get a parameter value.

**Parameters:**
- `parameterId` (string): Parameter ID

**Returns:** number or undefined

#### `getParameters()`
Get all parameters.

**Returns:** `Map<string, Parameter>`

#### `serialize()`
Serialize the current patch.

**Returns:** Patch object

**Example:**
```javascript
const patch = engine.serialize();
console.log(JSON.stringify(patch, null, 2));
```

#### `loadPatch(patch)`
Load a patch.

**Parameters:**
- `patch` (object): Patch data

#### `clear()`
Clear all modules and connections.

#### `getMIDIManager()`
Get the MIDI manager.

**Returns:** `MIDIManager`

#### `getParameterRegistry()`
Get the parameter registry.

**Returns:** `ParameterRegistry`

### Events

Listen to events using `addEventListener`:

```javascript
engine.addEventListener('moduleCreated', (e) => {
  console.log('Module created:', e.detail);
});
```

**Available Events:**
- `initialized` - Engine initialized
- `audioStateChanged` - Audio state changed (detail: { state, running })
- `moduleCreated` - Module created (detail: { id, type, instance })
- `moduleRemoved` - Module removed (detail: { id })
- `connected` - Modules connected (detail: connection)
- `disconnected` - Modules disconnected (detail: { connectionId })
- `patchLoaded` - Patch loaded (detail: { patch })

---

## ParameterRegistry

### Methods

#### `register(id, metadata)`
Register a parameter.

**Parameters:**
- `id` (string): Parameter ID
- `metadata` (object):
  - `min` (number): Minimum value
  - `max` (number): Maximum value
  - `default` (number): Default value
  - `unit` (string): Unit ('Hz', 'dB', '%', etc.)
  - `taper` (string): 'linear' or 'exponential'
  - `smoothing` (number): Smoothing time in seconds

**Example:**
```javascript
registry.register('osc-1.freq', {
  min: 20,
  max: 20000,
  default: 440,
  unit: 'Hz',
  taper: 'exponential',
  smoothing: 0.01
});
```

#### `setValue(id, value, notify = true)`
Set parameter value.

**Parameters:**
- `id` (string): Parameter ID
- `value` (number): New value (will be clamped to range)
- `notify` (boolean): Whether to notify listeners

#### `getValue(id)`
Get parameter value.

**Parameters:**
- `id` (string): Parameter ID

**Returns:** number or undefined

#### `getMetadata(id)`
Get parameter metadata.

**Parameters:**
- `id` (string): Parameter ID

**Returns:** metadata object or undefined

#### `getAll()`
Get all parameters.

**Returns:** `Map<string, Parameter>`

#### `subscribe(id, callback)`
Subscribe to parameter changes.

**Parameters:**
- `id` (string): Parameter ID
- `callback` (function): Callback function(value)

**Example:**
```javascript
registry.subscribe('osc-1.freq', (value) => {
  console.log('Frequency:', value);
});
```

#### `unsubscribe(id, callback)`
Unsubscribe from parameter changes.

**Parameters:**
- `id` (string): Parameter ID
- `callback` (function): Callback function

#### `clear()`
Clear all parameters.

---

## MIDIManager

### Methods

#### `async init()`
Initialize MIDI access.

**Returns:** `Promise<boolean>` - true if successful

#### `startLearn(parameterId)`
Start MIDI learn mode for a parameter.

**Parameters:**
- `parameterId` (string): Parameter ID to learn

**Example:**
```javascript
midi.startLearn('filter-1.cutoff');
// Now move a MIDI controller to assign it
```

#### `cancelLearn()`
Cancel MIDI learn mode.

#### `addMapping(ccNumber, parameterId)`
Add a MIDI CC mapping.

**Parameters:**
- `ccNumber` (number): CC number (0-127)
- `parameterId` (string): Parameter ID

**Example:**
```javascript
midi.addMapping(1, 'filter-1.cutoff'); // Mod wheel -> cutoff
```

#### `removeMapping(ccNumber)`
Remove a MIDI CC mapping.

**Parameters:**
- `ccNumber` (number): CC number

#### `getMappings()`
Get all mappings.

**Returns:** `Map<number, string>`

#### `clearMappings()`
Clear all mappings.

#### `serialize()`
Serialize MIDI mappings.

**Returns:** Object with mappings

#### `load(data)`
Load MIDI mappings.

**Parameters:**
- `data` (object): Serialized mappings

#### `getDevices()`
Get available MIDI devices.

**Returns:** Array of device objects

### Events

**Available Events:**
- `initialized` - MIDI initialized
- `deviceChanged` - MIDI device connected/disconnected (detail: event)
- `noteOn` - MIDI note on (detail: { note, velocity, channel })
- `noteOff` - MIDI note off (detail: { note, velocity, channel })
- `cc` - MIDI CC (detail: { ccNumber, value, channel })
- `ccMapped` - CC mapped to parameter (detail: { ccNumber, parameterId, value })
- `learnStarted` - Learn mode started (detail: { parameterId })
- `learned` - Mapping learned (detail: { ccNumber, parameterId })
- `learnCancelled` - Learn mode cancelled
- `mappingAdded` - Mapping added (detail: { ccNumber, parameterId })
- `mappingRemoved` - Mapping removed (detail: { ccNumber, parameterId })
- `mappingsCleared` - All mappings cleared

---

## SkinRuntime

### Constructor

```javascript
const skinRuntime = new SkinRuntime(engine, container);
```

**Parameters:**
- `engine` (AudioEngine): Audio engine instance
- `container` (HTMLElement): Container element

### Methods

#### `async loadSkin(skinDescriptor)`
Load a skin.

**Parameters:**
- `skinDescriptor` (object): Skin configuration

**Throws:** Error if skin descriptor is invalid

**Example:**
```javascript
const config = await fetch('./src/skins/default/skin-config.json').then(r => r.json());
await skinRuntime.loadSkin(config);
```

#### `unloadSkin()`
Unload current skin.

#### `getCurrentSkin()`
Get current skin descriptor.

**Returns:** Skin descriptor object or null

---

## Skin Development

### Skin Class Structure

```javascript
export default class MySkin {
  constructor(engine, container, skinDescriptor) {
    this.engine = engine;          // AudioEngine instance
    this.container = container;    // Container HTMLElement
    this.config = skinDescriptor;  // Skin configuration
    this.init();
  }

  init() {
    // Initialize UI
    this.setupEngineListeners();
  }

  setupEngineListeners() {
    // Listen to engine events
    this.engine.addEventListener('moduleCreated', (e) => {
      this.onModuleCreated(e.detail);
    });
  }

  onModuleCreated({ id, type, instance }) {
    // Handle module creation in UI
  }

  dispose() {
    // Cleanup resources
  }
}
```

### Skin Configuration

```json
{
  "name": "My Skin",
  "version": 1,
  "layout": "canvas",
  "theme": {
    "primaryColor": "#333",
    "accentColor": "#0a0",
    "backgroundColor": "#111"
  },
  "features": {
    "dragAndDrop": true,
    "zoom": true,
    "cables": true,
    "presets": true
  }
}
```

---

## Patch Format

### Version 2 (Current)

```json
{
  "version": 2,
  "modules": [
    {
      "id": "mod-xyz",
      "type": "Oscillator",
      "position": { "x": 100, "y": 200 },
      "state": {
        "freq": 440,
        "type": "sine",
        "level": 0.5
      },
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

### Connection Object

```javascript
{
  id: "conn-xyz",
  fromModuleId: "mod-1",
  fromPortName: "out",
  toModuleId: "mod-2",
  toPortName: "in"
}
```

---

## Error Handling

All methods that can fail throw errors:

```javascript
try {
  engine.connect(osc.id, 'out', filter.id, 'in');
} catch (err) {
  console.error('Connection failed:', err.message);
}
```

Common errors:
- "Unknown module type" - Module type not registered
- "Module not found" - Invalid module ID
- "Port not found" - Invalid port name
- "Audio connection failed" - Web Audio API error
