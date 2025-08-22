# Modular Web Audio Synthesizer

A modular synthesizer builOpen http://localhost:5173/ and click **"Start Audio"** to enable audio### Project Structure
```
├── index.html              # Main HTML layout
├── style.css               # Global styles for UI components
├── main.js                 # Core application logic, canvas management, presets
└── modules/
    ├── index.js            # Module registry and exports
    ├── module.js           # Base Module class
    ├── oscillator.js       # Waveform generator
    ├── filter.js           # Audio filtering
    ├── gain.js             # Amplification
    ├── delay.js            # Echo effect
    ├── reverb.js           # Convolution reverb
    ├── distortion.js       # Waveshaper distortion
    ├── mixer.js            # Multi-channel mixer
    ├── destination.js      # Audio output
    ├── lfo.js              # Low-frequency oscillator
    ├── lfosync.js          # Transport-synced LFO
    ├── adsr.js             # Envelope generator
    ├── sequencer.js        # Step sequencer
    ├── transport.js        # Global clock
    └── sampler.js          # Audio file playback
```

## Technical Notes
- **Audio Context**: Requires user activation - click "Start Audio" button
- **Connection Rules**: One input per connection (new connections replace existing ones)
- **Cable Management**: Visual feedback with multiple deletion methods
- **Zoom Range**: 40%-200% with automatic cable repositioning
- **Module Resizing**: Currently supported only for Mixer module

**License**: MIT Basic Usage
1. **Add modules**: Drag from the left panel into the workspace
2. **Create connections**: Click an output (yellow) then an input (cyan)
3. **Remove connections**: Double-click cable, click red dot, or click connected input
4. **Adjust parameters**: Use sliders, dropdowns, and numeric inputs on modules
5. **Load presets**: Use the preset dropdown to try different configurations

### Sequencing Workflow
1. Add Transport and Sequencer modules
2. Connect `Transport.clock` → `Sequencer.clock`
3. Connect `Transport.bpm` → `Sequencer.bpm` 
4. Connect `Sequencer.pitch` → `Oscillator.freq`
5. Connect `Sequencer.gate` → `Gain.gain` (or ADSR)
6. Click "Start" on Transport to begin playback

### Sampler Workflow
1. **Load audio**: Use file input or drag-drop audio file onto Sampler
2. **Set root pitch**: Adjust "Root MIDI" to match the original note of your sample
3. **Connect sequencer**: `Sequencer.pitch` → `Sampler.pitch` for pitched playback
4. **Configure playback**: 
   - **One-shot**: Triggers once per gate
   - **Gate mode**: Plays while gate is high, stops when gate goes low
5. **Adjust loop**: Enable loop and set start/end points using numeric fields or waveform handles
6. **Apply envelope**: Enable ADSR for volume shapingTML/CSS/JavaScript using the Web Audio API. Features a drag-and-drop interface for creating audio patches.

## Features
- **Modular design**: Drag modules into the canvas and connect them with virtual cables
- **Real audio processing**: Connections map directly to Web Audio API `.connect()`/`.disconnect()` calls
- **Interactive controls**: Real-time parameter adjustment with sliders, dropdowns, and numeric inputs
- **Extensible architecture**: Base `Module` class allows easy creation of custom modules
- **Zoomable canvas**: 40%-200% zoom with mouse wheel, cables adapt automatically
- **16 built-in presets**: From basic patches to complex sequenced arrangements

## Available Modules

### Sound Generation & Processing
- **Oscillator**: Sine, square, sawtooth, triangle waveforms with frequency and level control
- **Filter**: Low-pass, high-pass, band-pass, notch filters with cutoff and Q controls
- **Gain**: Amplification with level control and CV input
- **Delay**: Echo effect with time and feedback controls
- **Reverb**: Convolution reverb with room size and wet/dry mix
- **Distortion**: Waveshaper distortion with multiple curve types and drive control
- **Mixer**: Multi-channel mixer with level, pan, mute per channel, compact view options
- **Destination**: Audio output to speakers

