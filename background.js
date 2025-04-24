const DEFAULT_COLORS = [
  { color: '#FF809D', opacity: 0.4 }, // Pinkish Red
  { color: '#FCF485', opacity: 0.4 }, // Yellow
  { color: '#C5FB72', opacity: 0.4 }, // Green
  { color: '#38E5FF', opacity: 0.4 }  // Blue
];
const STORAGE_KEY_COLORS = 'highlightColors';
const STORAGE_KEY_HIGHLIGHTS = 'pageHighlights'; // Changed key name

// --- Initialization ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Extension installed or updated:", details.reason);
  // Initialize colors only on first install
  await chrome.storage.sync.get(STORAGE_KEY_COLORS).then(async (data) => {
      if (!data[STORAGE_KEY_COLORS]) {
          console.log("Initializing default colors.");
          await chrome.storage.sync.set({ [STORAGE_KEY_COLORS]: DEFAULT_COLORS });
      }
  });
  // Initialize highlights storage (local) if it doesn't exist
  await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS).then(async (data) => {
      if (!data[STORAGE_KEY_HIGHLIGHTS]) {
           console.log("Initializing highlights storage.");
          await chrome.storage.local.set({ [STORAGE_KEY_HIGHLIGHTS]: {} });
      }
  });

   // Ensure content script is injected into existing tabs on update/install
   if (details.reason === "update" || details.reason === "install") {
      const tabs = await chrome.tabs.query({url: ["http://*/*", "https://*/*"]});
      for (const tab of tabs) {
          if (isValidUrl(tab.url)) {
              try {
                  console.log(`Injecting script into existing tab: ${tab.id}`);
                  await chrome.scripting.executeScript({
                      target: { tabId: tab.id },
                      files: ['content.js'],
                  });
                  await chrome.scripting.insertCSS({
                       target: { tabId: tab.id },
                       files: ['styles.css']
                  });
                  // Send message to restore immediately after injection
                  await chrome.tabs.sendMessage(tab.id, { action: "requestRestoration" });

              } catch (e) {
                  console.warn(`Failed to inject script or CSS into tab ${tab.id} (${tab.url}):`, e);
              }
          }
      }
  }

});

// --- Utility ---
function isValidUrl(url) {
  return url && url.startsWith('http') && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
  // Basic check, might need refinement for file URLs etc. if needed
}

function sanitizeUrl(url) {
  try {
      const urlObj = new URL(url);
      // Remove hash and search params? Maybe keep search params? For now, keep simple.
      // urlObj.hash = '';
      // urlObj.search = '';
      return urlObj.origin + urlObj.pathname; // Use origin + path as the key
  } catch (e) {
      console.error("Failed to sanitize URL:", url, e);
      return url; // Fallback to original url
  }
}


// --- Event Listeners ---

// Inject content script on navigation/update
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Inject when the page is loaded, but ideally before it's fully idle if possible
  // 'loading' might be too early, 'complete' is reliable
  if (changeInfo.status === 'complete' && isValidUrl(tab.url)) {
       console.log(`Tab ${tabId} updated to complete status, injecting content script.`);
       chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
       }).then(() => {
           console.log("Content script injected successfully for tab:", tabId);
           // Also inject CSS
           return chrome.scripting.insertCSS({
               target: { tabId: tabId },
               files: ['styles.css']
           });
       }).then(() => {
           console.log("CSS injected successfully for tab:", tabId);
           // Send message to trigger restoration *after* script and CSS are injected
           return chrome.tabs.sendMessage(tabId, { action: "requestRestoration" });
       }).then((response) => {
           if (chrome.runtime.lastError) {
               console.warn(`Message 'requestRestoration' to tab ${tabId} failed:`, chrome.runtime.lastError.message);
           } else {
               console.log("Restoration request sent to tab:", tabId, "Response:", response);
           }
       }).catch(err => {
          console.error(`Error injecting script/CSS or sending message to tab ${tabId}:`, err);
       });
  }
});

// Handle keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log(`Command received: ${command}`);
  if (command.startsWith('highlight-color-') && tab && isValidUrl(tab.url)) {
      const colorIndex = parseInt(command.split('-')[2]) - 1;
      if (!isNaN(colorIndex)) {
           console.log(`Sending highlight command (color index ${colorIndex}) to tab ${tab.id}`);
          try {
              const response = await chrome.tabs.sendMessage(tab.id, { action: "commandHighlight", colorIndex: colorIndex });
               console.log(`Response from tab ${tab.id} for command:`, response);
               if (!response || !response.success) {
                   console.warn("Highlight command failed or was not received by content script.");
                   // Optionally re-inject if message failed? Be careful with loops.
               }
          } catch (error) {
              if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                  console.warn(`Content script likely not ready in tab ${tab.id}. Attempting injection.`);
                  // Attempt to inject and then retry sending the command could be an option,
                  // but for simplicity, we'll rely on onUpdated for injection for now.
                  // The user might need to wait a moment after page load.
              } else {
                  console.error(`Error sending command message to tab ${tab.id}:`, error);
              }
          }
      }
  }
});

