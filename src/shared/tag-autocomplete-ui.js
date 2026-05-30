// MoxTags — shared DOM controller for tag-name autocomplete inputs.

import { filterAndSortTags, parseInput, renderCount, highlightTag } from './autocomplete.js';

export function createTagAutocomplete({
  findInputs,
  label = 'tag search input',
  log = () => {},
  warn = () => {},
  sendMessage = defaultSendMessage,
  dispatchChangeOnSelect = false,
  stopHandledKeyPropagation = false,
  selectOnEnter = false,
  observeMutations = true,
} = {}) {
  const attachedInputs = new Set();

  let activeInput = null;
  let dropdown = null;
  let items = [];
  let highlightIdx = -1;
  let filteredTags = [];
  let currentPrefix = '';
  let currentPartial = '';
  let wordStart = 0;
  let oracleTagNames = null;
  let artTagNames = null;
  let tagNamesPromise = null;
  let observer = null;
  let blurTimer = null;
  let scanScheduled = false;

  function setup() {
    scan();
    if (!observeMutations) return;
    if (observer) return;

    const root = document.body || document.documentElement;
    if (!root) return;

    observer = new MutationObserver(onMutations);
    observer.observe(root, { childList: true, subtree: true });
  }

  function detach() {
    for (const input of attachedInputs) {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeydown, true);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('focus', onFocus);
    }
    attachedInputs.clear();
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    closeDropdown();
    activeInput = null;
  }

  function scan() {
    let inputs = [];
    try {
      inputs = normalizeInputs(findInputs?.() || []);
    } catch (err) {
      warn('Autocomplete input scan failed:', err.message);
      return;
    }

    for (const input of inputs) {
      attach(input);
    }

    if (activeInput && !document.contains(activeInput)) {
      closeDropdown();
      activeInput = null;
    }
  }

  function normalizeInputs(inputLike) {
    const values = typeof inputLike[Symbol.iterator] === 'function'
      ? [...inputLike]
      : [inputLike];
    const seen = new Set();
    const inputs = [];
    for (const input of values) {
      if (!isTextInput(input) || seen.has(input)) continue;
      seen.add(input);
      inputs.push(input);
    }
    return inputs;
  }

  function isTextInput(input) {
    return input
      && typeof input.addEventListener === 'function'
      && typeof input.value === 'string'
      && typeof input.setSelectionRange === 'function';
  }

  function attach(input) {
    if (attachedInputs.has(input)) return;
    attachedInputs.add(input);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown, true);
    input.addEventListener('blur', onBlur);
    input.addEventListener('focus', onFocus);
    log('Autocomplete attached to', label);
  }

  function onMutations(mutations) {
    if (mutations.every(isOwnDropdownMutation)) return;
    scheduleScan();
  }

  function isOwnDropdownMutation(mutation) {
    if (!dropdown) return false;
    if (mutation.target === dropdown || dropdown.contains(mutation.target)) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(isMoxTagsNode);
  }

  function isMoxTagsNode(node) {
    return node instanceof Element
      && (node.classList.contains('moxtags-autocomplete') || node.closest?.('.moxtags-autocomplete'));
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  function onFocus(event) {
    activeInput = event.currentTarget;
    onInput(event);
  }

  function onInput(event) {
    const input = event?.currentTarget || activeInput;
    if (!input) return;
    activeInput = input;

    const val = input.value;
    const cursor = input.selectionStart ?? val.length;
    const parsed = parseInput(val, cursor);
    if (!parsed || !parsed.partial) {
      closeDropdown();
      return;
    }

    currentPrefix = parsed.prefix;
    wordStart = parsed.wordStart;

    const list = parsed.isOracle ? oracleTagNames : artTagNames;
    if (list) {
      showFilteredTags(list, parsed.partial);
      return;
    }

    fetchTagNames().then(() => {
      if (activeInput !== input) return;
      const currentValue = input.value;
      const currentCursor = input.selectionStart ?? currentValue.length;
      const currentParsed = parseInput(currentValue, currentCursor);
      if (!currentParsed || !currentParsed.partial) {
        closeDropdown();
        return;
      }

      currentPrefix = currentParsed.prefix;
      wordStart = currentParsed.wordStart;
      const currentList = currentParsed.isOracle ? oracleTagNames : artTagNames;
      if (currentList) showFilteredTags(currentList, currentParsed.partial);
    });
  }

  function fetchTagNames() {
    if (tagNamesPromise) return tagNamesPromise;
    tagNamesPromise = new Promise((resolve) => {
      sendMessage({ type: 'getTagNames' }, (resp) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) {
          warn('getTagNames failed:', runtimeError.message);
          tagNamesPromise = null;
          resolve();
          return;
        }
        if (resp?.ok) {
          oracleTagNames = resp.oracleTagNames || [];
          artTagNames = resp.artTagNames || [];
          log('Tag names loaded:', oracleTagNames.length, 'oracle,', artTagNames.length, 'art');
        } else if (resp?.error) {
          warn('getTagNames failed:', resp.error);
          tagNamesPromise = null;
        } else {
          tagNamesPromise = null;
        }
        resolve();
      });
    });
    return tagNamesPromise;
  }

  function showFilteredTags(tagList, partial) {
    filteredTags = filterAndSortTags(tagList, partial);
    currentPartial = partial.toLowerCase();

    if (filteredTags.length === 0) {
      closeDropdown();
      return;
    }

    renderDropdown();
  }

  function renderDropdown() {
    if (!activeInput) return;

    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'moxtags-autocomplete';
      dropdown.addEventListener('mousedown', (event) => event.preventDefault());
      document.body.appendChild(dropdown);
      window.addEventListener('resize', positionDropdown, { passive: true });
      window.addEventListener('scroll', positionDropdown, { capture: true, passive: true });
    }

    positionDropdown();

    const count = renderCount(filteredTags.length, currentPartial.length);
    dropdown.innerHTML = '';
    items = [];
    highlightIdx = 0;

    for (let i = 0; i < count; i++) {
      const tag = filteredTags[i];
      const item = document.createElement('div');
      item.className = 'moxtags-autocomplete-item';
      item.appendChild(buildHighlightedTag(tag, currentPartial));
      item.dataset.index = String(i);
      item.addEventListener('click', () => selectItem(i));
      item.addEventListener('mouseenter', () => highlightItem(i));
      dropdown.appendChild(item);
      items.push(item);
    }

    highlightItem(0);
    dropdown.style.display = '';
  }

  function positionDropdown() {
    if (!dropdown || !activeInput) return;
    if (!document.contains(activeInput)) {
      closeDropdown();
      return;
    }

    const rect = activeInput.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 2}px`;
    dropdown.style.minWidth = `${rect.width}px`;
  }

  function buildHighlightedTag(tag, partial) {
    const segments = highlightTag(tag, partial);
    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (seg.bold) {
        const b = document.createElement('b');
        b.textContent = seg.text;
        frag.appendChild(b);
      } else {
        frag.appendChild(document.createTextNode(seg.text));
      }
    }
    return frag;
  }

  function highlightItem(idx) {
    if (idx < 0 || idx >= items.length) return;
    if (highlightIdx >= 0 && highlightIdx < items.length) {
      items[highlightIdx].classList.remove('highlighted');
    }
    highlightIdx = idx;
    items[idx].classList.add('highlighted');
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  function selectItem(idx) {
    if (idx < 0 || idx >= filteredTags.length || !activeInput) return;

    const tag = filteredTags[idx];
    const val = activeInput.value;
    const cursor = activeInput.selectionStart ?? val.length;
    const before = val.substring(0, wordStart);
    const after = val.substring(cursor);
    const insertion = `${currentPrefix}${tag} `;
    setNativeInputValue(activeInput, before + insertion + after);

    const newCursor = wordStart + insertion.length;
    activeInput.setSelectionRange(newCursor, newCursor);
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (dispatchChangeOnSelect) {
      activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    closeDropdown();
    activeInput.focus();
  }

  function closeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
      window.removeEventListener('resize', positionDropdown);
      window.removeEventListener('scroll', positionDropdown, true);
    }
    items = [];
    highlightIdx = -1;
    filteredTags = [];
  }

  function onKeydown(event) {
    if (!dropdown || items.length === 0) return;

    if (event.key === 'ArrowDown') {
      handleAutocompleteKey(event);
      highlightItem((highlightIdx + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      handleAutocompleteKey(event);
      highlightItem((highlightIdx - 1 + items.length) % items.length);
    } else if (event.key === 'Tab') {
      handleAutocompleteKey(event);
      selectItem(highlightIdx);
    } else if (selectOnEnter && event.key === 'Enter') {
      handleAutocompleteKey(event);
      selectItem(highlightIdx);
    } else if (event.key === 'Escape') {
      handleAutocompleteKey(event);
      closeDropdown();
    }
  }

  function handleAutocompleteKey(event) {
    event.preventDefault();
    if (stopHandledKeyPropagation) {
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  }

  function onBlur() {
    blurTimer = setTimeout(() => {
      closeDropdown();
    }, 200);
  }

  return { setup, scan, detach };
}

function defaultSendMessage(message, callback) {
  chrome.runtime.sendMessage(message, callback);
}

function setNativeInputValue(input, value) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}
