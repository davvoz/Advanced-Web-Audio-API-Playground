/**
 * JSON Schemas for patch and skin definitions
 */

/**
 * Patch schema structure:
 * {
 *   version: 2,
 *   modules: [
 *     {
 *       id: 'mod-xyz',
 *       type: 'Oscillator',
 *       position: { x: 100, y: 200 },
 *       state: { freq: 440, type: 'sine', ... },
 *       bgColor: '#123456'
 *     }
 *   ],
 *   connections: [
 *     {
 *       from: { moduleId: 'mod-xyz', port: 'out' },
 *       to: { moduleId: 'mod-abc', port: 'in' }
 *     }
 *   ]
 * }
 */
export const PatchSchema = {
    version: 2,
    modules: [],
    connections: []
};

/**
 * Skin schema structure:
 * {
 *   name: 'Default',
 *   version: 1,
 *   layout: 'canvas' | 'rack',
 *   theme: {
 *     primaryColor: '#333',
 *     accentColor: '#0a0',
 *     backgroundColor: '#111',
 *     moduleBackground: '#222',
 *     ...
 *   },
 *   controls: {
 *     'parameter-id': {
 *       type: 'slider' | 'knob' | 'button' | 'dropdown',
 *       label: 'Frequency',
 *       position: { x: 10, y: 20 },
 *       size: { width: 100, height: 20 },
 *       range: { min: 0, max: 1000 },
 *       taper: 'linear' | 'exponential'
 *     }
 *   },
 *   assets: {
 *     knobImage: 'path/to/knob.png',
 *     ...
 *   }
 * }
 */
export const SkinSchema = {
    name: '',
    version: 1,
    layout: 'canvas',
    theme: {},
    controls: {},
    assets: {}
};

/**
 * Validate patch data
 * @param {Object} patch - Patch to validate
 * @returns {boolean}
 */
export function validatePatch(patch) {
    if (!patch || typeof patch !== 'object') return false;
    if (!Array.isArray(patch.modules)) return false;
    if (!Array.isArray(patch.connections)) return false;
    return true;
}

/**
 * Validate skin data
 * @param {Object} skin - Skin to validate
 * @returns {boolean}
 */
export function validateSkin(skin) {
    if (!skin || typeof skin !== 'object') return false;
    if (!skin.name || typeof skin.name !== 'string') return false;
    if (!skin.layout || (skin.layout !== 'canvas' && skin.layout !== 'rack')) return false;
    return true;
}
