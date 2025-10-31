/**
 * Default Skin
 * Canvas-based modular interface (current UI)
 */
export default class DefaultSkin {
    constructor(engine, container, skinDescriptor) {
        this.engine = engine;
        this.container = container;
        this.config = skinDescriptor;
        this.linking = null;
        this.zoom = 1;
        
        this.init();
    }

    init() {
        // Store references to DOM elements
        this.workspace = document.getElementById('workspace');
        this.zoomLayer = document.getElementById('zoom-layer');
        this.cableLayer = document.getElementById('cable-layer');
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Listen to engine events
        this.setupEngineListeners();
        
        // Initialize zoom
        this.setZoom(1);
    }

    setupEventListeners() {
        // Palette drag and drop
        const palette = document.getElementById('palette');
        if (palette) {
            palette.addEventListener('dragstart', (e) => this.handleDragStart(e));
        }

        if (this.workspace) {
            this.workspace.addEventListener('dragover', (e) => e.preventDefault());
            this.workspace.addEventListener('drop', (e) => this.handleDrop(e));
            this.workspace.addEventListener('scroll', () => this.updateAllCables());
        }

        // Zoom controls
        const zoomIn = document.getElementById('zoom-in');
        const zoomOut = document.getElementById('zoom-out');
        const zoomReset = document.getElementById('zoom-reset');
        
        if (zoomIn) zoomIn.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        if (zoomOut) zoomOut.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        if (zoomReset) zoomReset.addEventListener('click', () => this.setZoom(1));
    }

    setupEngineListeners() {
        // Listen to module creation
        this.engine.addEventListener('moduleCreated', (e) => this.onModuleCreated(e.detail));
        
        // Listen to module removal
        this.engine.addEventListener('moduleRemoved', (e) => this.onModuleRemoved(e.detail));
        
        // Listen to connections
        this.engine.addEventListener('connected', (e) => this.onConnected(e.detail));
        this.engine.addEventListener('disconnected', (e) => this.onDisconnected(e.detail));
    }

    handleDragStart(e) {
        const target = e.target.closest('.palette-item');
        if (!target) return;
        e.dataTransfer.setData('text/plain', target.dataset.moduleType);
    }

    handleDrop(e) {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/plain');
        if (!type) return;
        
        const rect = this.zoomLayer.getBoundingClientRect();
        const x = (e.clientX - rect.left) / this.zoom;
        const y = (e.clientY - rect.top) / this.zoom;
        
        this.engine.createModule(type, { position: { x, y } });
    }

    onModuleCreated({ id, instance }) {
        // Set up module UI callbacks
        if (instance.element) {
            instance.workspace = this.zoomLayer || this.workspace;
            instance.cableLayer = this.cableLayer;
            instance.onPortClick = (data) => this.handlePortClick(data);
            instance.onMove = (moduleId) => this.updateConnectedCables(moduleId);
            instance.getZoom = () => this.zoom;
        }
    }

    onModuleRemoved({ id }) {
        // UI cleanup handled by module's dispose method
    }

    onConnected(connection) {
        // Draw cable
        this.drawCable(connection);
    }

    onDisconnected({ connectionId }) {
        // Remove cable visual
        this.removeCable(connectionId);
    }

    handlePortClick({ moduleId, portEl, portName, direction }) {
        if (!this.linking) {
            if (direction === 'in') {
                // Check if already connected, if so, disconnect
                const connections = [...this.engine.getConnections().values()];
                const existing = connections.find(c => c.toModuleId === moduleId && c.toPortName === portName);
                if (existing) {
                    this.engine.disconnect(existing.id);
                }
                return;
            }
            if (direction !== 'out') return;
            
            // Start linking
            this.linking = {
                fromModuleId: moduleId,
                fromPortEl: portEl,
                fromPortName: portName,
                previewPath: this.createCablePath(true),
            };
            this.updatePreviewCableToMouse(portEl);
            this.workspace.addEventListener('mousemove', (e) => this.onWorkspaceMouseMove(e));
        } else {
            // Complete link
            if (direction !== 'in') {
                this.cancelLinking();
                return;
            }
            
            try {
                this.engine.connect(
                    this.linking.fromModuleId,
                    this.linking.fromPortName,
                    moduleId,
                    portName
                );
            } catch (err) {
                console.error('Connection error:', err);
            }
            
            this.cancelLinking();
        }
    }

    cancelLinking() {
        if (this.linking?.previewPath) {
            this.cableLayer.removeChild(this.linking.previewPath.path);
            this.cableLayer.removeChild(this.linking.previewPath.hit);
        }
        this.linking = null;
    }

    onWorkspaceMouseMove(e) {
        if (!this.linking) return;
        this.updatePreviewCableToMouse(this.linking.fromPortEl, e);
    }

