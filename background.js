const DEFAULT_COLORS = [
  { color: '#FF809D', opacity: 0.4 },
  { color: '#FCF485', opacity: 0.4 },
  { color: '#C5FB72', opacity: 0.4 },
  { color: '#38E5FF', opacity: 0.4 }
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ highlightColors: DEFAULT_COLORS }, () => {
    console.log('默认高亮颜色已初始化');
  });

  chrome.storage.local.set({ highlights: {} }, () => {
    console.log('初始化高亮存储');
  });
});

function isValidUrl(url) {
  return url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isValidUrl(tab.url)) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).then(() => {
      chrome.tabs.sendMessage(tabId, { action: "restoreHighlights" }).catch(() => {
        console.log('Failed to send message, content script might not be ready yet');
      });
    }).catch((error) => {
      console.log('Failed to execute script:', error);
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command.startsWith('highlight-color-')) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && isValidUrl(tabs[0].url)) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        }).then(() => {
          chrome.tabs.sendMessage(tabs[0].id, { action: command }).catch(() => {
            console.log('Failed to send message, content script might not be ready yet');
          });
        }).catch((error) => {
          console.log('Failed to execute script:', error);
        });
      }
    });
  }
});