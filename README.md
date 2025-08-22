# Advanced Web Audio API Playground

A modular audio synthesis playground built with vanilla HTML/CSS/JavaScript and the Web Audio API. Create patches by dragging modules onto a canvas and connecting them with virtual cables.

## Features

- **Drag-and-drop interface**: Intuitive module patching on a zoomable canvas
- **Real Web Audio connections**: Visual cables map directly to `.connect()` and `.disconnect()` calls
- **Interactive parameter control**: Real-time adjustment with sliders, dropdowns, and numeric inputs  
- **Extensible module system**: Easy-to-extend base `Module` class for custom audio processors
- **16 built-in presets**: Ready-to-use patches from simple oscillators to complex sequences
- **Advanced UX**: Zoom (40%-200%), multiple cable deletion methods, module resizing

## Available Modules

### Audio Sources & Processing
- **Oscillator** - Sine, square, sawtooth, triangle waveforms
- **Filter** - Low/high/band-pass and notch filters with cutoff and Q
- **Gain** - Amplification with CV control
- **Delay** - Echo effect with time and feedback
- **Reverb** - Convolution reverb with impulse responses
- **Distortion** - Waveshaper with multiple curve types
- **Mixer** - Multi-channel mixer with level, pan, mute controls
- **Destination** - Audio output to system speakers

### Modulation & Envelopes  
- **LFO** - Low-frequency oscillator with multiple waveforms
- **LFO Sync** - Transport-synchronized LFO with musical rates
- **ADSR** - Attack-Decay-Sustain-Release envelope generator

### Sequencing & Timing
- **Transport** - Global clock and tempo source 
- **Sequencer** - 8-step pattern sequencer with pitch and gate outputs

### Sampling
- **Sampler** - Audio file playback with pitch tracking, looping, and envelope control

## Quick Start

### Run Locally
Requires a static server for ES6 modules:

```bash
# Python 3
python -m http.server 5173

# Node.js  
npx http-server -p 5173
```

Open http://localhost:5173 and click **"Start Audio"** to begin.

### Basic Workflow
1. **Add modules**: Drag from palette into workspace
2. **Make connections**: Click output (yellow) then input (cyan)
3. **Adjust parameters**: Use controls on each module
4. **Try presets**: Load examples from dropdown menu

### Create a Simple Patch
Try this basic synthesis chain:
1. Add: Oscillator → Filter → Gain → Destination  
2. Connect the modules in sequence
3. Adjust oscillator frequency, filter cutoff, and gain level

### Sequencing Setup
For sequenced patterns:
1. Add Transport and Sequencer modules
2. Connect: Transport.clock → Sequencer.clock, Transport.bpm → Sequencer.bpm
3. Connect: Sequencer.pitch → Oscillator.freq, Sequencer.gate → Gain.gain
4. Program pattern on Sequencer grid, click Transport "Start"

### Sampler Usage
To use audio samples:
1. Load file via input or drag-drop onto Sampler
2. Set "Root MIDI" to sample's original pitch
3. Connect Sequencer.pitch → Sampler.pitch for melodic playback
4. Use One-shot (trigger) or Gate (sustain) modes

## Built-in Presets

**Basic Synthesis**: Simple Bass, Vibrato Pad, Tremolo, Auto Wah, Pluck, Echo Space, Wobble Bass  
**Sequencer Patterns**: Seq Demo, Seq Bassline, Seq Arp Minor, Seq Techno 16th, Seq Staccato, Seq Octaves  
**Advanced Patches**: Seq Transport Sync, ADSR Sequence Pad, ADSR Volume Lead

## User Interface

### Canvas Controls
- **Zoom**: 40%-200% via buttons or mouse wheel
- **Pan**: Drag empty canvas areas to scroll
- **Module positioning**: Drag modules freely, cables auto-update

### Cable Management  
- **Create**: Click output port then input port
- **Delete**: Double-click cable, click red dot, or click connected input
- **Constraint**: One connection per input (new replaces existing)

### Module Features
- **Resizing**: Mixer module supports corner-handle resizing
- **Compact modes**: Mixer has configurable columns and parameter visibility
- **Parameter ports**: Most controls can accept CV connections from other modules

## Development

### Adding Modules
Create a new module by extending the base class:

```js
import { Module } from './module.js';

export class MyModule extends Module {
  get title() { return 'My Module'; }
  
  buildAudio() {
    // Create Web Audio nodes
    const gain = this.audioCtx.createGain();
    
    // Define inputs and outputs  
    this.inputs = { in: { node: gain } };
    this.outputs = { out: { node: gain } };
  }
  
  buildControls(container) {
    // Add UI controls to container
  }
}
```

Register in `modules/index.js`:
```js
import { MyModule } from './mymodule.js';
// Add to ModuleRegistry object
```

### Project Structure
```
├── index.html           # Main application layout
├── style.css           # Styles for workspace and modules  
├── main.js             # Canvas, connections, presets, zoom
└── modules/
    ├── index.js        # Module registry
    ├── module.js       # Base Module class
    ├── oscillator.js   # Waveform generators
    ├── filter.js       # Audio filtering  
    ├── gain.js         # Amplification
    ├── delay.js        # Echo effects
    ├── reverb.js       # Convolution reverb
    ├── distortion.js   # Waveshaping
    ├── mixer.js        # Multi-channel mixing
    ├── destination.js  # Audio output
    ├── lfo.js          # Modulation sources
    ├── lfosync.js      # Tempo-synced modulation
    ├── adsr.js         # Envelope generators
    ├── sequencer.js    # Pattern sequencing
    ├── transport.js    # Global timing
    └── sampler.js      # Audio file playback
```

## Technical Notes

- **Audio Context**: Web Audio requires user gesture - click "Start Audio"
- **Connection Model**: One-to-many outputs, one-to-one inputs
- **Parameter Automation**: Most controls accept CV input for modulation
- **File Support**: Sampler accepts common audio formats (WAV, MP3, etc.)
- **Performance**: Optimized for real-time audio processing in modern browsers

## License

MIT License - Feel free to use, modify, and distribute.
