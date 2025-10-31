/**
 * MIDI Manager
 * Handles MIDI input, learn mode, and CC mapping at the engine level
 */
export class MIDIManager extends EventTarget {
    constructor(parameterRegistry) {
        super();
        this.parameterRegistry = parameterRegistry;
        this.midiAccess = null;
        this.mappings = new Map(); // CC number -> parameter ID
        this.learnMode = false;
        this.learnTarget = null;
    }

    /**
     * Initialize MIDI access
     */
    async init() {
        if (!navigator.requestMIDIAccess) {
            console.warn('Web MIDI API not supported');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            this.setupMIDIInputs();
            this.dispatchEvent(new CustomEvent('initialized'));
            return true;
        } catch (err) {
            console.error('Failed to initialize MIDI:', err);
            return false;
        }
    }

    /**
     * Setup MIDI input listeners
     * @private
     */
    setupMIDIInputs() {
        if (!this.midiAccess) return;

        this.midiAccess.inputs.forEach(input => {
            input.onmidimessage = (e) => this.handleMIDIMessage(e);
        });

        // Listen for device changes
        this.midiAccess.onstatechange = (e) => {
            if (e.port.type === 'input') {
                if (e.port.state === 'connected') {
                    e.port.onmidimessage = (msg) => this.handleMIDIMessage(msg);
                }
            }
            this.dispatchEvent(new CustomEvent('deviceChanged', { detail: e }));
        };
    }

    /**
     * Handle incoming MIDI message
     * @private
     */
    handleMIDIMessage(event) {
        const [status, data1, data2] = event.data;
        const messageType = status & 0xf0;
        const channel = status & 0x0f;

        // Control Change (CC)
        if (messageType === 0xb0) {
            this.handleCC(data1, data2, channel);
        }
        // Note On
        else if (messageType === 0x90) {
            this.dispatchEvent(new CustomEvent('noteOn', { 
                detail: { note: data1, velocity: data2, channel } 
            }));
        }
        // Note Off
        else if (messageType === 0x80) {
            this.dispatchEvent(new CustomEvent('noteOff', { 
                detail: { note: data1, velocity: data2, channel } 
            }));
        }
    }

    /**
     * Handle CC message
     * @private
     */
    handleCC(ccNumber, value, channel) {
        // Learn mode: map the CC to the target parameter
        if (this.learnMode && this.learnTarget) {
            this.addMapping(ccNumber, this.learnTarget);
            this.learnMode = false;
            this.dispatchEvent(new CustomEvent('learned', { 
                detail: { ccNumber, parameterId: this.learnTarget } 
            }));
            this.learnTarget = null;
            return;
        }

        // Normal mode: apply mapped CC to parameter
        const parameterId = this.mappings.get(ccNumber);
        if (parameterId) {
            const metadata = this.parameterRegistry.getMetadata(parameterId);
            if (metadata) {
                // Convert MIDI value (0-127) to parameter range
                const normalized = value / 127;
                let paramValue;
                
                if (metadata.taper === 'exponential') {
                    // Quadratic scaling for smoother control at lower values
                    // For true exponential, use: Math.exp(normalized * Math.log(range)) - 1
                    // But quadratic (power of 2) works well for most audio parameters
                    const range = metadata.max - metadata.min;
                    paramValue = metadata.min + range * Math.pow(normalized, 2);
                } else {
                    // Linear scaling
                    paramValue = metadata.min + (metadata.max - metadata.min) * normalized;
                }
                
                this.parameterRegistry.setValue(parameterId, paramValue);
                
                this.dispatchEvent(new CustomEvent('ccMapped', { 
                    detail: { ccNumber, parameterId, value: paramValue } 
                }));
            }
        }

        // Always emit raw CC event
        this.dispatchEvent(new CustomEvent('cc', { 
            detail: { ccNumber, value, channel } 
        }));
    }

    /**
     * Start MIDI learn mode for a parameter
     * @param {string} parameterId - Parameter ID to learn
     */
    startLearn(parameterId) {
        this.learnMode = true;
        this.learnTarget = parameterId;
        this.dispatchEvent(new CustomEvent('learnStarted', { 
            detail: { parameterId } 
        }));
    }

    /**
     * Cancel MIDI learn mode
     */
    cancelLearn() {
        this.learnMode = false;
        this.learnTarget = null;
        this.dispatchEvent(new CustomEvent('learnCancelled'));
    }

    /**
     * Add a MIDI CC mapping
     * @param {number} ccNumber - CC number (0-127)
     * @param {string} parameterId - Parameter ID
     */
    addMapping(ccNumber, parameterId) {
        this.mappings.set(ccNumber, parameterId);
        this.dispatchEvent(new CustomEvent('mappingAdded', { 
            detail: { ccNumber, parameterId } 
        }));
    }

    /**
     * Remove a MIDI CC mapping
     * @param {number} ccNumber - CC number
     */
    removeMapping(ccNumber) {
        const parameterId = this.mappings.get(ccNumber);
        if (parameterId) {
            this.mappings.delete(ccNumber);
            this.dispatchEvent(new CustomEvent('mappingRemoved', { 
                detail: { ccNumber, parameterId } 
            }));
        }
    }

    /**
     * Get all mappings
     * @returns {Map}
     */
    getMappings() {
        return new Map(this.mappings);
    }

    /**
     * Clear all mappings
     */
    clearMappings() {
        this.mappings.clear();
        this.dispatchEvent(new CustomEvent('mappingsCleared'));
    }

    /**
     * Serialize MIDI mappings
     * @returns {Object}
     */
    serialize() {
        return {
            mappings: Array.from(this.mappings.entries()).map(([cc, param]) => ({ cc, param }))
        };
    }

    /**
     * Load MIDI mappings
     * @param {Object} data - Serialized mappings
     */
    load(data) {
        this.clearMappings();
        if (data.mappings) {
            data.mappings.forEach(({ cc, param }) => {
                this.addMapping(cc, param);
            });
        }
    }

    /**
     * Get available MIDI devices
     * @returns {Array}
     */
    getDevices() {
        if (!this.midiAccess) return [];
        
        const devices = [];
        this.midiAccess.inputs.forEach(input => {
            devices.push({
                id: input.id,
                name: input.name,
                manufacturer: input.manufacturer,
                state: input.state,
                type: 'input'
            });
        });
        
        return devices;
    }
}