    drawCable(connection) {
        const fromModule = this.engine.getModule(connection.fromModuleId);
        const toModule = this.engine.getModule(connection.toModuleId);
        
        if (!fromModule || !toModule) return;
        
        const fromPortEl = fromModule.getPortEl('out', connection.fromPortName);
        const toPortEl = toModule.getPortEl('in', connection.toPortName);
        
        if (!fromPortEl || !toPortEl) return;
        
        const { x: x1, y: y1 } = this.portCenter(fromPortEl);
        const { x: x2, y: y2 } = this.portCenter(toPortEl);
        const pathNodes = this.createCablePath(false);
        const d = this.cubicPath(x1, y1, x2, y2);
        
        pathNodes.path.setAttribute('d', d);
        pathNodes.hit.setAttribute('d', d);
        
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        if (pathNodes.del) {
            pathNodes.del.setAttribute('cx', mx);
            pathNodes.del.setAttribute('cy', my);
        }
        
        // Store visual elements
        connection.path = pathNodes.path;
        connection.hit = pathNodes.hit;
        connection.del = pathNodes.del;
        connection.fromPortEl = fromPortEl;
        connection.toPortEl = toPortEl;
    }

    removeCable(connectionId) {
        const connections = this.engine.getConnections();
        const connection = connections.get(connectionId);
        if (connection) {
            connection.path?.remove();
            connection.hit?.remove();
            connection.del?.remove();
        }
    }

    createCablePath(isPreview = false) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', `cable${isPreview ? ' active' : ''}`);
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.setAttribute('class', 'cable hit');
        const del = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        del.setAttribute('r', '6');
        del.setAttribute('class', 'cable-del');
        del.style.cursor = 'pointer';
        
        this.cableLayer.appendChild(path);
        this.cableLayer.appendChild(hit);
        if (!isPreview) {
            this.cableLayer.appendChild(del);
            hit.addEventListener('dblclick', () => {
                const conn = [...this.engine.getConnections().values()].find(c => c.path === path);
                if (conn) this.engine.disconnect(conn.id);
            });
            del.addEventListener('click', () => {
                const conn = [...this.engine.getConnections().values()].find(c => c.path === path);
                if (conn) this.engine.disconnect(conn.id);
            });
        }
        
        return { path, hit, del };
    }

    cubicPath(x1, y1, x2, y2) {
        const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
        const c1x = x1 + dx;
        const c1y = y1;
        const c2x = x2 - dx;
        const c2y = y2;
        return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
    }

    portCenter(portEl) {
        const rectZ = this.zoomLayer.getBoundingClientRect();
        const rect = portEl.getBoundingClientRect();
        
        if (rect.width > 0 && rect.height > 0) {
            return {
                x: (rect.left - rectZ.left + rect.width / 2) / this.zoom,
                y: (rect.top - rectZ.top + rect.height / 2) / this.zoom,
            };
        }
        
        const container = portEl.closest('.port-list') || portEl.closest('.module') || this.zoomLayer;
        const crect = container.getBoundingClientRect();
        const isIn = portEl.classList.contains('in');
        const x = (crect.left - rectZ.left + (isIn ? 6 : crect.width - 6)) / this.zoom;
        const y = (crect.top - rectZ.top + crect.height / 2) / this.zoom;
        return { x, y };
    }

    updatePreviewCableToMouse(fromEl, e) {
        const { x: x1, y: y1 } = this.portCenter(fromEl);
        const { x: x2, y: y2 } = e
            ? { x: (e.clientX - this.zoomLayer.getBoundingClientRect().left) / this.zoom, 
                y: (e.clientY - this.zoomLayer.getBoundingClientRect().top) / this.zoom }
            : { x: x1 + 60, y: y1 };
        const d = this.cubicPath(x1, y1, x2, y2);
        this.linking.previewPath.path.setAttribute('d', d);
        this.linking.previewPath.hit.setAttribute('d', d);
    }

    updateConnectedCables(moduleId) {
        const connections = this.engine.getConnections();
        connections.forEach((c) => {
            if (moduleId !== 'ALL' && c.fromModuleId !== moduleId && c.toModuleId !== moduleId) return;
            if (!c.fromPortEl || !c.toPortEl) return;
            
            const { x: x1, y: y1 } = this.portCenter(c.fromPortEl);
            const { x: x2, y: y2 } = this.portCenter(c.toPortEl);
            const d = this.cubicPath(x1, y1, x2, y2);
            c.path?.setAttribute('d', d);
            c.hit?.setAttribute('d', d);
            
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            if (c.del) {
                c.del.setAttribute('cx', mx);
                c.del.setAttribute('cy', my);
            }
        });
    }

    updateAllCables() {
        this.updateConnectedCables('ALL');
    }

    setZoom(z) {
        this.zoom = Math.min(2, Math.max(0.4, z));
        if (this.zoomLayer) {
            this.zoomLayer.style.transform = `scale(${this.zoom})`;
        }
        
        const zoomLevelEl = document.getElementById('zoom-level');
        if (zoomLevelEl) {
            zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
        }
        
        const r = this.zoomLayer.getBoundingClientRect();
        this.cableLayer.setAttribute('width', (r.width / this.zoom));
        this.cableLayer.setAttribute('height', (r.height / this.zoom));
        this.updateAllCables();
    }

    dispose() {
        // Clean up event listeners
        this.cancelLinking();
    }
}
