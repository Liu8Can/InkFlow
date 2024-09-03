// 在文件顶部添加这行
document.addEventListener('DOMContentLoaded', () => {
  loadColors().then(() => {
    restoreHighlights();
  });
});

let highlights = [];

function loadColors() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('highlightColors', (data) => {
      highlightColors = data.highlightColors || [];
      resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "restoreHighlights") {
    restoreHighlights();
  } else if (request.action.startsWith("highlight-color-")) {
    const colorIndex = parseInt(request.action.split("-")[2]) - 1;
    applyHighlight(colorIndex);
  }
  // 可选：发送响应
  sendResponse({ received: true });
  return true; // 表示异步响应
});

function applyHighlight(colorIndex) {
  chrome.storage.sync.get('highlightColors', (data) => {
    const colors = data.highlightColors || [];
    const colorObj = colors[colorIndex];

    if (colorObj) {
      toggleHighlight(hexToRGBA(colorObj.color, colorObj.opacity));
    }
  });
}

function toggleHighlight(color) {
  const selection = window.getSelection();
  if (!selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const highlightedElement = range.commonAncestorContainer.parentElement;

    if (highlightedElement && highlightedElement.classList.contains('highlight')) {
      // 如果已经高亮,则取消高亮
      const parent = highlightedElement.parentNode;
      while (highlightedElement.firstChild) {
        parent.insertBefore(highlightedElement.firstChild, highlightedElement);
      }
      parent.removeChild(highlightedElement);
      delete highlights[highlightedElement.dataset.id];
    } else {
      // 如果未高亮,则添加高亮
      addHighlight(range, color);
    }
    saveHighlights();
  }
}

function addHighlight(range, color) {
  const highlightId = Date.now().toString();
  const highlight = document.createElement('span');
  highlight.className = 'highlight';
  highlight.style.backgroundColor = color;
  highlight.style.borderRadius = '3px'; // 添加圆角样式
  // highlight.style.padding = '0 2px'; // 添加一些内边距,使圆角更明显
  highlight.dataset.id = highlightId;

  range.surroundContents(highlight);

  highlights[highlightId] = {
    color,
    content: highlight.textContent
  };
}

function saveHighlights() {
  chrome.storage.local.set({ highlights: highlights });
}

function restoreHighlights() {
  chrome.storage.local.get('highlights', (data) => {
    highlights = data.highlights || {};
    for (const [id, highlight] of Object.entries(highlights)) {
      const range = findTextRange(highlight.content);
      if (range) {
        const highlightElement = document.createElement('span');
        highlightElement.className = 'highlight';
        highlightElement.style.backgroundColor = highlight.color;
        highlightElement.dataset.id = id;

        range.surroundContents(highlightElement);
      }
    }
  });
}

function findTextRange(text) {
  const textNodes = [];
  const treeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  while (treeWalker.nextNode()) {
    textNodes.push(treeWalker.currentNode);
  }

  for (const node of textNodes) {
    const index = node.textContent.indexOf(text);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      return range;
    }
  }

  return null;
}



function hexToRGBA(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}