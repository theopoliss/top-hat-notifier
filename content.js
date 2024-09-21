let observer = null;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "start_observing") {
        startObserving();
        sendResponse({status: "Observation started"});
    } else if (request.action === "stop_observing") {
        stopObserving();
    }
});

function startObserving() {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeObserver);
    } else {
        initializeObserver();
    }
}

function initializeObserver() {
    console.log('DOM fully loaded. Now starting to observe');
    const containerNode = document.querySelector('.StudentContentTreestyles__SectionText-sc-1pbqzkq-6 gzEpvk');
    console.log(containerNode);
    
    if (containerNode) {
        observer = new MutationObserver(function(mutations) {
            // containerNode children modified
            mutations.forEach(function(mutation) {
                if (mutation.type === "childList") {
                    console.log('Child nodes have changed in containerNode');

                    // Log the nodes that were added
                    if (mutation.addedNodes.length > 0) {
                        console.log('Added nodes:');
                        mutation.addedNodes.forEach(function(node) {
                            console.log(node);
                        });
                    }

                    // Log the nodes that were removed
                    if (mutation.removedNodes.length > 0) {
                        console.log('Removed nodes:');
                        mutation.removedNodes.forEach(function(node) {
                            console.log(node);
                        });
                    }

                    chrome.runtime.sendMessage({ action: "poll_detected" });
                }
            });
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