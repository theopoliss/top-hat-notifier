import {
    MSG,
    OBSERVER_STATE,
    MONITORING_TABS_KEY,
    TOPHAT_URL_PATTERN,
    isTopHatUrl,
    isLectureUrl,
    includesDesktop,
    includesSound,
    getSettings,
    getLocalState,
    saveLocalState,
    getMonitoringTabIds
} from './shared.js';

const EXTENSION_NAME = 'TopHat Question Notifier';
const NOTIFICATION_ID_PREFIX = 'tophat-question';
const ALERT_BADGE_MS = 5000;

const BADGE = {
    alert: { text: '!', color: '#d13239', title: `${EXTENSION_NAME}: a question is live!` },
    paused: { text: 'OFF', color: '#757575', title: `${EXTENSION_NAME}: alerts paused` },
    monitoring: { text: 'ON', color: '#2e7d32', title: `${EXTENSION_NAME}: monitoring for questions` },
    idle: { text: '', color: null, title: EXTENSION_NAME }
};

// ---------------------------------------------------------------------------
// Tab tracking: start the observer on Classroom pages, stop it everywhere else
// ---------------------------------------------------------------------------

// Per-tab promise chains, so overlapping navigation events for one tab are
// handled in order and never inject the content script twice.
const pendingSyncs = new Map();

function syncTab(tab) {
    const previous = pendingSyncs.get(tab.id) ?? Promise.resolve();
    const current = previous
        .then(() => applyTabState(tab))
        .catch((error) => console.error(`Failed to sync tab ${tab.id}:`, error))
        .finally(() => {
            if (pendingSyncs.get(tab.id) === current) {
                pendingSyncs.delete(tab.id);
            }
        });
    pendingSyncs.set(tab.id, current);
    return current;
}

async function applyTabState(tab) {
    if (!isTopHatUrl(tab.url)) {
        await setMonitoring(tab.id, false);
        return;
    }

    // A discarded tab cannot detect questions, so keep TopHat tabs loaded.
    if (tab.autoDiscardable !== false) {
        await chrome.tabs.update(tab.id, { autoDiscardable: false });
    }

    if (isLectureUrl(tab.url)) {
        await startObserving(tab.id);
    } else {
        await stopObserving(tab.id);
    }
}

async function startObserving(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: MSG.START_OBSERVING });
    } catch {
        // Nothing answered, so this document has no content script yet.
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await chrome.tabs.sendMessage(tabId, { action: MSG.START_OBSERVING });
    }
}

async function stopObserving(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: MSG.STOP_OBSERVING });
    } catch {
        // No content script in this document, so there is nothing to stop.
    }
    await setMonitoring(tabId, false);
}

// Serialises read-modify-write updates of the monitoring tab list.
let monitoringUpdates = Promise.resolve();

function setMonitoring(tabId, observing) {
    monitoringUpdates = monitoringUpdates
        .then(async () => {
            const tabIds = new Set(await getMonitoringTabIds());
            if (tabIds.has(tabId) === observing) return;
            if (observing) {
                tabIds.add(tabId);
            } else {
                tabIds.delete(tabId);
            }
            await chrome.storage.session.set({ [MONITORING_TABS_KEY]: [...tabIds] });
        })
        .catch((error) => console.error('Failed to update monitoring tabs:', error));
    return monitoringUpdates;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // `url` covers in-app navigation between TopHat tabs; `complete` covers full page loads.
    if (changeInfo.url || changeInfo.status === 'complete') {
        syncTab(tab);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    setMonitoring(tabId, false);
});

chrome.runtime.onInstalled.addListener(async () => {
    await migrateSettings();

    // Content scripts from before an install or update are gone or orphaned,
    // so set up every TopHat tab that is already open.
    const tabs = await chrome.tabs.query({ url: TOPHAT_URL_PATTERN });
    for (const tab of tabs) {
        syncTab(tab);
    }
});

// 0.0.6 had a separate `soundEnabled` checkbox that could contradict
// `notificationType`. The type alone now decides whether sound plays.
async function migrateSettings() {
    const stored = await chrome.storage.sync.get(['soundEnabled', 'notificationType']);
    if (stored.soundEnabled === undefined) return;

    if (stored.soundEnabled === false && stored.notificationType !== 'desktop') {
        await chrome.storage.sync.set({ notificationType: 'desktop' });
    }
    await chrome.storage.sync.remove('soundEnabled');
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender) => {
    switch (message.action) {
        case MSG.POLL_DETECTED:
            handlePollDetected(sender.tab?.id);
            break;
        case MSG.TEST_NOTIFICATION:
            alertUser();
            break;
        case MSG.OBSERVER_STATE:
            if (sender.tab) {
                setMonitoring(sender.tab.id, message.state === OBSERVER_STATE.OBSERVING);
            }
            break;
    }
});

