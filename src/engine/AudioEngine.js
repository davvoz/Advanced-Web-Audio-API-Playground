/**
 * AudioEngine
 * Core audio engine that manages the modular audio graph
 * Independent of UI implementation
 */
import { ParameterRegistry } from './ParameterRegistry.js';
import { MIDIManager } from './MIDIManager.js';
import { ModuleRegistry } from '../../modules/index.js';

export class AudioEngine extends EventTarget {
    constructor() {
        super();
        this.audioCtx = null;
        this.modules = new Map(); // id -> module instance
        this.connections = new Map(); // id -> connection
        this.parameterRegistry = new ParameterRegistry();
        this.midiManager = new MIDIManager(this.parameterRegistry);
        this.nextModuleId = 0;
        this.nextConnectionId = 0;
    }

    /**
     * Initialize the audio engine
     */
    async init() {
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new Ctx();
        }
        
        // Initialize MIDI
        await this.midiManager.init();
        
        this.dispatchEvent(new CustomEvent('initialized', { detail: { state: this.audioCtx.state } }));
    }

    /**
     * Get audio context
     */
    getAudioContext() {
        return this.audioCtx;
    }

    /**
     * Resume/suspend audio context
     */
    async setAudioState(running) {
        if (!this.audioCtx) this.init();
        
        if (running && this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        } else if (!running && this.audioCtx.state === 'running') {
            await this.audioCtx.suspend();
        }
        
        this.dispatchEvent(new CustomEvent('audioStateChanged', { 
            detail: { state: this.audioCtx.state, running: this.audioCtx.state === 'running' } 
        }));
        
        // Notify all modules
        this.modules.forEach(m => m.onAudioStateChange?.(this.audioCtx.state));
    }

    /**
     * Create a module
     * @param {string} type - Module type
     * @param {Object} config - Module configuration
     * @returns {Object} Created module instance
     */
    createModule(type, config = {}) {
        const Ctor = ModuleRegistry[type];
        if (!Ctor) {
            throw new Error(`Unknown module type: ${type}`);
        }

        if (!this.audioCtx) this.init();

        const id = config.id || this.generateModuleId();
        const instance = new Ctor({
            id,
            audioCtx: this.audioCtx,
            workspace: null, // Will be set by UI
            cableLayer: null, // Will be set by UI
            position: config.position || { x: 0, y: 0 },
            onPortClick: null, // Will be set by UI
            onMove: null, // Will be set by UI
            onRemove: (modId) => this.removeModule(modId),
            getConnectionsFrom: (modId) => [...this.connections.values()].filter(c => c.fromModuleId === modId),
            getModuleById: (modId) => this.modules.get(modId),
            getZoom: () => 1, // Default zoom
        });

        this.modules.set(id, instance);
        
        // Register module parameters
        this.registerModuleParameters(id, instance);
        
        this.dispatchEvent(new CustomEvent('moduleCreated', { detail: { id, type, instance } }));
        
        return instance;
    }

    /**
     * Remove a module
     * @param {string} id - Module ID
     */
    removeModule(id) {
        const module = this.modules.get(id);
        if (!module) return;

        // Remove all connections
        [...this.connections.values()]
            .filter(c => c.fromModuleId === id || c.toModuleId === id)
            .forEach(c => this.disconnect(c.id));

        // Dispose module
        module.dispose?.();
        this.modules.delete(id);

        this.dispatchEvent(new CustomEvent('moduleRemoved', { detail: { id } }));
    }

    /**
     * Get a module by ID
     * @param {string} id - Module ID
     * @returns {Object|undefined}
     */
    getModule(id) {
        return this.modules.get(id);
    }

    /**
     * Get all modules
     * @returns {Map}
     */
    getModules() {
        return new Map(this.modules);
    }

    /**
     * Connect two modules
     * @param {string} fromModuleId - Source module ID
     * @param {string} fromPort - Source port name
     * @param {string} toModuleId - Destination module ID
     * @param {string} toPort - Destination port name
     * @returns {string} Connection ID
     */
    connect(fromModuleId, fromPort, toModuleId, toPort) {
        const fromModule = this.modules.get(fromModuleId);
        const toModule = this.modules.get(toModuleId);

        if (!fromModule || !toModule) {
            throw new Error('Module not found');
        }

        const outInfo = fromModule.getOutputPortInfo(fromPort);
        const inInfo = toModule.getInputPortInfo(toPort);

        if (!outInfo || !inInfo) {
            throw new Error('Port not found');
        }

        // Remove existing connection to the same input
        const existing = [...this.connections.values()]
            .find(c => c.toModuleId === toModuleId && c.toPortName === toPort);
        if (existing) {
            this.disconnect(existing.id);
        }

        // Connect audio nodes
        try {
            if (inInfo.param) {
                outInfo.node.connect(inInfo.param);
            } else if (inInfo.node) {
                outInfo.node.connect(inInfo.node);
            } else {
                throw new Error('Invalid input port');
            }
        } catch (err) {
            throw new Error(`Audio connection failed: ${err.message}`);
        }

        // Store connection
        const id = this.generateConnectionId();
        const connection = {
            id,
            fromModuleId,
            fromPortName: fromPort,
            toModuleId,
            toPortName: toPort,
        };
        this.connections.set(id, connection);

        // Notify parameter connection
        if (inInfo.param) {
            toModule.onParamConnected?.(toPort, fromModuleId, fromPort);
        }

        this.dispatchEvent(new CustomEvent('connected', { detail: connection }));

        return id;
    }

    /**
     * Disconnect modules
     * @param {string} connectionId - Connection ID
     */
    disconnect(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        const fromModule = this.modules.get(connection.fromModuleId);
        const toModule = this.modules.get(connection.toModuleId);

        if (fromModule && toModule) {
            try {
                const outInfo = fromModule.getOutputPortInfo(connection.fromPortName);
                const inInfo = toModule.getInputPortInfo(connection.toPortName);

                if (outInfo && inInfo) {
                    if (inInfo.param) {
                        outInfo.node.disconnect(inInfo.param);
                    } else if (inInfo.node) {
                        outInfo.node.disconnect(inInfo.node);
                    }
                }

                // Notify parameter disconnection
                if (inInfo?.param) {
                    toModule.onParamDisconnected?.(connection.toPortName, connection.fromModuleId, connection.fromPortName);
                }
            } catch (err) {
                console.warn('Audio disconnect error:', err);
            }
        }

        this.connections.delete(connectionId);
        this.dispatchEvent(new CustomEvent('disconnected', { detail: { connectionId } }));
    }

    /**
     * Get all connections
     * @returns {Map}
     */
    getConnections() {
        return new Map(this.connections);
    }

    /**
     * Set parameter value
     * @param {string} parameterId - Parameter ID (e.g., 'module-1.cutoff')
     * @param {number} value - New value
     */
    setParameter(parameterId, value) {
        this.parameterRegistry.setValue(parameterId, value);
    }

    /**
     * Get parameter value
     * @param {string} parameterId - Parameter ID
     * @returns {number|undefined}
     */
    getParameter(parameterId) {
        return this.parameterRegistry.getValue(parameterId);
    }

    /**
     * Get all parameters
     * @returns {Map}
     */
    getParameters() {
        return this.parameterRegistry.getAll();
    }

    /**
     * Serialize the current patch
     * @returns {Object} Patch data
     */
    serialize() {
        const modules = [...this.modules.values()].map(m => ({
            id: m.id,
            type: m.constructor.name.replace('Module', ''),
            position: { x: m.x, y: m.y },
            state: m.toJSON?.() || {},
            bgColor: m.getBgColor?.(),
        }));

        const connections = [...this.connections.values()].map(c => ({
            from: { moduleId: c.fromModuleId, port: c.fromPortName },
            to: { moduleId: c.toModuleId, port: c.toPortName },
        }));

        return {
            version: 2,
            modules,
            connections,
        };
    }

    /**
     * Load a patch
     * @param {Object} patch - Patch data
     */
    loadPatch(patch) {
        // Clear existing
        this.clear();

        // Create modules
        const idMap = new Map();
        (patch.modules || []).forEach(m => {
            try {
                const instance = this.createModule(m.type, {
                    id: m.id,
                    position: m.position || { x: 0, y: 0 }
                });
                
                // Load state
                instance.fromJSON?.(m.state || {});
                if (m.bgColor) instance.setBackgroundColor?.(m.bgColor);
                
                idMap.set(m.id, instance);
            } catch (err) {
                console.warn(`Failed to create module ${m.type}:`, err);
            }
        });

        // Create connections
        (patch.connections || []).forEach(c => {
            try {
                this.connect(
                    c.from.moduleId,
                    c.from.port,
                    c.to.moduleId,
                    c.to.port
                );
            } catch (err) {
                console.warn('Failed to create connection:', err);
            }
        });

        this.dispatchEvent(new CustomEvent('patchLoaded', { detail: { patch } }));
    }

    /**
     * Clear all modules and connections
     */
    clear() {
        // Remove all connections
        [...this.connections.keys()].forEach(id => this.disconnect(id));
        
        // Remove all modules
        [...this.modules.keys()].forEach(id => this.removeModule(id));
        
        this.parameterRegistry.clear();
    }

    /**
     * Generate unique module ID
     * @private
     */
    generateModuleId() {
        return `mod-${Date.now().toString(36)}-${(this.nextModuleId++).toString(36)}`;
    }

    /**
     * Generate unique connection ID
     * @private
     */
    generateConnectionId() {
        return `conn-${Date.now().toString(36)}-${(this.nextConnectionId++).toString(36)}`;
    }

    /**
     * Register parameters for a module
     * @private
     */
    registerModuleParameters(moduleId, moduleInstance) {
        // This is a placeholder for future parameter registration
        // Each module would need to expose its parameters for registration
    }

    /**
     * Get MIDI manager
     * @returns {MIDIManager}
     */
    getMIDIManager() {
        return this.midiManager;
    }

    /**
     * Get parameter registry
     * @returns {ParameterRegistry}
     */
    getParameterRegistry() {
        return this.parameterRegistry;
    }
}
