// Keep track of tabs where content script is injected
let activeTabsWithContentScript = new Set();

// Listen for tab updates
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes("app.tophat.com")) {
        if (tab.url.includes("lecture")) {
            injectContentScript(tabId);
        } else {
            handleNonLecturePage(tabId);
        }
    }
});

// Inject content.js when user is on 'Classroom' tab
function injectContentScript(tabId) {
    chrome.scripting.executeScript(
        {
            target: { tabId: tabId },
            files: ['content.js']
        },
        () => {
            if (chrome.runtime.lastError) {
                console.error("Error injecting script: " + chrome.runtime.lastError.message);
            } else {
                activeTabsWithContentScript.add(tabId);
                chrome.tabs.sendMessage(tabId, { action: "start_observing" }, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error("Error starting observation: " + chrome.runtime.lastError.message);
                    } else {
                        console.log("Observation started successfully.");
                    }
                });
            }
        }
    );
}

function handleNonLecturePage(tabId) {
    if (activeTabsWithContentScript.has(tabId)) {
        stopObserving(tabId);
        activeTabsWithContentScript.delete(tabId);
    } else {
        console.log("Not a lecture page and content script not injected. No action needed.");
    }
}

function stopObserving(tabId) {
    chrome.tabs.sendMessage(tabId, { action: "stop_observing" }, function(response) {
        if (chrome.runtime.lastError) {
            console.log("Failed to stop observation: " + chrome.runtime.lastError.message);
        } else {
            console.log("Observation stopped successfully.");
        }
    });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "poll_detected") {
        chrome.notifications.create({
            title: 'TopHat Notifier',
            message: 'A new poll or question is live in your TopHat class!',
            iconUrl: 'images/tophat_logo.png',
            type: 'basic'
        });
        sendResponse({ status: "Notification sent" });
    }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    if (activeTabsWithContentScript.has(tabId)) {
        activeTabsWithContentScript.delete(tabId);
        console.log(`Tab ${tabId} was closed. Removed from active tabs list.`);
    }
});