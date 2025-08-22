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
    `;
        // actions
        el.querySelector('.btn-remove').addEventListener('click', () => this.onRemove?.(this.id));

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
            if (e.target.closest('.controls') || e.target.closest('.port') || e.target.closest('.resize-handle')) return; // avoid drag when using controls, ports, or resize handle
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

    onAudioStateChange() { }

    dispose() {
        this.root.remove();
        // attempt to close internal nodes if any
    }
}