// Open options page when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
console.log("Extension icon clicked");
chrome.runtime.openOptionsPage();
});


// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action, "from:", sender.tab ? `Tab ${sender.tab.id}` : "Extension");

  // Use an async IIFE to handle the promise-based nature of storage API and sendResponse
  (async () => {
      try {
          if (request.action === 'saveHighlight') {
              if (sender.tab && isValidUrl(sender.tab.url) && request.highlightInfo) {
                  await saveHighlight(sender.tab.url, request.highlightInfo);
                  sendResponse({ success: true, id: request.highlightInfo.id });
              } else {
                  console.error("Invalid saveHighlight request:", request, sender.tab);
                  sendResponse({ success: false, error: "Invalid URL or missing data" });
              }
          } else if (request.action === 'updateHighlightNote') {
               if (sender.tab && isValidUrl(sender.tab.url) && request.highlightId && typeof request.note === 'string') {
                  await updateHighlightNote(sender.tab.url, request.highlightId, request.note);
                  sendResponse({ success: true });
              } else {
                  console.error("Invalid updateHighlightNote request:", request, sender.tab);
                  sendResponse({ success: false, error: "Invalid URL, ID, or missing note" });
              }
          } else if (request.action === 'updateHighlightColor') {
               if (sender.tab && isValidUrl(sender.tab.url) && request.highlightId && typeof request.colorIndex === 'number') {
                  await updateHighlightColor(sender.tab.url, request.highlightId, request.colorIndex);
                  sendResponse({ success: true });
              } else {
                  console.error("Invalid updateHighlightColor request:", request, sender.tab);
                  sendResponse({ success: false, error: "Invalid URL, ID, or missing color index" });
              }
          } else if (request.action === 'deleteHighlight') {
              if (sender.tab && isValidUrl(sender.tab.url) && request.highlightId) {
                  await deleteHighlight(sender.tab.url, request.highlightId);
                  sendResponse({ success: true });
              } else {
                   console.error("Invalid deleteHighlight request:", request, sender.tab);
                  sendResponse({ success: false, error: "Invalid URL or missing ID" });
              }
          } else if (request.action === 'getHighlightsForUrl') {
              if (sender.tab && isValidUrl(sender.tab.url)) {
                  const data = await getHighlightsForUrl(sender.tab.url);
                  sendResponse({ success: true, highlights: data.highlights, title: data.title });
              } else {
                  console.error("Invalid getHighlightsForUrl request:", sender.tab);
                  sendResponse({ success: false, error: "Invalid URL" });
              }
          } else if (request.action === 'getColors') {
              const colors = await getColors();
              sendResponse({ success: true, colors: colors });
          } else if (request.action === "colorsUpdated") {
              // Notify all relevant tabs that colors have changed so they can update CSS vars
               console.log("Broadcasting color update to tabs");
               const tabs = await chrome.tabs.query({url: ["http://*/*", "https://*/*"]});
               const colors = await getColors();
               for (const tab of tabs) {
                   if (isValidUrl(tab.url)) {
                      chrome.tabs.sendMessage(tab.id, { action: "applyColorUpdate", colors: colors })
                          .catch(e => console.log(`Tab ${tab.id} unresponsive to color update:`, e.message));
                   }
               }
              sendResponse({success: true});
          }
           else {
              // Optional: handle unknown actions
              // sendResponse({ success: false, error: "Unknown action" });
          }
      } catch (error) {
          console.error(`Error processing action ${request.action}:`, error);
          sendResponse({ success: false, error: error.message || "An unexpected error occurred" });
      }
  })();

  // Return true to indicate you wish to send a response asynchronously
  return true;
});


// --- Storage Functions ---

async function getColors() {
  const data = await chrome.storage.sync.get(STORAGE_KEY_COLORS);
  return data[STORAGE_KEY_COLORS] || DEFAULT_COLORS;
}

async function getHighlightsForUrl(url) {
  const sanitized = sanitizeUrl(url);
  const data = await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights = data[STORAGE_KEY_HIGHLIGHTS] || {};
  return allHighlights[sanitized] || { title: '', highlights: [] }; // Return empty array if no highlights for URL
}

