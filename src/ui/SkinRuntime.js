/**
 * SkinRuntime
 * Loads and renders UI skins based on JSON skin descriptors
 */
import { validateSkin } from '../shared/schemas.js';

export class SkinRuntime {
    constructor(engine, container) {
        this.engine = engine;
        this.container = container;
        this.currentSkin = null;
        this.skinComponents = new Map();
    }

    /**
     * Load a skin
     * @param {Object} skinDescriptor - Skin configuration
     */
    async loadSkin(skinDescriptor) {
        if (!validateSkin(skinDescriptor)) {
            throw new Error('Invalid skin descriptor');
        }

        // Clear existing skin
        this.unloadSkin();

        this.currentSkin = skinDescriptor;

        // Apply theme
        this.applyTheme(skinDescriptor.theme);

        // Load skin implementation
        const skinModule = await this.loadSkinModule(skinDescriptor.name);
        if (skinModule) {
            this.skinComponents.set('main', new skinModule.default(this.engine, this.container, skinDescriptor));
        }
    }

    /**
     * Unload current skin
     */
    unloadSkin() {
        this.skinComponents.forEach(component => {
            if (component.dispose) component.dispose();
        });
        this.skinComponents.clear();
        this.currentSkin = null;
    }

    /**
     * Apply theme colors
     * @private
     */
    applyTheme(theme) {
        if (!theme) return;

        const root = document.documentElement;
        Object.entries(theme).forEach(([key, value]) => {
            root.style.setProperty(`--${key}`, value);
        });
    }

    /**
     * Load skin module dynamically
     * @private
     */
    async loadSkinModule(skinName) {
        try {
            const module = await import(`../skins/${skinName.toLowerCase().replace(/\s+/g, '-')}/index.js`);
            return module;
        } catch (err) {
            console.error(`Failed to load skin module ${skinName}:`, err);
            return null;
        }
    }

    /**
     * Get current skin
     */
    getCurrentSkin() {
        return this.currentSkin;
    }
}
