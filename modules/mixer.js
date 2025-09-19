import { Module } from './module.js';

export class MixerModule extends Module {
  get title() { return 'Mixer'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this.numChannels = 4;
  this._showParamPorts = false; // compact by default
  this._cols = 2; // compact layout: columns in grid
  this._compactUI = true; // reduce heights and paddings

    this._sum = this._sum || ctx.createGain();
    this.channels = [];

    this.master = ctx.createGain(); this.master.gain.value = 1;
    this._sum.connect(this.master);

    // Expose ports
    this.inputs = {};
    // Ensure initial channels and inputs mapping
    this._ensureChannels(this.numChannels);
    this.channels.forEach((ch, i) => this._registerChannelPorts(i + 1, ch));
    this.inputs.master = { param: this.master.gain };

    this.outputs = {
      out: { node: this.master },
    };
  }

  _ensureSum() {
    if (!this._sum) {
      this._sum = this.audioCtx.createGain();
    }
    return this._sum;
  }

  buildControls(container) {
  // mark root for mixer-specific CSS
  this.root.classList.add('module-mixer');
    // add resize handle (mixer-specific)
    if (!this.root.querySelector('.resize-handle')) {
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      this.root.appendChild(handle);
      let startX = 0, startW = 0;
      const minW = 220;
      const onMouseDown = (e) => {
        e.preventDefault(); e.stopPropagation();
        startX = e.clientX; startW = this.root.getBoundingClientRect().width;
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
      };
      const onMouseMove = (e) => {
        const z = this.getZoom?.() || 1;
        const dx = (e.clientX - startX) / z;
        const targetW = Math.max(minW, Math.round(startW + dx));
        this.root.style.width = `${targetW}px`;
        this.onMove?.(this.id);
      };
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        this.onMove?.(this.id);
      };
      handle.addEventListener('mousedown', onMouseDown);
    }
  // Wrapper for small header controls
    // Compact header bar
    const header = document.createElement('div');
    header.className = 'control';
    header.style.display = 'flex';
    header.style.flexWrap = 'wrap';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.margin = '0 0 4px 0';

    // Channel count control (compact)
    const countCtl = document.createElement('div');
    countCtl.style.display = 'inline-flex';
    countCtl.style.alignItems = 'center';
    countCtl.style.gap = '4px';
    countCtl.innerHTML = `
      <label style="font-size:12px">Channels</label>
      <input data-role="chCount" style="width:72px" type="number" min="1" step="1" value="${this.numChannels}" />
    `;
    const chCountEl = countCtl.querySelector('[data-role=chCount]');
    chCountEl.addEventListener('input', () => {
      const n = Math.max(1, Number(chCountEl.value) || 1);
      this.numChannels = n;
      // add missing channels if necessary
      this._ensureChannels(this.numChannels);
      this._updateChannelVisibility();
    });
    header.appendChild(countCtl);

    // Param ports visibility toggle
    const portsCtl = document.createElement('div');
    portsCtl.style.display = 'inline-flex';
    portsCtl.style.alignItems = 'center';
    portsCtl.style.gap = '6px';
    portsCtl.innerHTML = `
      <label style="font-size:12px">Params</label>
      <input data-role="showParams" type="checkbox" />
    `;
    const showParamsEl = portsCtl.querySelector('[data-role=showParams]');
    showParamsEl.checked = this._showParamPorts;
    showParamsEl.addEventListener('change', () => {
      this._showParamPorts = !!showParamsEl.checked;
      this._updateChannelVisibility();
    });
    header.appendChild(portsCtl);

    // Columns control for compact height
    const colsCtl = document.createElement('div');
    colsCtl.style.display = 'inline-flex';
    colsCtl.style.alignItems = 'center';
    colsCtl.style.gap = '4px';
    colsCtl.innerHTML = `
      <label style="font-size:12px">Cols</label>
      <input data-role="cols" style="width:48px" type="number" min="1" max="4" step="1" value="2" />
    `;
    const colsEl = colsCtl.querySelector('[data-role=cols]');
    colsEl.value = String(this._cols);
    colsEl.addEventListener('input', () => {
      const n = Math.max(1, Math.min(4, Number(colsEl.value)));
      this._cols = n;
      this._layoutRowsGrid();
    });
    header.appendChild(colsCtl);

