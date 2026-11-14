// Injected by background.js into TopHat Classroom ("lecture") pages. Watches the
// student content tree and tells the background when a new question appears.
//
// This is a classic script, so the message names and states below are duplicated
// from shared.js rather than imported.
(() => {
    const CONTAINER_SELECTOR = '[class*="StudentContentTree"]';
    const MAX_RETRIES = 10;
    const RETRY_INTERVAL_MS = 2000;

    const State = { IDLE: 'idle', SEARCHING: 'searching', OBSERVING: 'observing' };

    let state = State.IDLE;
    let observer = null;
    let container = null;
    let retryTimer = null;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        switch (message.action) {
            case 'start_observing':
                start();
                sendResponse({ state });
                break;
            case 'stop_observing':
                stop();
                sendResponse({ state });
                break;
            case 'check_status':
                sendResponse({ state });
                break;
        }
    });

    // Safe to call repeatedly: does nothing while a search or a healthy observer is running.
    function start() {
        if (state === State.SEARCHING) return;
        if (state === State.OBSERVING && container.isConnected) return;
        teardown();
        findContainer({ fallbackToBody: true });
    }

    function stop() {
        teardown();
        setState(State.IDLE);
    }

    function teardown() {
        clearTimeout(retryTimer);
        retryTimer = null;
        observer?.disconnect();
        observer = null;
        container = null;
    }

    // Polls for the content tree. With fallbackToBody, gives up after MAX_RETRIES
    // and observes the whole page instead; without it, keeps polling until stopped.
    function findContainer({ fallbackToBody }, attempt = 0) {
        retryTimer = null;

        const found = document.querySelector(CONTAINER_SELECTOR);
        if (found) {
            observe(found);
            return;
        }
        if (fallbackToBody && attempt >= MAX_RETRIES) {
            console.log(`TopHat Notifier: ${CONTAINER_SELECTOR} not found, observing the whole page instead.`);
            observe(document.body);
            return;
        }

        setState(State.SEARCHING);
        retryTimer = setTimeout(() => findContainer({ fallbackToBody }, attempt + 1), RETRY_INTERVAL_MS);
    }

    function observe(node) {
        container = node;
        observer = new MutationObserver(onMutations);
        // Attribute changes are not inspected, but they do wake the callback so
        // it can notice that the container has been detached from the page.
        observer.observe(node, { childList: true, subtree: true, attributes: true });
        setState(State.OBSERVING);
    }

    function onMutations(mutations) {
        // TopHat tore down the content tree. Treat that as a question going live,
        // then wait for the tree to come back. No body fallback here: when the
        // tree is rebuilt its existing items would all look like new questions.
        if (!container.isConnected) {
            send({ action: 'poll_detected' });
            teardown();
            findContainer({ fallbackToBody: false });
            return;
        }

        // Each new item in the tree is a question or poll going live.
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'LI') {
                    send({ action: 'poll_detected' });
                }
            }
        }
    }

    function setState(next) {
        if (state === next) return;
        state = next;
        send({ action: 'observer_state', state });
    }

    function send(message) {
        // The extension was reloaded or updated, leaving this script orphaned.
        // A fresh copy is injected by the new background, so shut this one down.
        if (!chrome.runtime?.id) {
            teardown();
            state = State.IDLE;
            return;
        }
        chrome.runtime.sendMessage(message).catch(() => {});
    }
})();
