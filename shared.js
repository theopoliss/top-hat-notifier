// Constants and helpers shared by the service worker, popup and offscreen document.
//
// content.js is injected as a classic script and cannot import this module, so it
// keeps its own copy of the message names and observer states it uses.

export const TOPHAT_HOST = 'app.tophat.com';
export const TOPHAT_URL_PATTERN = `https://${TOPHAT_HOST}/*`;

export const MSG = Object.freeze({
    // background/popup -> content script
    START_OBSERVING: 'start_observing',
    STOP_OBSERVING: 'stop_observing',
    CHECK_STATUS: 'check_status',
    // content script -> background
    OBSERVER_STATE: 'observer_state',
    POLL_DETECTED: 'poll_detected',
    // popup -> background
    TEST_NOTIFICATION: 'test_notification',
    // background -> offscreen document
    PLAY_SOUND: 'play_sound'
});

export const OBSERVER_STATE = Object.freeze({
    IDLE: 'idle',
    SEARCHING: 'searching',
    OBSERVING: 'observing'
});

export const NOTIFICATION_TYPE = Object.freeze({
    BOTH: 'both',
    DESKTOP: 'desktop',
    SOUND: 'sound'
});

// User preferences, synced across the user's devices.
export const DEFAULT_SETTINGS = Object.freeze({
    notificationType: NOTIFICATION_TYPE.BOTH,
    volume: 80, // 0-100
    requireInteraction: true
});

// Per-device state that should not follow the user to other machines.
export const DEFAULT_LOCAL_STATE = Object.freeze({
    paused: false,
    lastDetectedAt: null // epoch ms of the last detected question
});

// IDs of tabs whose content script is currently observing. Lives in session
// storage so it survives service worker restarts but not browser restarts.
export const MONITORING_TABS_KEY = 'monitoringTabs';

export function isTopHatUrl(url) {
    if (!url) return false;
    try {
        const { protocol, hostname } = new URL(url);
        return protocol === 'https:' && hostname === TOPHAT_HOST;
    } catch {
        return false;
    }
}

// The Classroom tab is the only TopHat page whose URL contains "lecture".
export function isLectureUrl(url) {
    return isTopHatUrl(url) && url.includes('lecture');
}

export function includesDesktop(notificationType) {
    return notificationType !== NOTIFICATION_TYPE.SOUND;
}

export function includesSound(notificationType) {
    return notificationType !== NOTIFICATION_TYPE.DESKTOP;
}

export function getSettings() {
    return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

export function saveSettings(patch) {
    return chrome.storage.sync.set(patch);
}

export function getLocalState() {
    return chrome.storage.local.get(DEFAULT_LOCAL_STATE);
}

export function saveLocalState(patch) {
    return chrome.storage.local.set(patch);
}

export async function getMonitoringTabIds() {
    const stored = await chrome.storage.session.get({ [MONITORING_TABS_KEY]: [] });
    return stored[MONITORING_TABS_KEY];
}