    // Compact UI switch
    const compactCtl = document.createElement('div');
    compactCtl.style.display = 'inline-flex';
    compactCtl.style.alignItems = 'center';
    compactCtl.style.gap = '6px';
    compactCtl.innerHTML = `
      <label style="font-size:12px">Compact</label>
      <input data-role="compact" type="checkbox" />
    `;
    const compactEl = compactCtl.querySelector('[data-role=compact]');
    compactEl.checked = this._compactUI;
    compactEl.addEventListener('change', () => {
      this._compactUI = !!compactEl.checked;
      this._applyCompactStyles();
    });
    header.appendChild(compactCtl);

    container.appendChild(header);

    // Grid container for channel rows
  const rowsWrap = document.createElement('div');
    rowsWrap.style.display = 'grid';
  rowsWrap.style.gap = '2px 6px';
    rowsWrap.style.marginTop = '4px';
  rowsWrap.style.maxWidth = '100%';
  rowsWrap.style.overflow = 'hidden';
    container.appendChild(rowsWrap);

    const mkRow = (idx, ch) => {
      const row = document.createElement('div');
      row.className = 'control';
      // tighter row styling
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.margin = '0';
      row.style.padding = '0';
      row.innerHTML = `
        <span style="min-width:26px;text-align:right;font-size:11px;color:var(--fg-muted,inherit)">Ch ${idx}</span>
        <input data-role="level" title="Level" style="flex:1;min-width:70px;height:14px" type="range" min="0" max="1.5" step="0.01" value="0.8" />
        ${ch.pan ? '<input data-role="pan" title="Pan" style="width:80px;height:14px" type="range" min="-1" max="1" step="0.01" value="0" />' : ''}
        <input data-role="mute" title="Mute" style="transform:scale(0.9)" type="checkbox" />
      `;
      const levelEl = row.querySelector('[data-role=level]');
      const panEl = row.querySelector('[data-role=pan]');
      const muteEl = row.querySelector('[data-role=mute]');
      levelEl.addEventListener('input', () => ch.level.gain.setTargetAtTime(Number(levelEl.value), this.audioCtx.currentTime, 0.01));
      if (panEl && ch.pan) panEl.addEventListener('input', () => ch.pan.pan.setTargetAtTime(Number(panEl.value), this.audioCtx.currentTime, 0.01));
      muteEl.addEventListener('change', () => ch.mute.gain.setTargetAtTime(muteEl.checked ? 0 : 1, this.audioCtx.currentTime, 0.005));
      return { row, levelEl, panEl, muteEl };
    };

  this._ui = { ch: [], chCountEl, showParamsEl, colsEl, rowsWrap, compactEl };
    this.channels.forEach((ch, i) => {
      const idx = i + 1;
      const u = mkRow(idx, ch);
      rowsWrap.appendChild(u.row);
      this._ui.ch[i] = u;
    });

    const masterCtl = document.createElement('div');
    masterCtl.className = 'control';
    masterCtl.innerHTML = `
      <label style="font-size:12px;margin-right:6px">Master</label>
      <input style="width:100%;height:14px" type="range" min="0" max="2" step="0.01" value="1" />
    `;
    const mEl = masterCtl.querySelector('input');
    mEl.addEventListener('input', () => this.master.gain.setTargetAtTime(Number(mEl.value), this.audioCtx.currentTime, 0.01));
    container.appendChild(masterCtl);
  this._ui.masterEl = mEl;

