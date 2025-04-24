// Prevent script from running multiple times in the same page context
if (!window.highlightScriptLoaded) {
  window.highlightScriptLoaded = true;

  console.log("Highlighter Content Script Loaded");

  // --- Globals & Configuration ---
  let userColors = []; // To be loaded from background
  let currentHighlightMenu = null; // Reference to the currently open menu
  let selectedHighlightId = null; // ID of the highlight whose menu is open
  const CONTEXT_LENGTH = 25; // Number of characters for context matching

  // --- Initialization ---
  async function initializeHighlighter() {
      console.log("Initializing Highlighter...");
      try {
          // 1. Request colors from background
          const colorResponse = await chrome.runtime.sendMessage({ action: "getColors" });
          if (colorResponse && colorResponse.success) {
              userColors = colorResponse.colors;
              console.log("Colors loaded:", userColors);
              injectColorVariables(userColors); // Inject CSS vars
          } else {
              console.error("Failed to load colors:", colorResponse?.error);
              // Use defaults or show error? For now, proceed, highlighting might fail visually.
               injectColorVariables([]); // Inject empty to avoid errors maybe
          }

          // 2. Request existing highlights for this URL
          console.log("Requesting highlights for:", window.location.href);
          const highlightsResponse = await chrome.runtime.sendMessage({ action: "getHighlightsForUrl" });
          if (highlightsResponse && highlightsResponse.success) {
              console.log(`Highlights received for ${window.location.href}:`, highlightsResponse.highlights);
              await restoreHighlights(highlightsResponse.highlights || []);
          } else {
              console.error("Failed to load highlights:", highlightsResponse?.error);
          }
      } catch (error) {
          console.error("Error during highlighter initialization:", error);
           if (error.message.includes("Extension context invalidated")) {
              console.warn("Extension context invalidated, likely due to update. Reloading page might be needed.");
           }
      }
  }

  // --- Highlight Manipulation (Create, Restore, Delete) ---

  function applyHighlight(colorIndex) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          console.log("No text selected for highlighting.");
          return; // No text selected
      }

      if (userColors.length === 0 || colorIndex < 0 || colorIndex >= userColors.length) {
           console.error(`Invalid color index ${colorIndex} or no colors loaded.`);
           alert("无法应用高亮：颜色配置丢失或无效。请检查扩展选项。");
           return;
      }

      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();

      if (!text) {
           console.log("Selected text is empty after trimming.");
          return;
      }

      // Prevent highlighting across different major block elements if possible?
      // For simplicity, we allow it for now but it can make restoration harder.
      // Check if selection is within an existing highlight - if so, maybe offer 'change color' or 'remove'?
      // For now, allow overlapping/nesting, but delete will remove the outer one clicked.

      const highlightId = `hl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const context = getContextAroundRange(range, CONTEXT_LENGTH);

      const highlightInfo = {
          id: highlightId,
          text: text,
          preContext: context.pre,
          postContext: context.post,
          colorIndex: colorIndex,
          note: "", // Initialize with empty note
          url: window.location.href, // Include URL for context
          title: document.title // Include title
          // Add timestamp? maybe later
      };

      try {
          const highlightSpan = createHighlightSpan(highlightInfo);
          // Use surroundContents carefully. It can fail on complex selections.
          // Fallback: extract contents, create span, append contents, insert span
          range.surroundContents(highlightSpan);
          console.log("Highlight span created:", highlightSpan);

          // Save via background script
          chrome.runtime.sendMessage({ action: "saveHighlight", highlightInfo: highlightInfo })
              .then(response => {
                  if (response && response.success) {
                      console.log(`Highlight ${response.id} sent to background for saving.`);
                  } else {
                      console.error("Failed to save highlight via background:", response?.error);
                      // Attempt to undo? Might be complex. Show error to user?
                      alert("保存高亮失败，请稍后重试。");
                      removeHighlightSpan(highlightSpan); // Try to cleanup UI
                  }
              }).catch(error => {
                   console.error("Error sending saveHighlight message:", error);
                   alert("保存高亮时发生通讯错误。");
                   removeHighlightSpan(highlightSpan); // Try to cleanup UI
              });

      } catch (e) {
          console.error("Failed to surroundContents, selection might be complex:", e);
           alert("无法在此处创建高亮，选区可能跨越了不支持的元素边界。");
           // Alternative: Iterate through selected nodes, wrap text nodes? More complex.
      }

       selection.removeAllRanges(); // Deselect text after highlighting
  }

  function createHighlightSpan(highlightInfo) {
      const span = document.createElement('span');
      span.className = 'highlight';
      span.dataset.highlightId = highlightInfo.id;
      span.dataset.colorIndex = highlightInfo.colorIndex;
      span.dataset.note = highlightInfo.note || "";
      span.dataset.hasNote = !!(highlightInfo.note); // Boolean attribute for CSS

      // Apply color using CSS variable
      const colorVar = `--highlight-color-${highlightInfo.colorIndex}`;
      span.style.setProperty('--highlight-bg-color', `var(${colorVar})`);

      // Add click listener for the menu
      span.addEventListener('click', handleHighlightClick);

      return span;
  }

  async function restoreHighlights(highlights) {
      if (!highlights || highlights.length === 0) {
          console.log("No highlights to restore for this URL.");
          return;
      }
      console.log(`Attempting to restore ${highlights.length} highlights...`);

      let restoredCount = 0;
      // Sort highlights by position? Not strictly necessary with context matching, but might help avoid conflicts if ranges overlap?
      // For now, process in the order received.

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      const textNodes = [];
      while(node = walker.nextNode()) {
          if (node.nodeValue.trim() !== '' && !isNodeInsideScriptOrStyle(node)) {
               // Check if the node or its parent is visible
               if (isVisible(node.parentElement)) {
                  textNodes.push(node);
               }
          }
      }
      console.log(`Found ${textNodes.length} potentially visible text nodes.`);

      for (const highlight of highlights) {
          if (document.querySelector(`.highlight[data-highlight-id="${highlight.id}"]`)) {
              console.log(`Highlight ${highlight.id} already exists, skipping restoration.`);
              continue; // Already restored or created in this session
          }

          const range = findRangeByContext(highlight.text, highlight.preContext, highlight.postContext, textNodes);

          if (range) {
               // Check if range is already highlighted (e.g., nested highlights during manual creation)
               if (isRangeHighlighted(range)) {
                    console.log(`Skipping restoration of ${highlight.id} as range is already (partially) highlighted.`);
                    continue;
               }

              try {
                  const span = createHighlightSpan(highlight);
                  // Check if surroundContents is feasible (doesn't cross invalid boundaries)
                  if (isRangeSurroundable(range)) {
                      range.surroundContents(span);
                      restoredCount++;
                      console.log(`Restored highlight ${highlight.id}`);
                  } else {
                      console.warn(`Cannot surround range for highlight ${highlight.id}, selection might be complex or cross boundaries.`);
                      // Could attempt node-by-node wrapping as a fallback here, but it's complex.
                  }
              } catch (e) {
                  console.error(`Error surrounding contents for highlight ${highlight.id}:`, e, range);
              }
          } else {
              console.warn(`Could not find context match for highlight ${highlight.id} ("...${highlight.preContext}[${highlight.text}]${highlight.postContext}...")`);
          }
      }
      console.log(`Restored ${restoredCount} out of ${highlights.length} highlights.`);
  }

  function findRangeByContext(text, preContext, postContext, availableTextNodes) {
      // console.log(`Searching for: "...${preContext}[${text}]${postContext}..."`);

      for (const node of availableTextNodes) {
          const nodeText = node.nodeValue;
          let searchStartIndex = 0;

          while (searchStartIndex < nodeText.length) {
              // Find potential start of the main text
              const textStartIndex = nodeText.indexOf(text, searchStartIndex);
              if (textStartIndex === -1) {
                  break; // Not found in the rest of this node
              }

              // Check preceding context within the same node
              const actualPreContextStart = Math.max(0, textStartIndex - preContext.length);
              const actualPreContext = nodeText.substring(actualPreContextStart, textStartIndex);

              // Check succeeding context within the same node
              const textEndIndex = textStartIndex + text.length;
              const actualPostContextEnd = Math.min(nodeText.length, textEndIndex + postContext.length);
              const actualPostContext = nodeText.substring(textEndIndex, actualPostContextEnd);

              // console.log(` Found potential match in node: "...${actualPreContext}[${text}]${actualPostContext}..." at index ${textStartIndex}`);

              // Simple context check: does the actual context *end* with the expected preContext
              // and *start* with the expected postContext? This is less strict but handles partial matches at node boundaries better.
               // Allow some flexibility - maybe match if a significant portion overlaps?
               const preMatch = preContext === "" || actualPreContext.endsWith(preContext);
               const postMatch = postContext === "" || actualPostContext.startsWith(postContext);


              // More robust check needed if context spans multiple nodes (significantly harder)
              // For now, we focus on context within the *same* text node.

              if (preMatch && postMatch) {
                  // Ensure we haven't already highlighted this exact spot to avoid duplicates from failed saves etc.
                  const testRange = document.createRange();
                  testRange.setStart(node, textStartIndex);
                  testRange.setEnd(node, textEndIndex);

                  if (!isRangeHighlighted(testRange)) {
                      console.log(`Context match found for "${text}" at node index ${textStartIndex}.`);
                      return testRange; // Found a valid match
                  } else {
                       console.log(`Context match found but range already highlighted, continuing search...`);
                  }
              }

              // Move search start index past the current potential match to find subsequent occurrences
              searchStartIndex = textStartIndex + 1;
          }
      }

      // If not found within single nodes, could attempt multi-node search (complex)
      console.log(`Context search failed for: "...${preContext}[${text}]${postContext}..."`);
      return null; // Not found
  }

   function getContextAroundRange(range, length) {
      const pre = { startContainer: range.startContainer, startOffset: range.startOffset };
      const post = { endContainer: range.endContainer, endOffset: range.endOffset };
      let preContext = "";
      let postContext = "";

      // Pre-context
      let currentContainer = pre.startContainer;
      let currentOffset = pre.startOffset;
      while (preContext.length < length && currentContainer) {
          if (currentContainer.nodeType === Node.TEXT_NODE) {
              const text = currentContainer.nodeValue;
              const availableLength = currentOffset;
              const grabLength = Math.min(length - preContext.length, availableLength);
              preContext = text.substring(currentOffset - grabLength, currentOffset) + preContext;
              currentOffset -= grabLength;
              if (preContext.length >= length) break;
          }
          // Move to previous node/sibling/parent logic (simplified for now)
          // Try previous sibling, then parent's previous sibling etc.
          // This part is complex to get right across all DOM structures.
          // A simpler approach: just take context from the start node.
          if (currentContainer === range.commonAncestorContainer) break; // Stop if we reach the top ancestor boundary of the range
          currentContainer = currentContainer.previousSibling || currentContainer.parentNode;
          if (currentContainer && currentContainer.nodeType === Node.TEXT_NODE) {
               currentOffset = currentContainer.nodeValue.length; // Start from end of prev node
          } else {
               currentOffset = 0; // Reset offset if not text node
          }
           // Basic safeguard against infinite loops or excessive searching
           if (preContext.length > length * 2) {
               console.warn("Breaking pre-context search early.");
               break;
           }
      }
       // Trim whitespace from start?
       // preContext = preContext.trimStart();

      // Post-context (similar logic, moving forwards)
      currentContainer = post.endContainer;
      currentOffset = post.endOffset;
       while (postContext.length < length && currentContainer) {
          if (currentContainer.nodeType === Node.TEXT_NODE) {
              const text = currentContainer.nodeValue;
              const availableLength = text.length - currentOffset;
              const grabLength = Math.min(length - postContext.length, availableLength);
              postContext += text.substring(currentOffset, currentOffset + grabLength);
              currentOffset += grabLength;
               if (postContext.length >= length) break;
          }
           // Move to next node/sibling/etc. (Simplified)
            if (currentContainer === range.commonAncestorContainer) break;
            currentContainer = currentContainer.nextSibling || currentContainer.parentNode?.nextSibling; // Basic forward move
            currentOffset = 0; // Start from beginning of next node

           // Basic safeguard
            if (postContext.length > length * 2) {
               console.warn("Breaking post-context search early.");
               break;
           }
      }
       // postContext = postContext.trimEnd();


      // Return only the requested length, ensuring we don't overshoot
      return {
          pre: preContext.slice(-length),
          post: postContext.slice(0, length)
      };
  }


  function deleteHighlightById(highlightId) {
      const highlightSpan = document.querySelector(`.highlight[data-highlight-id="${highlightId}"]`);
      if (highlightSpan) {
          console.log(`Attempting to delete highlight ${highlightId} from DOM and storage.`);
          removeHighlightSpan(highlightSpan);
          chrome.runtime.sendMessage({ action: "deleteHighlight", highlightId: highlightId })
              .then(response => {
                  if (response && response.success) {
                      console.log(`Highlight ${highlightId} deleted from storage.`);
                  } else {
                      console.error("Failed to delete highlight from storage:", response?.error);
                      // Maybe try restoring the span visually? Or just log error.
                  }
              }).catch(error => console.error("Error sending deleteHighlight message:", error));
      } else {
           console.warn(`Highlight span with ID ${highlightId} not found for deletion.`);
      }
      hideHighlightMenu(); // Ensure menu is closed after action
  }

  function removeHighlightSpan(span) {
       if (!span || !span.parentNode) return;
       const parent = span.parentNode;
       // Move children out before removing the span
       while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
       }
       parent.removeChild(span);
       parent.normalize(); // Merge adjacent text nodes
  }

  // --- Highlight Menu ---

  function handleHighlightClick(event) {
      event.preventDefault(); // Prevent default link behavior if highlight is inside <a>
      event.stopPropagation(); // Stop event from bubbling up to document listener immediately

      const targetHighlight = event.currentTarget; // The .highlight span
      const highlightId = targetHighlight.dataset.highlightId;

      if (currentHighlightMenu && selectedHighlightId === highlightId) {
          // Clicked the same highlight again, toggle menu off
          hideHighlightMenu();
          return;
      }

      // Hide any existing menu before showing a new one
      hideHighlightMenu();

      selectedHighlightId = highlightId;
      showHighlightMenu(targetHighlight, event.clientX, event.clientY);
       // Add class to visually mark the selected highlight
       targetHighlight.classList.add('selected-highlight');
  }

  function showHighlightMenu(highlightSpan, x, y) {
      const highlightId = highlightSpan.dataset.highlightId;
      const currentNote = highlightSpan.dataset.note || "";
      const currentColorIndex = parseInt(highlightSpan.dataset.colorIndex, 10);

      // Create menu element
      currentHighlightMenu = document.createElement('div');
      currentHighlightMenu.className = 'highlight-menu';
      currentHighlightMenu.style.left = `${x + window.scrollX + 5}px`; // Position near click
      currentHighlightMenu.style.top = `${y + window.scrollY + 5}px`;

      // --- Color Palette Section ---
      const colorSection = document.createElement('div');
      colorSection.className = 'menu-section color-palette';
      userColors.forEach((colorObj, index) => {
          const colorButton = document.createElement('button');
          const rgbaColor = hexToRGBA(colorObj.color, colorObj.opacity);
          colorButton.style.backgroundColor = rgbaColor;
          colorButton.title = `切换到颜色 ${index + 1}`;
          colorButton.dataset.colorIndex = index;
          if (index === currentColorIndex) {
              colorButton.classList.add('current-color');
          }
          colorButton.addEventListener('click', () => {
              changeHighlightColor(highlightId, index);
          });
          colorSection.appendChild(colorButton);
      });
      currentHighlightMenu.appendChild(colorSection);


      // --- Note Section ---
      const noteSection = document.createElement('div');
      noteSection.className = 'menu-section';
      const noteTextarea = document.createElement('textarea');
      noteTextarea.placeholder = "添加笔记...";
      noteTextarea.value = currentNote;
      noteSection.appendChild(noteTextarea);

      const noteActions = document.createElement('div');
      noteActions.className = 'note-actions';
      const saveNoteButton = document.createElement('button');
      saveNoteButton.textContent = "保存笔记";
      saveNoteButton.addEventListener('click', () => {
          saveHighlightNote(highlightId, noteTextarea.value);
      });
      noteActions.appendChild(saveNoteButton);
      noteSection.appendChild(noteActions);
      currentHighlightMenu.appendChild(noteSection);


      // --- Delete Section ---
      const deleteSection = document.createElement('div');
      deleteSection.className = 'menu-section';
      const deleteButton = document.createElement('button');
      deleteButton.textContent = "删除高亮";
      deleteButton.className = 'delete-button';
      deleteButton.addEventListener('click', () => {
          if (confirm("确定要删除这个高亮吗？")) {
               deleteHighlightById(highlightId);
          }
      });
      deleteSection.appendChild(deleteButton);
      currentHighlightMenu.appendChild(deleteSection);

      document.body.appendChild(currentHighlightMenu);

      // Add listener to close menu when clicking outside
      // Use setTimeout to avoid capturing the same click that opened the menu
      setTimeout(() => {
           document.addEventListener('click', handleClickOutsideMenu, true); // Use capture phase
      }, 0);

      // Adjust menu position if it goes off-screen
      adjustMenuPosition(currentHighlightMenu);
  }

   function adjustMenuPosition(menu) {
      const menuRect = menu.getBoundingClientRect();
      const bodyRect = document.body.getBoundingClientRect(); // Or window innerWidth/Height

       let newLeft = menu.offsetLeft; // Current style.left (scroll adjusted)
       let newTop = menu.offsetTop; // Current style.top (scroll adjusted)

      // Check right boundary
      if (menuRect.right > window.innerWidth) {
          newLeft -= (menuRect.right - window.innerWidth + 15); // Move left plus margin
      }
      // Check left boundary (less common)
      if (menuRect.left < 0) {
           newLeft = window.scrollX + 5; // Reset near left edge
      }
       // Check bottom boundary
       if (menuRect.bottom > window.innerHeight) {
           newTop -= (menuRect.bottom - window.innerHeight + 15); // Move up plus margin
       }
       // Check top boundary (less common)
       if (menuRect.top < 0) {
           newTop = window.scrollY + 5; // Reset near top edge
       }

       menu.style.left = `${newLeft}px`;
       menu.style.top = `${newTop}px`;
  }

  function hideHighlightMenu() {
      if (currentHighlightMenu) {
          currentHighlightMenu.remove();
          currentHighlightMenu = null;
           // Remove selected class from the highlight
          if (selectedHighlightId) {
              const span = document.querySelector(`.highlight[data-highlight-id="${selectedHighlightId}"]`);
               if (span) span.classList.remove('selected-highlight');
          }
          selectedHighlightId = null;
          document.removeEventListener('click', handleClickOutsideMenu, true); // Clean up listener
      }
  }

  function handleClickOutsideMenu(event) {
      if (currentHighlightMenu && !currentHighlightMenu.contains(event.target)) {
          // Clicked outside the menu
          hideHighlightMenu();
      }
  }


  function changeHighlightColor(highlightId, newColorIndex) {
      const highlightSpan = document.querySelector(`.highlight[data-highlight-id="${highlightId}"]`);
      if (highlightSpan && userColors[newColorIndex]) {
          highlightSpan.dataset.colorIndex = newColorIndex;
          const colorVar = `--highlight-color-${newColorIndex}`;
          highlightSpan.style.setProperty('--highlight-bg-color', `var(${colorVar})`);

           console.log(`Updating color for ${highlightId} to index ${newColorIndex}`);
          // Update in storage via background
          chrome.runtime.sendMessage({
              action: "updateHighlightColor",
              highlightId: highlightId,
              colorIndex: newColorIndex
          }).then(response => {
               if (!response || !response.success) {
                   console.error("Failed to update highlight color in storage:", response?.error);
                   // Revert visual change? Or show error?
                   alert("保存颜色更改失败。");
               } else {
                   console.log("Highlight color updated in storage.");
                   // Update color button style in menu if still open
                    if (currentHighlightMenu) {
                        const buttons = currentHighlightMenu.querySelectorAll('.color-palette button');
                        buttons.forEach(btn => {
                            btn.classList.remove('current-color');
                            if (parseInt(btn.dataset.colorIndex) === newColorIndex) {
                                btn.classList.add('current-color');
                            }
                        });
                    }
               }
          }).catch(error => console.error("Error sending updateHighlightColor message:", error));

          // Don't hide menu immediately, allow further actions
          // hideHighlightMenu();
      }
  }

  function saveHighlightNote(highlightId, noteText) {
      const highlightSpan = document.querySelector(`.highlight[data-highlight-id="${highlightId}"]`);
      if (highlightSpan) {
          const trimmedNote = noteText.trim();
          highlightSpan.dataset.note = trimmedNote;
          highlightSpan.dataset.hasNote = !!trimmedNote; // Update CSS indicator attribute

          console.log(`Updating note for ${highlightId} to: "${trimmedNote}"`);
          // Update in storage via background
          chrome.runtime.sendMessage({
              action: "updateHighlightNote",
              highlightId: highlightId,
              note: trimmedNote
          }).then(response => {
              if (!response || !response.success) {
                  console.error("Failed to update highlight note in storage:", response?.error);
                  // Revert visual change? Or show error?
                  alert("保存笔记失败。");
              } else {
                   console.log("Highlight note updated in storage.");
                   // Maybe provide visual feedback in the menu?
                   const saveButton = currentHighlightMenu?.querySelector('.note-actions button');
                   if (saveButton) {
                       const originalText = saveButton.textContent;
                       saveButton.textContent = "已保存!";
                       saveButton.disabled = true;
                       setTimeout(() => {
                           saveButton.textContent = originalText;
                           saveButton.disabled = false;
                           hideHighlightMenu(); // Hide menu after successful save & delay
                       }, 1000);
                   } else {
                      hideHighlightMenu(); // Hide menu if button not found
                   }
              }
          }).catch(error => console.error("Error sending updateHighlightNote message:", error));
      }
  }


  // --- CSS & Style Injection ---

  function injectColorVariables(colors) {
      let cssVariables = ':root {\n';
      colors.forEach((colorObj, index) => {
           try {
              const rgbaColor = hexToRGBA(colorObj.color, colorObj.opacity);
              cssVariables += `  --highlight-color-${index}: ${rgbaColor};\n`;
           } catch (e) {
               console.error(`Failed to process color ${index}:`, colorObj, e);
               cssVariables += `  /* --highlight-color-${index}: invalid */\n`;
           }
      });
      cssVariables += '}';

      // Remove existing style tag if present
      const existingStyleTag = document.getElementById('highlighter-color-styles');
      if (existingStyleTag) {
          existingStyleTag.remove();
      }

      // Add new style tag
      const styleTag = document.createElement('style');
      styleTag.id = 'highlighter-color-styles';
      styleTag.textContent = cssVariables;
      (document.head || document.documentElement).appendChild(styleTag);
       console.log("CSS color variables injected.");
  }

  // --- Utility Functions ---

  function hexToRGBA(hex, opacity) {
      // Remove # if present
      hex = hex.startsWith('#') ? hex.slice(1) : hex;
      // Handle shorthand hex (e.g., #03F) -> #0033FF
      if (hex.length === 3) {
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      if (hex.length !== 6) { throw new Error("Invalid HEX color: " + hex); }
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) { throw new Error("Invalid HEX color conversion: " + hex); }
      // Clamp opacity between 0 and 1
      const validOpacity = Math.max(0, Math.min(1, opacity));
      return `rgba(${r}, ${g}, ${b}, ${validOpacity})`;
  }

  function isNodeInsideScriptOrStyle(node) {
      let parent = node.parentElement;
      while (parent) {
          const tagName = parent.tagName.toLowerCase();
          if (tagName === 'script' || tagName === 'style' || tagName === 'noscript' || parent.isContentEditable) {
              return true;
          }
          parent = parent.parentElement;
      }
      return false;
  }

   function isVisible(elem) {
      if (!elem) return false;
      // Check inline style, computed style, and offsetParent
      return !!( elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length ) && window.getComputedStyle(elem).visibility !== 'hidden';
  }

  function isRangeHighlighted(range) {
      // Check if start or end container (or their parents) are already highlights
       let node = range.startContainer;
       while(node && node !== document.body) {
           if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('highlight')) return true;
           node = node.parentNode;
       }
       node = range.endContainer;
        while(node && node !== document.body) {
           if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('highlight')) return true;
           node = node.parentNode;
       }
      // More thorough check: Iterate nodes within the range? Potentially slow.
      // Simple check is usually sufficient for avoiding double-wrapping during restore.
      return false;
  }

  function isRangeSurroundable(range) {
      // Check if the range crosses block element boundaries in a way surroundContents dislikes
      // Basic check: are start and end containers within the same block-level parent?
      try {
          const commonAncestor = range.commonAncestorContainer;
           let startBlock = range.startContainer;
           while (startBlock && startBlock !== commonAncestor && window.getComputedStyle(startBlock).display !== 'block') {
               startBlock = startBlock.parentNode;
           }
           let endBlock = range.endContainer;
            while (endBlock && endBlock !== commonAncestor && window.getComputedStyle(endBlock).display !== 'block') {
               endBlock = endBlock.parentNode;
           }
           // If they don't share the *immediate* block parent within the ancestor, it might fail.
           // This is a heuristic and might not be perfectly accurate.
           return startBlock === endBlock || !startBlock || !endBlock; // Allow if one isn't found or they are the same
       } catch(e) {
           console.warn("Error checking if range is surroundable:", e);
           return false; // Assume not surroundable on error
       }
  }


  // --- Event Listeners Setup ---

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("Content script received message:", request.action);
      if (request.action === "commandHighlight") {
          applyHighlight(request.colorIndex);
          sendResponse({ success: true });
      } else if (request.action === "requestRestoration") {
          // Re-initialize or just restore if already initialized?
          // If colors changed, we need to re-inject vars anyway.
           initializeHighlighter().then(() => sendResponse({success: true}))
                                 .catch(e => sendResponse({success: false, error: e.message}));
           return true; // Indicate async response
      } else if (request.action === "applyColorUpdate") {
           console.log("Applying color update from options change.");
           userColors = request.colors;
           injectColorVariables(userColors);
           // Update existing highlight spans' styles (if color index changed meaning)
           document.querySelectorAll('.highlight').forEach(span => {
                const index = parseInt(span.dataset.colorIndex, 10);
                if (!isNaN(index) && index < userColors.length) {
                    const colorVar = `--highlight-color-${index}`;
                    span.style.setProperty('--highlight-bg-color', `var(${colorVar})`);
                } else {
                    // Handle cases where color index is now invalid (e.g., user deleted colors)
                    span.style.setProperty('--highlight-bg-color', 'rgba(128,128,128,0.3)'); // Fallback grey
                }
           });
           sendResponse({success: true});
      }
      // Add other message handlers if needed
  });

  // --- Start Initialization ---
  // Use a small delay or wait for document idle/complete if run_at isn't sufficient
   if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeHighlighter);
   } else {
      initializeHighlighter(); // DOM already loaded
   }

} else {
  console.log("Highlighter Content Script already loaded, skipping re-execution.");
  // If the script is already loaded, maybe just re-run initialization on message?
  // The message listener should still be active from the first load.
}