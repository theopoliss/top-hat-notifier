document.addEventListener('DOMContentLoaded', function() {
  const statusContainer = document.getElementById('status-container');
  const statusText = document.getElementById('status-text');
  
  // Query active tab to check if we're on TopHat and if the observer is active
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    
    // Check if we're on a TopHat page
    if (currentTab.url && currentTab.url.includes('app.tophat.com')) {
      // Check if we're specifically on a lecture page
      if (currentTab.url.includes('lecture')) {
        // Send a message to the content script to check if observer is active
        chrome.tabs.sendMessage(currentTab.id, {action: "check_status"}, function(response) {
          if (chrome.runtime.lastError) {
            updateStatus(false);
          } else if (response && response.observing) {
            updateStatus(true);
          } else {
            updateStatus(false);
          }
        });
      } else {
        // On TopHat but not on lecture page
        updateStatus(false);
        statusText.textContent = "Please go to the Classroom tab";
      }
    } else {
      // Not on TopHat at all
      updateStatus(false);
      statusText.textContent = "Please navigate to TopHat";
    }
  });
  
  function updateStatus(connected) {
    if (connected) {
      statusContainer.className = "status-container connected";
      statusText.textContent = "Connected - Monitoring for questions";
    } else {
      statusContainer.className = "status-container disconnected";
      if (statusText.textContent === "Disconnected") {
        statusText.textContent = "Not monitoring";
      }
    }
  }
}); 