if (!window.highlightScriptLoaded) {
  window.highlightScriptLoaded = true;

  (function() {
    if (typeof window.highlights === 'undefined') {
      window.highlights = {};
    }

    function loadColors() {
      return new Promise((resolve) => {
        chrome.storage.sync.get('highlightColors', (data) => {
          window.highlightColors = data.highlightColors || [];
          resolve();
        });
      });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "restoreHighlights") {
        loadColors().then(() => {
          restoreHighlights();
        });
      } else if (request.action.startsWith("highlight-color-")) {
        const colorIndex = parseInt(request.action.split("-")[2]) - 1;
        applyHighlight(colorIndex);
      }
      sendResponse({ received: true });
      return true;
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
          const parent = highlightedElement.parentNode;
          while (highlightedElement.firstChild) {
            parent.insertBefore(highlightedElement.firstChild, highlightedElement);
          }
          parent.removeChild(highlightedElement);
          delete highlights[highlightedElement.dataset.id];
        } else {
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
      highlight.style.borderRadius = '3px';
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
        window.highlights = data.highlights || {};
        for (const [id, highlight] of Object.entries(window.highlights)) {
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

    function addNewHighlight(selectedText, highlightColor, highlightOpacity) {
      const highlightId = Date.now().toString();
      highlights[highlightId] = {
        text: selectedText,
        color: highlightColor,
        opacity: highlightOpacity
      };
      saveHighlights();
      
      chrome.runtime.sendMessage({
        action: 'saveHighlight',
        url: window.location.href,
        title: document.title,
        highlightInfo: highlights[highlightId]
      });
    }
  })();
}