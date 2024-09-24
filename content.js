let observer = null;
const MAX_RETRIES = 10;
const RETRY_INTERVAL = 2000; // 1 second

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "start_observing") {
        startObserving();
        sendResponse({status: "Observation started"});
    } else if (request.action === "stop_observing") {
        stopObserving();
    }
});

// function startObserving() {
//     if (document.readyState === "loading") {
//         document.addEventListener("DOMContentLoaded", initializeObserver);
//     } else {
//         initializeObserver();
//     }
// }

function startObserving() {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => waitForElement('[class*="BlankStateContent"]', initializeObserver));
    } else {
        waitForElement('[class*="BlankStateContent"]', initializeObserver);
    }
}

function waitForElement(selector, callback, retryCount = 0) {
    const element = document.querySelector(selector);
    if (element) {
        console.log(`Element ${selector} found.`);
        callback(element);
    } else if (retryCount < MAX_RETRIES) {
        console.log(`Element ${selector} not found. Retrying in ${RETRY_INTERVAL}ms...`);
        setTimeout(() => waitForElement(selector, callback, retryCount + 1), RETRY_INTERVAL);
    } else {
        console.log(`Element ${selector} not found after ${MAX_RETRIES} attempts. Initializing observer on body.`);
        callback(document.body); // Fall back to observing the body if the element is never found
    }
}

function initializeObserver(containerNode) {
    // console.log('DOM fully loaded. Now starting to observe');
    // const containerNode = document.querySelector('.course-container');
    // const containerNode = document.querySelector('[class*="BlankStateContent"]');

    console.log('Initializing observer on:', containerNode);
    
    if (containerNode) {
        observer = new MutationObserver(function(mutations) {
            // containerNode children modified
            // mutations.forEach(function(mutation) {
            //     if (mutation.type === "childList") {
            //         console.log('Child nodes have changed in containerNode');

            //         // Log the nodes that were added
            //         if (mutation.addedNodes.length > 0) {
            //             console.log('Added nodes:');
            //             mutation.addedNodes.forEach(function(node) {
            //                 console.log(node);
            //             });
            //         }

            //         // Log the nodes that were removed
            //         if (mutation.removedNodes.length > 0) {
            //             console.log('Removed nodes:');
            //             mutation.removedNodes.forEach(function(node) {
            //                 console.log(node);
            //             });
            //         }
            //         if (mutation.addedNodes)
            //         chrome.runtime.sendMessage({ action: "poll_detected" });
            //     }
            // });
            
            // containerNode was deleted
            if (!document.body.contains(containerNode)) {
                console.log('New content detected! Poll/question may be active');
                chrome.runtime.sendMessage({action: "poll_detected"});
                stopObserving();
            }
        });

        const config = { childList: true, subtree: true, attributes: true };
        observer.observe(document.body, config);
        console.log('Observer started');
    } else {
        console.log('containerNode was not found. Not starting observer.');
    }
}

function stopObserving() {
    if (observer) {
        observer.disconnect();
        console.log('Observer disconnected.');
    }
}