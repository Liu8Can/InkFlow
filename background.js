const DEFAULT_COLORS = [
  { color: '#FF809D', opacity: 0.4 },
  { color: '#FCF485', opacity: 0.4 },
  { color: '#C5FB72', opacity: 0.4 },
  { color: '#38E5FF', opacity: 0.4 }
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ highlightColors: DEFAULT_COLORS });
  chrome.storage.local.set({ highlights: {} });
});

function isValidUrl(url) {
  return url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
}

function injectContentScript(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  }).then(() => {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: "restoreHighlights" });
    }, 500);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isValidUrl(tab.url)) {
    injectContentScript(tabId);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command.startsWith('highlight-color-')) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && isValidUrl(tabs[0].url)) {
        chrome.tabs.sendMessage(tabs[0].id, { action: command }).catch(() => {
          injectContentScript(tabs[0].id);
        });
      }
    });
  }
});

function saveHighlight(url, title, highlightInfo) {
  chrome.storage.local.get(['highlights'], (result) => {
    const highlights = result.highlights || {};
    if (!highlights[url]) {
      highlights[url] = {
        title: title,
        date: new Date().toISOString().split('T')[0],
        highlights: []
      };
    }
    highlights[url].highlights.push(highlightInfo);
    chrome.storage.local.set({ highlights: highlights });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveHighlight') {
    saveHighlight(request.url, request.title, request.highlightInfo);
  }
});