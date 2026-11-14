import {
    MSG,
    OBSERVER_STATE,
    MONITORING_TABS_KEY,
    isTopHatUrl,
    isLectureUrl,
    includesDesktop,
    includesSound,
    getSettings,
    saveSettings,
    getLocalState,
    saveLocalState,
    getMonitoringTabIds
} from './shared.js';

// Each status sets the tone (colour) of the status box and the text shown in it.
// Tones: ok = working, pending = connecting, idle = nothing to do, error = a problem.
// `showHelp` adds the getting-started steps below the box.
const STATUS = {
    connected: { tone: 'ok', text: 'Monitoring for questions' },
    connecting: { tone: 'pending', text: 'Connecting to the Classroom page…' },
    paused: { tone: 'idle', text: 'Alerts paused' },
    notMonitoring: { tone: 'error', text: 'Not monitoring. Try reloading the page.' },
    notClassroom: { tone: 'idle', text: 'Go to the Classroom tab to start', showHelp: true },
    notTopHat: { tone: 'idle', text: 'Open TopHat to start', showHelp: true }
};

const el = {
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    lastDetected: document.getElementById('lastDetected'),
    help: document.getElementById('help'),
    paused: document.getElementById('paused'),
    notificationTypes: [...document.getElementsByName('notificationType')],
    volumeSetting: document.getElementById('volumeSetting'),
    volume: document.getElementById('volume'),
    volumeValue: document.getElementById('volumeValue'),
    requireInteractionSetting: document.getElementById('requireInteractionSetting'),
    requireInteraction: document.getElementById('requireInteraction'),
    testButton: document.getElementById('testNotification')
};

init();

async function init() {
    const [settings, localState] = await Promise.all([getSettings(), getLocalState()]);

    renderSettings(settings);
    el.paused.checked = localState.paused;
    renderLastDetected(localState.lastDetectedAt);
    bindEvents();

    chrome.storage.onChanged.addListener(onStorageChanged);
    await renderStatus();
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

let statusRequest = 0;

async function renderStatus() {
    // Only the most recent request may paint, since they can resolve out of order.
    const request = ++statusRequest;
    const status = await getStatus();
    if (request !== statusRequest) return;

    el.status.dataset.tone = status.tone;
    el.statusText.textContent = status.text;
    el.help.hidden = !status.showHelp;
}

async function getStatus() {
    const [{ paused }, monitoringTabIds, [activeTab]] = await Promise.all([
        getLocalState(),
        getMonitoringTabIds(),
        chrome.tabs.query({ active: true, currentWindow: true })
    ]);

    if (paused) return STATUS.paused;
    // A Classroom tab in any window counts, not just the one in front.
    if (monitoringTabIds.length > 0) return STATUS.connected;

    // Nothing is being monitored, so say what to do about it from here.
    const url = activeTab?.url;
    if (!isTopHatUrl(url)) return STATUS.notTopHat;
    if (!isLectureUrl(url)) return STATUS.notClassroom;

    const state = await getObserverState(activeTab.id);
    if (state === OBSERVER_STATE.OBSERVING) return STATUS.connected;
    if (state === OBSERVER_STATE.SEARCHING) return STATUS.connecting;
    return STATUS.notMonitoring;
}

async function getObserverState(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: MSG.CHECK_STATUS });
        return response?.state;
    } catch {
        return undefined; // no content script in the tab
    }
}

function renderLastDetected(timestamp) {
    el.lastDetected.textContent = formatLastDetected(timestamp);
}

function formatLastDetected(timestamp) {
    if (!timestamp) return 'No questions detected yet';

    const date = new Date(timestamp);
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) {
        return `Last question: ${time}`;
    }
    const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Last question: ${day}, ${time}`;
}

function onStorageChanged(changes, area) {
    if (area === 'local' && 'lastDetectedAt' in changes) {
        renderLastDetected(changes.lastDetectedAt.newValue);
    }
    if (area === 'local' && 'paused' in changes) {
        el.paused.checked = Boolean(changes.paused.newValue);
        renderStatus();
    }
    if (area === 'session' && MONITORING_TABS_KEY in changes) {
        renderStatus();
    }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function renderSettings(settings) {
    for (const radio of el.notificationTypes) {
        radio.checked = radio.value === settings.notificationType;
    }
    el.volume.value = settings.volume;
    el.volumeValue.textContent = `${settings.volume}%`;
    el.requireInteraction.checked = settings.requireInteraction;
    showRelevantSettings(settings.notificationType);
}

// Volume only matters when sound plays; staying visible only matters for desktop notifications.
function showRelevantSettings(notificationType) {
    el.volumeSetting.hidden = !includesSound(notificationType);
    el.requireInteractionSetting.hidden = !includesDesktop(notificationType);
}

function bindEvents() {
    el.paused.addEventListener('change', () => {
        saveLocalState({ paused: el.paused.checked });
    });

    for (const radio of el.notificationTypes) {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            showRelevantSettings(radio.value);
            saveSettings({ notificationType: radio.value });
        });
    }

    // Update the label while dragging, but save once on release:
    // chrome.storage.sync rate-limits writes.
    el.volume.addEventListener('input', () => {
        el.volumeValue.textContent = `${el.volume.value}%`;
    });
    el.volume.addEventListener('change', () => {
        saveSettings({ volume: Number(el.volume.value) });
    });

    el.requireInteraction.addEventListener('change', () => {
        saveSettings({ requireInteraction: el.requireInteraction.checked });
    });

    el.testButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: MSG.TEST_NOTIFICATION }).catch(() => {});
        el.testButton.textContent = 'Notification sent';
        el.testButton.disabled = true;

        setTimeout(() => {
            el.testButton.textContent = 'Test notification';
            el.testButton.disabled = false;
        }, 2000);
    });
}
