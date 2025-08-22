# Advanced Web Audio API Playground (vanilla JS)

A pure HTML/CSS/JavaScript modular-synth style playground using the Web Audio API with a drag-and-drop UI.

## Features
- Drag modules into the canvas and patch with virtual cables.
- Connect inputs/outputs with real Web Audio `.connect()`/`.disconnect()` semantics.
- Interactive controls for parameters (sliders, selects, number fields).
- Extensible base `Module` class to build your own modules quickly.
- Auto example: Oscillator → Filter → Gain → Destination.
- Built-in presets (Simple Bass, Vibrato Pad, Tremolo, Auto Wah, Pluck, Echo Space, Wobble Bass, Sequencer demos, Transport sync).

### Modules available
- Sound/processing: Oscillator, Filter, Gain, Delay, Reverb, Distortion, Mixer, Destination
- Modulation: LFO, LFO Sync (tempo locked), ADSR
- Control/flow: Sequencer, Transport
- Sampling: Sampler (load audio files, loop, tune/fine, envelope, start offset)

### UX niceties
- Zoomable canvas; cables adapt to zoom and scroll.
- Delete cables by double-clicking them, clicking the red dot on the cable, or clicking an already-connected input.
- Mixer compact mode, columns, and toggle to hide param ports; modules are resizable via a corner handle.

## Run locally
Use a simple static server because scripts are ES modules.

Option 1 (Python 3):
```powershell
# from project folder
python -m http.server 5173
```
Open: http://localhost:5173/

Option 2 (Node):
```powershell
npx http-server -p 5173
```

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

## Add a new module
1. Create a file in `modules/` extending `Module` and implement:
   - `get title()` for the module title
   - `buildAudio()` to create/connect Web Audio nodes and populate `this.inputs` and `this.outputs`
   - `buildControls(container)` to create the UI controls
2. Register the module in `modules/index.js` inside `ModuleRegistry`.

Minimal example:
```js
import { Module } from './module.js';
export class MyModule extends Module {
  get title(){ return 'MyModule'; }
  buildAudio(){
    const n = this.audioCtx.createGain();
    this.inputs = { in: { node: n } };
    this.outputs = { out: { node: n } };
  }
  buildControls(container){ /* UI */ }
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