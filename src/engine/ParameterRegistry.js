/**
 * Parameter Registry
 * Manages all parameters with metadata (range, default, unit, taper, smoothing)
 */
export class ParameterRegistry {
    constructor() {
        this.parameters = new Map(); // id -> { value, metadata }
        this.listeners = new Map(); // id -> Set of callbacks
    }

    /**
     * Register a parameter with metadata
     * @param {string} id - Unique parameter ID (e.g., 'filter.cutoff')
     * @param {Object} metadata - Parameter metadata
     * @param {number} metadata.min - Minimum value
     * @param {number} metadata.max - Maximum value
     * @param {number} metadata.default - Default value
     * @param {string} metadata.unit - Unit of measurement (Hz, dB, %, ms, etc.)
     * @param {string} metadata.taper - 'linear' or 'exponential'
     * @param {number} metadata.smoothing - Smoothing time in seconds
     */
    register(id, metadata) {
        const param = {
            value: metadata.default,
            metadata: {
                min: metadata.min,
                max: metadata.max,
                default: metadata.default,
                unit: metadata.unit || '',
                taper: metadata.taper || 'linear',
                smoothing: metadata.smoothing || 0,
            }
        };
        this.parameters.set(id, param);
    }

    /**
     * Set parameter value
     * @param {string} id - Parameter ID
     * @param {number} value - New value
     * @param {boolean} notify - Whether to notify listeners (default: true)
     */
    setValue(id, value, notify = true) {
        const param = this.parameters.get(id);
        if (!param) {
            console.warn(`Parameter not found: ${id}`);
            return;
        }

        // Clamp value to range
        const clamped = Math.max(param.metadata.min, Math.min(param.metadata.max, value));
        param.value = clamped;

        if (notify) {
            this.notifyListeners(id, clamped);
        }
    }

    /**
     * Get parameter value
     * @param {string} id - Parameter ID
     * @returns {number|undefined}
     */
    getValue(id) {
        const param = this.parameters.get(id);
        return param ? param.value : undefined;
    }

    /**
     * Get parameter metadata
     * @param {string} id - Parameter ID
     * @returns {Object|undefined}
     */
    getMetadata(id) {
        const param = this.parameters.get(id);
        return param ? param.metadata : undefined;
    }

    /**
     * Get all parameters
     * @returns {Map}
     */
    getAll() {
        return new Map(this.parameters);
    }

    /**
     * Subscribe to parameter changes
     * @param {string} id - Parameter ID
     * @param {Function} callback - Callback function(value)
     */
    subscribe(id, callback) {
        if (!this.listeners.has(id)) {
            this.listeners.set(id, new Set());
        }
        this.listeners.get(id).add(callback);
    }

    /**
     * Unsubscribe from parameter changes
     * @param {string} id - Parameter ID
     * @param {Function} callback - Callback function
     */
    unsubscribe(id, callback) {
        const listeners = this.listeners.get(id);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    /**
     * Notify all listeners of a parameter change
     * @private
     */
    notifyListeners(id, value) {
        const listeners = this.listeners.get(id);
        if (listeners) {
            listeners.forEach(callback => callback(value));
        }
    }

    /**
     * Clear all parameters
     */
    clear() {
        this.parameters.clear();
        this.listeners.clear();
    }
}
