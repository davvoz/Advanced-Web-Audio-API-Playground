// Base Module class to be extended by concrete modules
export class Module {
    constructor({ id, audioCtx, workspace, cableLayer, position = { x: 100, y: 100 }, onPortClick, onMove, onRemove, getConnectionsFrom, getModuleById, getZoom }) {
        this.id = id;
        this.audioCtx = audioCtx;
        this.workspace = workspace;
        this.cableLayer = cableLayer;
        this.onPortClick = onPortClick;
        this.onMove = onMove;
        this.onRemove = onRemove;
        this.getConnectionsFrom = getConnectionsFrom;
        this.getModuleById = getModuleById;
        this.getZoom = getZoom || (() => 1);

        this.inputs = {}; // name -> { node }
        this.outputs = {}; // name -> { node }

        this.root = this._createRoot();
    this.workspace.appendChild(this.root);
    this.setPosition(position.x, position.y);
    this._enableDragging();
    this._enableResize();
    }

    // To override in subclasses
    get title() { return 'Module'; }
    buildAudio() { }
    buildControls(container) { }

    _createRoot() {
        const el = document.createElement('div');
        el.className = 'module';
        el.setAttribute('data-module-id', this.id);
                        el.innerHTML = `
      <div class="module-header">
        <div class="module-title">${this.title}</div>
        <div class="module-actions">
                    <input type="color" class="color-picker" title="Background color" />
      <button class="btn danger btn-remove" title="Remove">✕</button>
        </div>
      </div>
      <div class="ports">
        <div class="port-col in-col">
      <div class="port-title">Inputs</div>
          <div class="port-list in-ports"></div>
        </div>
        <div class="port-col out-col">
      <div class="port-title">Outputs</div>
          <div class="port-list out-ports"></div>
        </div>
      </div>
            <div class="controls"></div>
            <div class="resize-handle" title="Resize"></div>
    `;
        // actions
        el.querySelector('.btn-remove').addEventListener('click', () => this.onRemove?.(this.id));
        const colorInput = el.querySelector('.color-picker');
        const toHex = (rgbStr) => {
            if (!rgbStr) return null;
            const m = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return null;
            const r = Number(m[1]).toString(16).padStart(2,'0');
            const g = Number(m[2]).toString(16).padStart(2,'0');
            const b = Number(m[3]).toString(16).padStart(2,'0');
            return `#${r}${g}${b}`;
        };
        const cs = getComputedStyle(el);
        const initial = toHex(cs.backgroundColor) || '#11162b';
        colorInput.value = initial;
        this._bg = initial;
        colorInput.addEventListener('input', () => {
            this.setBackgroundColor(colorInput.value);
        });

        this.inPortsEl = el.querySelector('.in-ports');
        this.outPortsEl = el.querySelector('.out-ports');
        this.controlsEl = el.querySelector('.controls');

        // Make root available to subclasses during build
        this.root = el;

    this.buildAudio();
        this._renderPorts();
        this.buildControls(this.controlsEl);
        return el;
    }

    _portEl(direction, name) {
        const el = document.createElement('button');
        el.className = `port ${direction}`;
        el.innerHTML = `<span class="dot"></span><span>${name}</span>`;
        el.addEventListener('click', () => this.onPortClick?.({ moduleId: this.id, portEl: el, portName: name, direction }));
        return el;
    }

    _renderPorts() {
        this.inPortsEl.innerHTML = '';
        Object.keys(this.inputs).forEach(name => this.inPortsEl.appendChild(this._portEl('in', name)));
        this.outPortsEl.innerHTML = '';
        Object.keys(this.outputs).forEach(name => this.outPortsEl.appendChild(this._portEl('out', name)));
    }

    getPortEl(direction, name) {
        const container = direction === 'in' ? this.inPortsEl : this.outPortsEl;
        return [...container.querySelectorAll('.port')].find(p => p.textContent.trim() === name);
    }

    getInputPortInfo(name) { return this.inputs[name]; }
    getOutputPortInfo(name) { return this.outputs[name]; }

    setPosition(x, y) {
        this.x = x; this.y = y;
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        this.onMove?.(this.id);
    }

    _enableDragging() {
        let startX, startY, origX, origY;
        const onMouseDown = (e) => {
            if (e.target.closest('.controls') || e.target.closest('.port') || e.target.closest('.resize-handle') || e.target.closest('.module-actions')) return; // avoid drag when using controls, ports, resize, or header actions
            e.preventDefault();
            this.root.classList.add('dragging');
            startX = e.clientX; startY = e.clientY;
            const rect = this.root.getBoundingClientRect();
            const wrect = this.workspace.getBoundingClientRect();
            const z = this.getZoom();
            origX = (rect.left - wrect.left) / z; origY = (rect.top - wrect.top) / z;
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp, { once: true });
        };
        const onMouseMove = (e) => {
            const z = this.getZoom();
            const dx = (e.clientX - startX) / z; const dy = (e.clientY - startY) / z;
            this.setPosition(origX + dx, origY + dy);
        };
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            this.root.classList.remove('dragging');
        };
        this.root.addEventListener('mousedown', onMouseDown);
    }

    _enableResize() {
        const handle = this.root.querySelector('.resize-handle');
        if (!handle) return;
        let startX, startY, startW, startH;
        const onDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = this.root.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            const z = this.getZoom();
            startW = rect.width / z; startH = rect.height / z;
            document.body.style.cursor = 'nwse-resize';
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp, { once: true });
        };
        const px = (v) => `${Math.round(v)}px`;
        const onMove = (e) => {
            const z = this.getZoom();
            const dx = (e.clientX - startX) / z;
            const dy = (e.clientY - startY) / z;
            // clamp using CSS min/max if available
            const cs = getComputedStyle(this.root);
            const minW = parseFloat(cs.minWidth) || 180;
            const maxW = parseFloat(cs.maxWidth) || 1200;
            const minH = 120; // reasonable default
            const maxH = 1600;
            const w = Math.min(maxW, Math.max(minW, startW + dx));
            const h = Math.min(maxH, Math.max(minH, startH + dy));
            this.root.style.width = px(w);
            this.root.style.height = px(h);
            this.onMove?.(this.id); // update cables while resizing
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            document.body.style.cursor = '';
            this.onMove?.(this.id);
        };
        handle.addEventListener('mousedown', onDown);
    }

    onAudioStateChange() { }

    setBackgroundColor(color) {
        this._bg = color;
        if (this.root) this.root.style.background = color;
    }
    getBgColor() { return this._bg; }

    dispose() {
        this.root.remove();
        // attempt to close internal nodes if any
    }
}
