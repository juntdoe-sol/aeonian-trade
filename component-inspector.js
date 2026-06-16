// Component Inspector for Poof
// This script enables inspection of React components and sends data to parent iframe
(function () {
  // Only run if not in LIVE/production environment
  // Allow PREVIEW and development environments
  if (typeof window !== 'undefined' && window.__VITE_ENV__ === 'LIVE') {
    return; // Silent exit on LIVE
  }


  let inspectorEnabled = false;
  let highlightOverlay = null;
  let componentOverlay = null;
  let currentHighlightedElement = null;

  // Create the inspector overlay (semi-transparent overlay when active)
  function createOverlay() {
    if (componentOverlay) {
      return;
    }


    componentOverlay = document.createElement('div');
    componentOverlay.id = 'poof-component-inspector-overlay';
    componentOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.05);
      z-index: 999998;
      cursor: crosshair;
      display: none;
    `;
    document.body.appendChild(componentOverlay);

    // Create highlight overlay for hover effect
    highlightOverlay = document.createElement('div');
    highlightOverlay.id = 'poof-component-highlight';
    highlightOverlay.style.cssText = `
      position: fixed;
      border: 2px solid #3b82f6;
      background: rgba(59, 130, 246, 0.1);
      pointer-events: none;
      z-index: 999999;
      display: none;
      box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
      transition: all 0.1s ease;
    `;
    document.body.appendChild(highlightOverlay);


    // Add event listeners
    componentOverlay.addEventListener('mousemove', handleMouseMove);
    componentOverlay.addEventListener('click', handleClick);
    componentOverlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      disableInspector();
    });

    // Add escape key handler
    document.addEventListener('keydown', handleKeyDown);

  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && inspectorEnabled) {
      // Only disable inspector if modal is not open
      const modal = document.getElementById('poof-component-note-modal');
      if (!modal) {
        disableInspector();
      }
    }
  }

  function handleMouseMove(e) {
    if (!inspectorEnabled) {
      return;
    }

    // Temporarily hide overlay to get element below
    componentOverlay.style.display = 'none';
    const element = document.elementFromPoint(e.clientX, e.clientY);
    componentOverlay.style.display = 'block';

    if (!element || element === componentOverlay || element === highlightOverlay) {
      if (highlightOverlay) {
        highlightOverlay.style.display = 'none';
      }
      return;
    }

    currentHighlightedElement = element;
    updateHighlight(element);
  }

  function updateHighlight(element) {
    if (!highlightOverlay) {
      return;
    }

    const rect = element.getBoundingClientRect();

    // Use fixed positioning (same as overlay) to avoid scroll issues
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.top = `${rect.top}px`;
    highlightOverlay.style.left = `${rect.left}px`;
    highlightOverlay.style.width = `${rect.width}px`;
    highlightOverlay.style.height = `${rect.height}px`;
  }

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!currentHighlightedElement) {
      return;
    }


    // Extract component information
    const componentInfo = extractComponentInfo(currentHighlightedElement);


    // Show modal for user to add a note
    showNoteModal(e.clientX, e.clientY, componentInfo);

    // Temporarily hide the overlay while modal is open, but keep inspector enabled
    if (componentOverlay) {
      componentOverlay.style.display = 'none';
    }
  }

  // Extract React fiber and component information from DOM element
  function extractComponentInfo(element) {
    const info = {
      tagName: element.tagName.toLowerCase(),
      className: element.className,
      id: element.id,
      textContent: element.textContent?.substring(0, 200) || '',
      attributes: {},
      reactComponent: null,
      componentName: null,
      props: null,
      filePath: null,
      outerHTML: element.outerHTML?.substring(0, 500) || '',
    };

    // Get all attributes
    Array.from(element.attributes).forEach(attr => {
      if (!attr.name.startsWith('__react')) {
        info.attributes[attr.name] = attr.value;
      }
    });

    // Try to find React fiber
    const fiber = findReactFiber(element);
    if (fiber) {
      info.reactComponent = getFiberInfo(fiber);
      info.componentName = getComponentName(fiber);
      info.props = getComponentProps(fiber);
      info.filePath = getComponentFilePath(fiber);
    }

    return info;
  }

  // Find React fiber node from DOM element
  function findReactFiber(element) {
    // Try multiple approaches to find React fiber
    const fiberKey = Object.keys(element).find(key =>
      key.startsWith('__reactFiber') ||
      key.startsWith('__reactInternalInstance')
    );

    if (fiberKey) {
      return element[fiberKey];
    }

    // Alternative approach: walk up the tree
    let node = element;
    while (node) {
      const fiberKey = Object.keys(node).find(key =>
        key.startsWith('__reactFiber') ||
        key.startsWith('__reactInternalInstance')
      );
      if (fiberKey) return node[fiberKey];
      node = node.parentElement;
    }

    return null;
  }

  function getFiberInfo(fiber) {
    if (!fiber) return null;

    return {
      type: fiber.type?.name || fiber.type?.displayName || typeof fiber.type,
      key: fiber.key,
      mode: fiber.mode,
      tag: fiber.tag,
    };
  }

  function getComponentName(fiber) {
    if (!fiber) return null;

    let current = fiber;
    while (current) {
      // Look for function/class component
      if (current.type) {
        if (typeof current.type === 'function') {
          return current.type.name || current.type.displayName || 'Anonymous';
        }
        if (typeof current.type === 'string') {
          // Native HTML element, keep looking up
          current = current.return;
          continue;
        }
      }
      current = current.return;
    }

    return null;
  }

  function getComponentProps(fiber) {
    if (!fiber) return null;

    let current = fiber;
    while (current) {
      if (current.memoizedProps && typeof current.type === 'function') {
        // Found a component with props
        return sanitizeProps(current.memoizedProps);
      }
      current = current.return;
    }

    return null;
  }

  function sanitizeProps(props) {
    if (!props) return null;

    try {
      // Create a sanitized copy of props, excluding functions and complex objects
      const sanitized = {};
      Object.keys(props).forEach(key => {
        const value = props[key];
        const type = typeof value;

        if (type === 'string' || type === 'number' || type === 'boolean') {
          sanitized[key] = value;
        } else if (type === 'object' && value !== null) {
          if (Array.isArray(value)) {
            sanitized[key] = `[Array(${value.length})]`;
          } else {
            sanitized[key] = '[Object]';
          }
        } else if (type === 'function') {
          sanitized[key] = '[Function]';
        }
      });
      return sanitized;
    } catch (e) {
      return { error: 'Failed to extract props' };
    }
  }

  function getComponentFilePath(fiber) {
    if (!fiber) return null;

    // Try to extract file path from _debugSource or _debugOwner
    let current = fiber;
    while (current) {
      if (current._debugSource) {
        const source = current._debugSource;
        return `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
      }
      current = current.return;
    }

    return null;
  }

  function sendComponentToParent(componentInfo, note, action) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'POOF_COMPONENT_GRAB',
            data: componentInfo,
            note: note || '',
            action: action || 'add', // 'add' or 'send'
            timestamp: Date.now(),
          },
          '*'
        );
      }
    } catch (e) {
    }
  }

  // Show modal for adding notes to component inspection
  function showNoteModal(clickX, clickY, componentInfo) {
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'poof-component-note-modal';

    // Position modal near click, but ensure it's visible and responsive
    const maxModalWidth = 400;
    const modalHeight = 120;
    const padding = 20;

    // Calculate available width (account for padding on both sides)
    const availableWidth = window.innerWidth - (padding * 2);
    const modalWidth = Math.min(maxModalWidth, availableWidth);

    let left = clickX + 10;
    let top = clickY + 10;

    // Adjust if modal would go off-screen
    if (left + modalWidth > window.innerWidth - padding) {
      left = window.innerWidth - modalWidth - padding;
    }
    if (top + modalHeight > window.innerHeight - padding) {
      top = window.innerHeight - modalHeight - padding;
    }
    if (left < padding) left = padding;
    if (top < padding) top = padding;

    modal.style.cssText = `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      width: ${modalWidth}px;
      background: white;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      z-index: 1000000;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    `;

    // Add header
    const header = document.createElement('div');
    header.style.cssText = `
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    `;
    header.textContent = 'What would you like to do with this component?';
    modal.appendChild(header);

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Describe the change you want to make...';
    textarea.style.cssText = `
      width: 100%;
      height: 80px;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      color:black;
    `;
    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = '#3b82f6';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = '#d1d5db';
    });
    modal.appendChild(textarea);

    // Add keyboard hint
    const keyboardHint = document.createElement('div');
    keyboardHint.style.cssText = `
      font-size: 10px;
      color: #9ca3af;
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    keyboardHint.innerHTML = `
      <span>Press <kbd style="padding: 2px 4px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 3px; font-size: 10px;">Enter</kbd> to add, <kbd style="padding: 2px 4px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 3px; font-size: 10px;">⌘/Ctrl+Enter</kbd> to send now</span>
      <span style="color: #3b82f6; cursor: pointer; font-weight: 500;" id="poof-modal-cancel">Cancel (Esc)</span>
    `;
    modal.appendChild(keyboardHint);

    document.body.appendChild(modal);

    // Auto-focus the textarea
    textarea.focus();

    // Handle keyboard events
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl+Enter: Send immediately
          e.preventDefault();
          const note = textarea.value.trim();
          sendComponentToParent(componentInfo, note, 'send');
          closeModal();
        } else {
          // Enter: Add to chat
          e.preventDefault();
          const note = textarea.value.trim();
          sendComponentToParent(componentInfo, note, 'add');
          closeModal();
        }
      } else if (e.key === 'Escape') {
        // Cancel
        e.preventDefault();
        closeModal();
      }
    };

    textarea.addEventListener('keydown', handleKeyDown);

    // Handle cancel button
    document.getElementById('poof-modal-cancel').addEventListener('click', closeModal);

    function closeModal() {
      if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
      // Hide highlight overlay
      if (highlightOverlay) {
        highlightOverlay.style.display = 'none';
      }
      currentHighlightedElement = null;

      // Re-enable inspector overlay if inspector is still enabled
      if (inspectorEnabled && componentOverlay) {
        componentOverlay.style.display = 'block';
      }
    }
  }

  function enableInspector() {
    createOverlay();
    inspectorEnabled = true;

    if (componentOverlay) {
      componentOverlay.style.display = 'block';
    } else {
      return;
    }

  }

  function disableInspector() {
    inspectorEnabled = false;
    if (componentOverlay) {
      componentOverlay.style.display = 'none';
    }
    if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
    currentHighlightedElement = null;

    // Notify parent that inspector was disabled
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'POOF_INSPECTOR_DISABLED',
            timestamp: Date.now(),
          },
          '*'
        );
      }
    } catch (e) {
    }

  }

  function toggleInspector() {
    if (inspectorEnabled) {
      disableInspector();
    } else {
      enableInspector();
    }
  }

  // --- Screenshot capture (requested by the Poof parent frame) ---
  // Origin allowlist mirrors PRODUCTION_ORIGINS in poof's src/lib/csrf.ts.
  const POOF_PARENT_ORIGINS = [
    'https://poof.new',
    'https://staging.poof.new',
    'https://v2.poof.new',
    'https://v2-staging.poof.new',
    'https://tester.poof.new',
  ];

  function isAllowedParentOrigin(origin) {
    if (POOF_PARENT_ORIGINS.indexOf(origin) !== -1) return true;
    try {
      const url = new URL(origin);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch (e) {
      return false;
    }
  }

  // Lazy-load the vendored capture library (modern-screenshot UMD bundle) so
  // page loads never pay for it; only the first capture request does.
  let screenshotLibPromise = null;
  function loadScreenshotLib() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (!screenshotLibPromise) {
      screenshotLibPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/poof-screenshot.js';
        script.onload = () => {
          if (window.modernScreenshot) {
            resolve(window.modernScreenshot);
          } else {
            reject(new Error('Screenshot library failed to initialize'));
          }
        };
        script.onerror = () => {
          screenshotLibPromise = null;
          reject(new Error('Failed to load /poof-screenshot.js'));
        };
        document.head.appendChild(script);
      });
    }
    return screenshotLibPromise;
  }

  function handleScreenshotRequest(event) {
    const requestId = event.data.requestId;
    const replyTo = event.origin;
    loadScreenshotLib()
      .then((lib) => lib.domToDataUrl(document.documentElement, { type: 'image/png' }))
      .then((dataUrl) => {
        event.source.postMessage(
          { type: 'POOF_SCREENSHOT_RESULT', requestId, dataUrl },
          replyTo
        );
      })
      .catch((error) => {
        try {
          event.source.postMessage(
            {
              type: 'POOF_SCREENSHOT_ERROR',
              requestId,
              error: String(error && error.message ? error.message : error),
            },
            replyTo
          );
        } catch (e) {
          // Ignore reply failures
        }
      });
  }

  // Listen for messages from parent to enable/disable inspector
  window.addEventListener('message', (event) => {

    if (event.data && event.data.type === 'POOF_TOGGLE_INSPECTOR') {
      const shouldEnable = event.data.enabled;

      if (shouldEnable) {
        enableInspector();
      } else {
        disableInspector();
      }
    }

    if (event.data && event.data.type === 'POOF_TAKE_SCREENSHOT') {
      // A screenshot can contain user data — only honor requests coming from
      // the embedding Poof frame, and reply to that exact origin (never '*').
      if (event.source !== window.parent || window.parent === window) return;
      if (!isAllowedParentOrigin(event.origin)) return;
      handleScreenshotRequest(event);
    }
  });

  // Expose global function for debugging
  window.__poofComponentInspector = {
    enable: enableInspector,
    disable: disableInspector,
    toggle: toggleInspector,
    isEnabled: () => inspectorEnabled,
  };

})();