async function handlePollDetected(tabId) {
    await saveLocalState({ lastDetectedAt: Date.now() });

    const { paused } = await getLocalState();
    if (!paused) {
        await alertUser(tabId);
    }
}

// ---------------------------------------------------------------------------
// Alerts: desktop notification, sound, and badge
// ---------------------------------------------------------------------------

async function alertUser(tabId) {
    const settings = await getSettings();

    flashAlertBadge();

    const jobs = [];
    if (includesDesktop(settings.notificationType)) {
        jobs.push(showNotification(tabId, settings.requireInteraction));
    }
    if (includesSound(settings.notificationType)) {
        jobs.push(playSound(settings.volume));
    }

    for (const result of await Promise.allSettled(jobs)) {
        if (result.status === 'rejected') {
            console.error('Alert failed:', result.reason);
        }
    }
}

// The source tab ID is carried in the notification ID, so a click can be routed
// back to that tab even if the service worker was restarted in between.
function showNotification(tabId, requireInteraction) {
    const id = `${NOTIFICATION_ID_PREFIX}:${tabId ?? ''}:${crypto.randomUUID()}`;
    return chrome.notifications.create(id, {
        type: 'basic',
        title: 'TopHat Notifier',
        message: 'A new poll or question is live in your TopHat class!',
        iconUrl: 'images/tophat48.png',
        requireInteraction
    });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
    const [prefix, tabId] = notificationId.split(':');
    if (prefix !== NOTIFICATION_ID_PREFIX) return;

    chrome.notifications.clear(notificationId);

    const tab = await findTopHatTab(tabId ? Number(tabId) : null);
    if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
    }
});

// Prefers the tab that raised the alert, then any Classroom tab, then any TopHat tab.
async function findTopHatTab(preferredTabId) {
    if (preferredTabId !== null) {
        try {
            const tab = await chrome.tabs.get(preferredTabId);
            if (isTopHatUrl(tab.url)) return tab;
        } catch {
            // The tab has been closed since the notification was shown.
        }
    }
    const tabs = await chrome.tabs.query({ url: TOPHAT_URL_PATTERN });
    return tabs.find((tab) => isLectureUrl(tab.url)) ?? tabs[0] ?? null;
}

async function playSound(volume) {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({ action: MSG.PLAY_SOUND, volume });
}

// Chrome closes an audio offscreen document after 30 seconds of silence, so its
// existence is checked before every sound instead of being remembered.
let offscreenReady = null;

function ensureOffscreenDocument() {
    offscreenReady ??= (async () => {
        const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (existing.length === 0) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'Playing notification sounds for TopHat alerts'
            });
        }
    })().finally(() => {
        offscreenReady = null;
    });
    return offscreenReady;
}

// The badge is a pure function of three things: a recent alert, the pause
// switch, and whether any tab is being monitored.
let alertBadgeUntil = 0;

function flashAlertBadge() {
    alertBadgeUntil = Date.now() + ALERT_BADGE_MS;
    refreshBadge();
    setTimeout(refreshBadge, ALERT_BADGE_MS + 50);
}

async function refreshBadge() {
    try {
        const badge = await currentBadge();
        await chrome.action.setBadgeText({ text: badge.text });
        if (badge.color) {
            await chrome.action.setBadgeBackgroundColor({ color: badge.color });
        }
        await chrome.action.setTitle({ title: badge.title });
    } catch (error) {
        console.error('Failed to update badge:', error);
    }
}

async function currentBadge() {
    if (Date.now() < alertBadgeUntil) return BADGE.alert;

    const [{ paused }, monitoringTabIds] = await Promise.all([getLocalState(), getMonitoringTabIds()]);
    if (paused) return BADGE.paused;
    if (monitoringTabIds.length > 0) return BADGE.monitoring;
    return BADGE.idle;
}

chrome.storage.onChanged.addListener((changes, area) => {
    const pauseChanged = area === 'local' && 'paused' in changes;
    const monitoringChanged = area === 'session' && MONITORING_TABS_KEY in changes;
    if (pauseChanged || monitoringChanged) {
        refreshBadge();
    }
});

// Runs on every service worker start, which also clears an alert badge left
// behind if the worker was stopped before its reset timer fired.
refreshBadge();
