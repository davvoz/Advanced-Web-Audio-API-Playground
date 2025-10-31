/**
 * EventBus
 * Central event communication system for engine-to-UI messaging
 */
export class EventBus extends EventTarget {
    constructor() {
        super();
    }

    /**
     * Emit an event
     * @param {string} eventName - Event name
     * @param {*} data - Event data
     */
    emit(eventName, data) {
        this.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    }

    /**
     * Listen to an event
     * @param {string} eventName - Event name
     * @param {Function} handler - Event handler
     */
    on(eventName, handler) {
        this.addEventListener(eventName, (e) => handler(e.detail));
    }

    /**
     * Remove event listener
     * @param {string} eventName - Event name
     * @param {Function} handler - Event handler
     */
    off(eventName, handler) {
        this.removeEventListener(eventName, handler);
    }
}
