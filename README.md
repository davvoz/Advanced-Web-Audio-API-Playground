# Modular Web Audio Synt## Avvio locale
Usa un server static## Utilizzo
- Trascina un modulo dal pannello ## Struttura del progetto
- `index.html` – layout e caricamento script
- `style.css` – stili per workspace, moduli, porte e cavi
- `main.js` – gestione drag & drop, cavi, connessioni audio, zoom, preset
- `modules/` – classe base `module.js` e moduli concreti:
  - **Audio**: `oscillator.js`, `filter.js`, `gain.js`, `delay.js`, `reverb.js`, `distortion.js`, `mixer.js`, `destination.js`
  - **Controllo**: `lfo.js`, `lfosync.js`, `adsr.js`, `sequencer.js`, `transport.js`  
  - **Sampling**: `sampler.js`
  - **Registry**: `index.js` (registrazione moduli)

## Note tecniche
- L'audio è soggetto alle policy di autoplay: premi "Start Audio"
- Una sola connessione per input (nuova connessione sostituisce quella esistente)
- Rimozione cavi: doppio click, punto rosso, o click su input
- Zoom: range 40%-200%, cavi si adattano automaticamente
- Solo il Mixer è ridimensionabile (maniglia angolo in basso a destra)

**Licenza**: MIT workspace
- Click su un output (giallo) poi su un input (ciano) per connettere
- Rimuovi un cavo: doppio click sul cavo, click sul punto rosso, o click sull'input connesso
- Trascina i moduli per riposizionarli; i cavi si aggiornano automaticamente
- Per sequenziare note: usa Sequencer + Transport connettendo Transport.clock → Sequencer.clock e Transport.bpm → Sequencer.bpm, poi Start

### Consigli per il Sampler
- Carica un file tramite input file o drag-drop sul modulo
- **Mode**: One-shot si attiva al gate "on"; Gate mode si ferma al gate "off"
- **Pitch**: connetti Sequencer.pitch → Sampler.pitch e imposta "Root MIDI" alla nota del campione
- **Tune/Fine**: regolazione fine dell'intonazione in semitoni e cent
- **Loop**: abilita e regola start/end nei campi numerici o trascinando le maniglie sulla waveform
- **ADSR**: envelope opzionale per il volume, abilitabile con la checkbox script sono moduli ES6.

**Opzione 1 (Python 3)**:
```powershell
# dalla cartella del progetto
python -m http.server 5173
```

**Opzione 2 (Node.js)**:
```powershell
npx http-server -p 5173
```

Apri: http://localhost:5173/

**Importante**: premi "Start Audio" nella pagina per abilitare l'audio (policy del browser).

## Preset inclusi
Il sistema include 16 preset preconfigurati:
- **Base**: Simple Bass, Vibrato Pad, Tremolo, Auto Wah, Pluck, Echo Space, Wobble Bass
- **Sequencer**: Seq Demo, Seq Bassline, Seq Arp Minor, Seq Techno 16th, Seq Staccato, Seq Octaves
- **Transport sync**: Seq Transport Sync, ADSR Sequence Pad, ADSR Volume Leadntetizzatore modulare basato su Web Audio API, realizzato in HTML/CSS/JavaScript vanilla con interfaccia drag-and-drop.

## Caratteristiche
- Trascina moduli nella canvas e connettili con cavi virtuali
- Le connessioni riflettono reali operazioni `.connect()`/`.disconnect()` dell'API Web Audio
- Controlli interattivi per parametri (slider, select, campi numerici)
- Classe base `Module` estendibile per creare nuovi moduli
- Canvas zoomabile (40%-200%) con scroll e cavi che si adattano automaticamente
- Sistema di preset con 16 configurazioni predefinite

### Moduli disponibili
- **Generatori/Processori**: Oscillator, Filter, Gain, Delay, Reverb, Distortion, Mixer, Destination
- **Modulazione**: LFO (libero), LFO Sync (sincronizzato al Transport), ADSR
- **Controllo**: Sequencer (8 step), Transport (clock globale)
- **Campionamento**: Sampler (carica file audio, loop, intonazione, envelope)

### Funzionalità UX
- Zoom canvas: pulsanti +/- o rotella mouse, range 40%-200%
- Elimina cavi: doppio click, click sul punto rosso, o click su input già connesso
- Mixer compatto: modalità compatta, colonne configurabili, nascondi porte parametri
- Resize: solo il Mixer è ridimensionabile tramite maniglia nell'angolo

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

## Aggiungere un nuovo modulo
1. Crea un file in `modules/` estendendo `Module` e implementa:
   - `get title()` per il titolo del modulo
   - `buildAudio()` per creare/connettere nodi Web Audio e popolare `this.inputs` e `this.outputs`
   - `buildControls(container)` per creare i controlli UI
2. Registra il modulo in `modules/index.js` dentro `ModuleRegistry`

Esempio minimale:
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