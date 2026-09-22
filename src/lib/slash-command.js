import debounce from 'debounce-fn';
import Masonry from 'masonry-layout';
import { insert } from 'text-field-edit';
import LoadingIndicator from '../components/loading-indicator.js';
import { getSetting } from './settings.js';

const SLASH_GIF_RE = /(?:^|\n)(\/gif(?:\s([^\n]*))?)$/;

const COMMENT_CONTAINERS = [
  'form',
  '.js-previewable-comment-form',
  '[role="form"]',
  '[data-testid="comment-composer"]',
  '[data-testid="markdown-editor-comment-composer"]',
  '[class*="MarkdownEditor-module"]',
  '[class*="ReviewMenuButton-module"]',
].join(', ');

let popup;
let activeElement;
let activeMatch;
let provider;

function isCommentField(element) {
  return Boolean(element.closest(COMMENT_CONTAINERS));
}

function createPopup() {
  const element = (
    <div class="ghg-slash-popup">
      <div class="ghg-slash-popup-header">
        <span class="ghg-slash-popup-title">Trending GIFs</span>
      </div>
      <div class="ghg-slash-popup-results" />
    </div>
  );
  document.body.append(element);
  return element;
}

function getPopup() {
  if (!popup) {
    popup = createPopup();
  }

  return popup;
}

function positionPopup(element) {
  const popupElement = getPopup();
  const rect = element.getBoundingClientRect();
  const POPUP_HEIGHT = 360;

  popupElement.style.left = `${rect.left}px`;
  popupElement.style.width = `${Math.min(rect.width, 480)}px`;

  if (rect.top > POPUP_HEIGHT + 16) {
    popupElement.style.top = 'auto';
    popupElement.style.bottom =
      `${globalThis.innerHeight - rect.top + 8}px`;
  } else {
    popupElement.style.bottom = 'auto';
    popupElement.style.top = `${rect.bottom + 8}px`;
  }
}

async function loadGifs(query) {
  const container = getPopup().querySelector('.ghg-slash-popup-results');
  container.innerHTML = '';
  container.append(LoadingIndicator.cloneNode(true));

  try {
    const gifs = await (query ?
        provider.search(query) :
        provider.getTrending());

    container.innerHTML = '';

    if (gifs && gifs.length > 0) {
      renderGifs(container, gifs);
    } else {
      container.append(
        <div class="ghg-no-results-found">No GIFs found.</div>,
      );
    }
  } catch {
    container.innerHTML =
      '<div class="ghg-no-results-found">Error loading GIFs.</div>';
  }
}

function renderGifs(container, gifs) {
  const MAX_WIDTH = 145;

  for (const gif of gifs) {
    const { previewUrl, previewWidth, previewHeight, fullSizeUrl } =
      provider.getGifUrls(gif);
    const height = Math.floor((previewHeight * MAX_WIDTH) / previewWidth);
    const hsl = `hsl(${360 * Math.random()}, ${
      25 + 70 * Math.random()
    }%, ${85 + 10 * Math.random()}%)`;

    const element = (
      <div style={{ width: `${MAX_WIDTH}px` }}>
        <img
          src={previewUrl}
          height={height}
          style={{ 'background-color': hsl }}
          class="ghg-gif-selection"
          data-full-size-url={fullSizeUrl}
        />
      </div>
    );

    element.querySelector('img').addEventListener('click', () => {
      handleGifSelect(fullSizeUrl);
    });

    container.append(element);
  }

  setTimeout(() => {
    try {
      // eslint-disable-next-line no-new
      new Masonry(container, {
        itemSelector: '.ghg-slash-popup-results div',
        columnWidth: MAX_WIDTH,
        gutter: 10,
        transitionDuration: '0.2s',
      });
    } catch {
      // non-critical
    }
  }, 10);
}

async function handleGifSelect(gifUrl) {
  if (!activeElement || !activeMatch) {
    return;
  }

  const { start, end, query } = activeMatch;
  const useCollapsible = await getSetting('useCollapsibleGifs');

  let replacement;
  if (useCollapsible) {
    const summary = query || 'GIF';
    replacement = `<details open>\n  <summary><i>${summary}</i></summary>\n  <img src="${gifUrl}"/>\n</details>`;
  } else {
    replacement = `<img src="${gifUrl}"/>`;
  }

  const element = activeElement;
  element.focus();

  if (element.tagName === 'TEXTAREA') {
    element.setSelectionRange(start, end);
    insert(element, replacement);
  } else if (activeMatch.node) {
    const sel = globalThis.getSelection();
    const range = document.createRange();
    range.setStart(activeMatch.node, start);
    range.setEnd(activeMatch.node, end);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, replacement);
  }

  hide();
}

function show(element, query) {
  const popupElement = getPopup();
  positionPopup(element);
  popupElement.style.display = 'block';

  const title = popupElement.querySelector('.ghg-slash-popup-title');
  title.textContent = query ? `Search: ${query}` : 'Trending GIFs';

  loadGifs(query);
}

function hide() {
  if (popup) {
    popup.style.display = 'none';
  }

  activeElement = undefined;
  activeMatch = undefined;
}

function isVisible() {
  return popup && popup.style.display !== 'none';
}

function detectSlashGif(element) {
  if (element.tagName === 'TEXTAREA') {
    const value = element.value;
    const cursor = element.selectionStart;
    const textUpToCursor = value.slice(0, cursor);
    const match = textUpToCursor.match(SLASH_GIF_RE);
    if (!match) {
      return;
    }

    const fullMatch = match[1];
    const query = (match[2] || '').trim();
    return { start: cursor - fullMatch.length, end: cursor, query };
  }

  // contenteditable
  const sel = globalThis.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) {
    return;
  }

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const text = node.textContent;
  const offset = range.startOffset;
  const match = text.slice(0, offset).match(SLASH_GIF_RE);
  if (!match) {
    return;
  }

  const fullMatch = match[1];
  const query = (match[2] || '').trim();
  return { start: offset - fullMatch.length, end: offset, query, node };
}

const debouncedLoadGifs = debounce(
  (query) => {
    const title = getPopup().querySelector('.ghg-slash-popup-title');
    title.textContent = query ? `Search: ${query}` : 'Trending GIFs';
    loadGifs(query);
  },
  { wait: 400 },
);

function handleInput(event) {
  const element = event.target;

  const isTextarea = element.tagName === 'TEXTAREA';
  const isEditable =
    element.getAttribute('role') === 'textbox' || element.isContentEditable;

  if (!isTextarea && !isEditable) {
    return;
  }

  if (!isCommentField(element)) {
    return;
  }

  const match = detectSlashGif(element);

  if (match) {
    if (activeElement !== element) {
      activeElement = element;
      activeMatch = match;
      show(element, match.query);
    } else if (!activeMatch || activeMatch.query !== match.query) {
      activeMatch = match;
      debouncedLoadGifs(match.query);
    } else {
      activeMatch = match;
    }
  } else if (activeElement === element) {
    hide();
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape' && isVisible()) {
    hide();
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleClickOutside(event) {
  if (isVisible() && popup && !popup.contains(event.target)) {
    hide();
  }
}

export function initSlashCommand(gifProvider) {
  provider = gifProvider;
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('mousedown', handleClickOutside, true);
}
