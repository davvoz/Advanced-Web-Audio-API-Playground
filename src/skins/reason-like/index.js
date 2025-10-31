/**
 * Reason-like Skin
 * Rack-mounted modular interface inspired by Propellerhead Reason
 */
export default class ReasonLikeSkin {
    constructor(engine, container, skinDescriptor) {
        this.engine = engine;
        this.container = container;
        this.config = skinDescriptor;
        this.rackModules = new Map();
        
        this.init();
    }

    init() {
        // Create rack container
        this.createRackUI();
        
        // Listen to engine events
        this.setupEngineListeners();
        
        // Apply rack theme
        this.applyRackTheme();
    }

    createRackUI() {
        // Clear existing UI
        this.container.innerHTML = '';
        
        // Create rack view
        const rackView = document.createElement('div');
        rackView.className = 'rack-view';
        rackView.style.cssText = `
            width: 100%;
            height: 100%;
            background: ${this.config.theme.rackBackground};
            overflow-y: auto;
            padding: 20px;
        `;
        
        this.rackContainer = document.createElement('div');
        this.rackContainer.className = 'rack-container';
        this.rackContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: ${this.config.rackConfig.spacing}px;
            max-width: ${this.config.rackConfig.moduleWidth}px;
            margin: 0 auto;
        `;
        
        rackView.appendChild(this.rackContainer);
        this.container.appendChild(rackView);
        
        // Create cable panel (simplified for now)
        this.createCablePanel();
    }

    createCablePanel() {
        const cablePanel = document.createElement('div');
        cablePanel.className = 'cable-panel';
        cablePanel.style.cssText = `
            position: fixed;
            right: 0;
            top: 0;
            width: 300px;
            height: 100%;
            background: ${this.config.theme.backgroundColor};
            border-left: 2px solid ${this.config.theme.primaryColor};
            padding: 20px;
            overflow-y: auto;
            z-index: 1000;
        `;
        
        const title = document.createElement('h3');
        title.textContent = 'Cable Connections';
        title.style.color = this.config.theme.textColor;
        cablePanel.appendChild(title);
        
        this.connectionsList = document.createElement('div');
        this.connectionsList.className = 'connections-list';
        cablePanel.appendChild(this.connectionsList);
        
        this.container.appendChild(cablePanel);
    }

    applyRackTheme() {
        const root = document.documentElement;
        Object.entries(this.config.theme).forEach(([key, value]) => {
            root.style.setProperty(`--rack-${key}`, value);
        });
    }

    setupEngineListeners() {
        this.engine.addEventListener('moduleCreated', (e) => this.onModuleCreated(e.detail));
        this.engine.addEventListener('moduleRemoved', (e) => this.onModuleRemoved(e.detail));
        this.engine.addEventListener('connected', (e) => this.onConnected(e.detail));
        this.engine.addEventListener('disconnected', (e) => this.onDisconnected(e.detail));
    }

    onModuleCreated({ id, type, instance }) {
        // Create rack-mounted module UI
        const modulePanel = this.createModulePanel(id, type, instance);
        this.rackModules.set(id, modulePanel);
        this.rackContainer.appendChild(modulePanel);
    }

    onModuleRemoved({ id }) {
        const modulePanel = this.rackModules.get(id);
        if (modulePanel) {
            modulePanel.remove();
            this.rackModules.delete(id);
        }
    }

    createModulePanel(id, type, instance) {
        const panel = document.createElement('div');
        panel.className = 'rack-module-panel';
        panel.dataset.moduleId = id;
        panel.style.cssText = `
            background: ${this.config.theme.moduleBackground};
            border: 2px solid ${this.config.theme.primaryColor};
            border-radius: 4px;
            padding: 15px;
            min-height: ${this.config.rackConfig.moduleHeight}px;
            position: relative;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        
        // Module header
        const header = document.createElement('div');
        header.className = 'module-header';
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid ${this.config.theme.primaryColor};
        `;
        
        const title = document.createElement('h4');
        title.textContent = type;
        title.style.cssText = `
            color: ${this.config.theme.textColor};
            margin: 0;
            font-size: 14px;
            font-weight: bold;
        `;
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'remove-module-btn';
        removeBtn.style.cssText = `
            background: #c33;
            color: white;
            border: none;
            border-radius: 3px;
            width: 24px;
            height: 24px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        `;
        removeBtn.addEventListener('click', () => {
            this.engine.removeModule(id);
        });
        
        header.appendChild(title);
        header.appendChild(removeBtn);
        panel.appendChild(header);
        
        // Module content
        const content = document.createElement('div');
        content.className = 'module-content';
        content.textContent = `${type} module controls would go here`;
        content.style.cssText = `
            color: ${this.config.theme.textColor};
            font-size: 12px;
            padding: 10px;
        `;
        panel.appendChild(content);
        
        // Add screws if enabled
        if (this.config.rackConfig.showScrews) {
            this.addScrews(panel);
        }
        
        return panel;
    }

    addScrews(panel) {
        const positions = [
            { top: '10px', left: '10px' },
            { top: '10px', right: '10px' },
            { bottom: '10px', left: '10px' },
            { bottom: '10px', right: '10px' }
        ];
        
        positions.forEach(pos => {
            const screw = document.createElement('div');
            screw.className = 'rack-screw';
            screw.style.cssText = `
                position: absolute;
                width: 8px;
                height: 8px;
                background: #666;
                border-radius: 50%;
                border: 1px solid #333;
                ${Object.entries(pos).map(([k, v]) => `${k}: ${v}`).join('; ')};
            `;
            panel.appendChild(screw);
        });
    }

    onConnected(connection) {
        this.updateConnectionsList();
    }

    onDisconnected({ connectionId }) {
        this.updateConnectionsList();
    }

    updateConnectionsList() {
        if (!this.connectionsList) return;
        
        this.connectionsList.innerHTML = '';
        
        const connections = this.engine.getConnections();
        connections.forEach((conn, id) => {
            const fromModule = this.engine.getModule(conn.fromModuleId);
            const toModule = this.engine.getModule(conn.toModuleId);
            
            if (!fromModule || !toModule) return;
            
            const connItem = document.createElement('div');
            connItem.className = 'connection-item';
            connItem.style.cssText = `
                padding: 8px;
                margin: 5px 0;
                background: ${this.config.theme.panelColor};
                border-radius: 3px;
                font-size: 11px;
                color: ${this.config.theme.textColor};
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            
            const label = document.createElement('span');
            const fromType = fromModule.constructor.name.replace('Module', '');
            const toType = toModule.constructor.name.replace('Module', '');
            label.textContent = `${fromType}.${conn.fromPortName} → ${toType}.${conn.toPortName}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '×';
            deleteBtn.style.cssText = `
                background: #c33;
                color: white;
                border: none;
                border-radius: 2px;
                width: 20px;
                height: 20px;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
            `;
            deleteBtn.addEventListener('click', () => {
                this.engine.disconnect(id);
            });
            
            connItem.appendChild(label);
            connItem.appendChild(deleteBtn);
            this.connectionsList.appendChild(connItem);
        });
    }

    dispose() {
        // Clean up
        this.rackModules.clear();
    }
}