async function saveHighlight(url, highlightInfo) {
  const sanitized = sanitizeUrl(url);
  const data = await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights = data[STORAGE_KEY_HIGHLIGHTS] || {};

  if (!allHighlights[sanitized]) {
      // Attempt to get title dynamically if not provided (might fail if called too early)
      let title = highlightInfo.title || ''; // Use provided title or empty
      if (!title) {
           try {
              const [tab] = await chrome.tabs.query({url: url, active: true, currentWindow: true});
               if (tab) title = tab.title;
           } catch(e) { console.warn("Could not get tab title for highlight:", e); }
      }

      allHighlights[sanitized] = {
          title: title || "Untitled Page",
          highlights: []
      };
      console.log(`Created new entry for URL: ${sanitized}`);
  } else {
       console.log(`Adding highlight to existing entry for URL: ${sanitized}`);
  }

  // Avoid duplicates (simple check based on ID)
  const index = allHighlights[sanitized].highlights.findIndex(h => h.id === highlightInfo.id);
  if (index === -1) {
      allHighlights[sanitized].highlights.push(highlightInfo);
      await chrome.storage.local.set({ [STORAGE_KEY_HIGHLIGHTS]: allHighlights });
      console.log(`Highlight ${highlightInfo.id} saved for ${sanitized}. Total: ${allHighlights[sanitized].highlights.length}`);
  } else {
      console.warn(`Highlight with ID ${highlightInfo.id} already exists for ${sanitized}. Skipping save.`);
  }
}

async function updateHighlightNote(url, highlightId, note) {
  const sanitized = sanitizeUrl(url);
  const data = await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights = data[STORAGE_KEY_HIGHLIGHTS] || {};

  if (allHighlights[sanitized] && allHighlights[sanitized].highlights) {
      const highlightIndex = allHighlights[sanitized].highlights.findIndex(h => h.id === highlightId);
      if (highlightIndex !== -1) {
          allHighlights[sanitized].highlights[highlightIndex].note = note;
          await chrome.storage.local.set({ [STORAGE_KEY_HIGHLIGHTS]: allHighlights });
          console.log(`Note updated for highlight ${highlightId} on ${sanitized}`);
      } else {
          console.warn(`Highlight ${highlightId} not found on ${sanitized} for note update.`);
      }
  } else {
       console.warn(`URL ${sanitized} not found for note update.`);
  }
}

async function updateHighlightColor(url, highlightId, colorIndex) {
  const sanitized = sanitizeUrl(url);
  const data = await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights = data[STORAGE_KEY_HIGHLIGHTS] || {};

  if (allHighlights[sanitized] && allHighlights[sanitized].highlights) {
      const highlightIndex = allHighlights[sanitized].highlights.findIndex(h => h.id === highlightId);
      if (highlightIndex !== -1) {
          allHighlights[sanitized].highlights[highlightIndex].colorIndex = colorIndex;
          await chrome.storage.local.set({ [STORAGE_KEY_HIGHLIGHTS]: allHighlights });
          console.log(`Color index updated to ${colorIndex} for highlight ${highlightId} on ${sanitized}`);
      } else {
          console.warn(`Highlight ${highlightId} not found on ${sanitized} for color update.`);
      }
  } else {
       console.warn(`URL ${sanitized} not found for color update.`);
  }
}


async function deleteHighlight(url, highlightId) {
  const sanitized = sanitizeUrl(url);
  const data = await chrome.storage.local.get(STORAGE_KEY_HIGHLIGHTS);
  const allHighlights = data[STORAGE_KEY_HIGHLIGHTS] || {};

  if (allHighlights[sanitized] && allHighlights[sanitized].highlights) {
      const initialLength = allHighlights[sanitized].highlights.length;
      allHighlights[sanitized].highlights = allHighlights[sanitized].highlights.filter(h => h.id !== highlightId);
      const finalLength = allHighlights[sanitized].highlights.length;

      if (initialLength !== finalLength) {
           // If no highlights remain for this URL, remove the URL entry? Optional.
           // if (allHighlights[sanitized].highlights.length === 0) {
           //     delete allHighlights[sanitized];
           // }
          await chrome.storage.local.set({ [STORAGE_KEY_HIGHLIGHTS]: allHighlights });
          console.log(`Highlight ${highlightId} deleted from ${sanitized}. Remaining: ${finalLength}`);
      } else {
           console.warn(`Highlight ${highlightId} not found on ${sanitized} for deletion.`);
      }
  } else {
      console.warn(`URL ${sanitized} not found for deletion.`);
  }
}

console.log("Background script loaded and running.");