### Modulation & Control
- **LFO**: Low-frequency oscillator with multiple waveforms, rate, depth, and offset
- **LFO Sync**: Transport-synchronized LFO with tempo-locked rates
- **ADSR**: Attack-Decay-Sustain-Release envelope generator with gate input
- **Sequencer**: 8-step sequencer with note and gate pattern programming
- **Transport**: Global tempo and clock source for synchronization

### Sampling
- **Sampler**: Audio file playback with pitch control, loop points, ADSR envelope, and start offset

## User Interface Features
- **Zoom controls**: Scale from 40% to 200% using buttons or mouse wheel
- **Cable management**: Delete cables by double-clicking, clicking the red dot, or clicking connected input
- **Module positioning**: Drag modules freely; cables automatically update positions
- **Mixer enhancements**: Compact mode, configurable column layout, parameter port visibility toggle
- **Resizable modules**: Mixer supports dynamic resizing via corner handle

## Built-in Presets
**Basic Patches**: Simple Bass, Vibrato Pad, Tremolo, Auto Wah, Pluck, Echo Space, Wobble Bass  
**Sequencer Demos**: Seq Demo, Seq Bassline, Seq Arp Minor, Seq Techno 16th, Seq Staccato, Seq Octaves  
**Transport Sync**: Seq Transport Sync, ADSR Sequence Pad, ADSR Volume Lead

## Getting Started

### Local Development
Requires a static server due to ES6 module usage.

**Python 3**:
```bash
python -m http.server 5173
```

**Node.js**:
```bash
npx http-server -p 5173
```

Open http://localhost:5173/ and click **"Start Audio"** to enable audio output.

In the page, press “Start Audio” to enable audio (browser policy).

## Usage
- Drag a module from the left panel into the workspace.
- Click an output (yellow) then an input (cyan) to connect.
- Remove a cable by: double-clicking the cable, clicking the red dot on it, or clicking the connected input.
- Drag modules to reposition; cables auto-update.
- To sequence notes, use Sequencer with Transport: connect Transport.clock → Sequencer.clock and Transport.bpm → Sequencer.bpm, then Start the Transport.

### Sampler tips
- Load a file via the file input or drop it onto the Sampler.
- Mode: One-shot triggers on gate “on”; Gate mode stops on gate “off”.
- Pitch: connect Sequencer.pitch → Sampler.pitch and set “Root MIDI” to the note of the sample. Use Tune/Fine for adjustments.
- Loop: enable, then adjust start/end in the numeric fields or by dragging the handles on the waveform.

## Development

### Adding Custom Modules
1. Create a new file in `modules/` extending the base `Module` class
2. Implement required methods:
   - `get title()` - Returns the module name
   - `buildAudio()` - Sets up Web Audio nodes and defines `this.inputs`/`this.outputs`
   - `buildControls(container)` - Creates the UI controls
3. Register the module in `modules/index.js`

**Example**:
```js
import { Module } from './module.js';

export class MyModule extends Module {
  get title() { return 'My Module'; }
  
  buildAudio() {
    const gain = this.audioCtx.createGain();
    this.inputs = { in: { node: gain } };
    this.outputs = { out: { node: gain } };
  }
  
  buildControls(container) {
    // Add UI controls here
  }
}
```

## Structure
- `index.html` – layout and script loading.
- `style.css` – workspace, modules, ports, and cable styles.
- `main.js` – drag & drop, cable management, audio connections.
- `modules/` – `module.js` (base) and concrete modules.
  - Synth/FX: `oscillator.js`, `filter.js`, `gain.js`, `delay.js`, `reverb.js`, `distortion.js`, `mixer.js`, `destination.js`
  - Mod/CTL: `lfo.js`, `lfosync.js`, `adsr.js`, `sequencer.js`, `transport.js`
  - Sampling: `sampler.js`

## Notes
- Audio is subject to autoplay policies: press “Start Audio”.
- One connection per input (new connection replaces the existing one).
- Remove cables with double-click, red dot, or input click.

License: MIT