  this._layoutRowsGrid();
  this._applyCompactStyles();
  this._updateChannelVisibility();
  }

  toJSON() {
    const ch = this.channels.map((c, i) => ({
      level: c.level.gain.value,
      pan: c.pan ? c.pan.pan.value : 0,
      muted: c.mute.gain.value === 0,
    }));
    return {
      channelsCount: this.numChannels,
      channels: ch,
      master: this.master.gain.value,
      showParamPorts: this._showParamPorts,
      cols: this._cols,
      compact: this._compactUI,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.channelsCount === 'number') {
      this.numChannels = Math.max(1, state.channelsCount);
      // Ensure audio channels and ports exist for this count
      this._ensureChannels(this.numChannels);
      if (this._ui?.chCountEl) this._ui.chCountEl.value = String(this.numChannels);
    }
    if (typeof state.showParamPorts === 'boolean') {
      this._showParamPorts = state.showParamPorts;
      if (this._ui?.showParamsEl) this._ui.showParamsEl.checked = this._showParamPorts;
    }
    if (typeof state.cols === 'number') {
      this._cols = Math.max(1, Math.min(4, state.cols));
      if (this._ui?.colsEl) this._ui.colsEl.value = String(this._cols);
      this._layoutRowsGrid();
    }
    if (typeof state.compact === 'boolean') {
      this._compactUI = state.compact;
      if (this._ui?.compactEl) this._ui.compactEl.checked = this._compactUI;
      this._applyCompactStyles();
    }
    if (Array.isArray(state.channels)) {
      state.channels.forEach((s, i) => {
        const c = this.channels[i]; if (!c) return;
        if (typeof s.level === 'number') { c.level.gain.value = s.level; this._ui?.ch?.[i]?.levelEl && (this._ui.ch[i].levelEl.value = String(s.level)); }
        if (typeof s.pan === 'number' && c.pan) { c.pan.pan.value = s.pan; this._ui?.ch?.[i]?.panEl && (this._ui.ch[i].panEl.value = String(s.pan)); }
        if (typeof s.muted === 'boolean') { c.mute.gain.value = s.muted ? 0 : 1; this._ui?.ch?.[i]?.muteEl && (this._ui.ch[i].muteEl.checked = s.muted); }
      });
    }
    if (typeof state.master === 'number') { this.master.gain.value = state.master; this._ui?.masterEl && (this._ui.masterEl.value = String(state.master)); }
    this._updateChannelVisibility();
  }

  dispose() {
    try {
      this.channels?.forEach(c => { c.input?.disconnect(); c.mute?.disconnect(); c.level?.disconnect(); c.pan?.disconnect(); });
      this._sum?.disconnect(); this.master?.disconnect();
    } catch {}
    super.dispose?.();
  }

  _updateChannelVisibility() {
    // Ensure channel audio/UI exist for requested count
    this._ensureChannels(this.numChannels);
    // Show first numChannels and hide the rest; ensure hidden channels are muted
    this.channels.forEach((c, i) => {
      const idx = i + 1;
      const enabled = idx <= this.numChannels;
      const row = this._ui?.ch?.[i]?.row;
      if (row) row.style.display = enabled ? '' : 'none';
      c.mute.gain.setValueAtTime(enabled ? (this._ui?.ch?.[i]?.muteEl?.checked ? 0 : 1) : 0, this.audioCtx.currentTime);
      // Hide/show port buttons
      const setPortVis = (el, vis) => { if (!el) return; el.style.display = vis ? '' : 'none'; };
      const inPort = this.getPortEl('in', `in${idx}`);
      setPortVis(inPort, enabled);
      const lvlPort = this.getPortEl('in', `level${idx}`);
      setPortVis(lvlPort, enabled && this._showParamPorts);
      const panPort = this.getPortEl('in', `pan${idx}`);
      setPortVis(panPort, enabled && this._showParamPorts);
    });
    // Master param port visibility
    const masterPort = this.getPortEl('in', 'master');
    if (masterPort) { masterPort.style.display = this._showParamPorts ? '' : 'none'; }
  }

  _layoutRowsGrid() {
    // Update grid columns for compact layout
    if (this._ui?.rowsWrap) {
      this._ui.rowsWrap.style.gridTemplateColumns = `repeat(${this._cols}, minmax(130px, 1fr))`;
    }
  }

  _applyCompactStyles() {
    const compact = !!this._compactUI;
    // rows gap + inputs height
    if (this._ui?.rowsWrap) {
      this._ui.rowsWrap.style.gap = compact ? '2px 6px' : '6px 10px';
    }
    this._ui?.ch?.forEach(u => {
      if (!u) return;
      if (u.levelEl) u.levelEl.style.height = compact ? '14px' : '18px';
      if (u.panEl) u.panEl.style.height = compact ? '14px' : '18px';
      if (u.row) { u.row.style.padding = compact ? '0' : '2px 0'; }
    });
    if (this._ui?.masterEl) this._ui.masterEl.style.height = compact ? '14px' : '18px';
  }

  // Create and wire audio nodes for a channel (1-based index for naming)
  _createChannelAudio(idx) {
    const ctx = this.audioCtx;
    const input = ctx.createGain();
    const mute = ctx.createGain(); mute.gain.value = 1;
    const level = ctx.createGain(); level.gain.value = 0.8;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = 0;
    input.connect(mute);
    mute.connect(level);
    if (pan) level.connect(pan); else level.connect(this._ensureSum());
    if (pan) pan.connect(this._ensureSum());
    return { input, mute, level, pan };
  }

  // Register this channel's ports in the inputs map
  _registerChannelPorts(idx, ch) {
    this.inputs[`in${idx}`] = { node: ch.input };
    this.inputs[`level${idx}`] = { param: ch.level.gain };
    if (ch.pan) this.inputs[`pan${idx}`] = { param: ch.pan.pan };
  }

  // Add missing channels up to n, wiring UI and ports without destroying existing DOM (to preserve cables)
  _ensureChannels(n) {
    const cur = this.channels.length;
    for (let i = cur; i < n; i++) {
      const idx = i + 1;
      const ch = this._createChannelAudio(idx);
      this.channels.push(ch);
      // Register ports so new connections work
      this._registerChannelPorts(idx, ch);
      // If ports UI already rendered, append new buttons for this channel
      if (this.inPortsEl) {
        try {
          const addPortBtn = (name) => this.inPortsEl.appendChild(this._portEl('in', name));
          addPortBtn(`in${idx}`);
          addPortBtn(`level${idx}`);
          if (ch.pan) addPortBtn(`pan${idx}`);
        } catch {}
      }
      // If controls UI exists, add a row for this channel
      if (this._ui?.rowsWrap) {
        const u = (() => {
          const row = document.createElement('div');
          row.className = 'control';
          row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px'; row.style.margin = '0'; row.style.padding = '0';
          row.innerHTML = `
            <span style="min-width:26px;text-align:right;font-size:11px;color:var(--fg-muted,inherit)">Ch ${idx}</span>
            <input data-role="level" title="Level" style="flex:1;min-width:70px;height:14px" type="range" min="0" max="1.5" step="0.01" value="0.8" />
            ${ch.pan ? '<input data-role="pan" title="Pan" style="width:80px;height:14px" type="range" min="-1" max="1" step="0.01" value="0" />' : ''}
            <input data-role="mute" title="Mute" style="transform:scale(0.9)" type="checkbox" />
          `;
          const levelEl = row.querySelector('[data-role=level]');
          const panEl = row.querySelector('[data-role=pan]');
          const muteEl = row.querySelector('[data-role=mute]');
          levelEl.addEventListener('input', () => ch.level.gain.setTargetAtTime(Number(levelEl.value), this.audioCtx.currentTime, 0.01));
          if (panEl && ch.pan) panEl.addEventListener('input', () => ch.pan.pan.setTargetAtTime(Number(panEl.value), this.audioCtx.currentTime, 0.01));
          muteEl.addEventListener('change', () => ch.mute.gain.setTargetAtTime(muteEl.checked ? 0 : 1, this.audioCtx.currentTime, 0.005));
          return { row, levelEl, panEl, muteEl };
        })();
        this._ui.rowsWrap.appendChild(u.row);
        this._ui.ch[i] = u;
        this._applyCompactStyles();
      }
    }
  }
}
