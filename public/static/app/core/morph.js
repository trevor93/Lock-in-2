/* WAR ROOM — morph.js (Book 6)
 *
 * A small, self-contained DOM morph. The app used to rebuild the whole tab with
 * `el.innerHTML = html` on every render, which destroyed focus, cursor position,
 * and any half-typed text — the worst failure mode a journalling app can have.
 *
 * morphInto(container, html) reconciles the container's existing children toward
 * the new HTML in place: unchanged nodes are kept, attributes are patched, and
 * the focused control keeps its focus, selection, and live value. No dependency,
 * no CDN — it is cached by the service worker like every other asset.
 *
 * Keying: an element with an `id` is matched to the old element with the same
 * `id` anywhere among the siblings, so lists can reorder without being rebuilt.
 * Elements without an id are matched by tag name and position.
 */
// (module scope replaces the former IIFE wrapper)
  'use strict';

  var FORM_TAGS = { INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1 };

  function isElement(n) { return n && n.nodeType === 1; }
  function isText(n) { return n && (n.nodeType === 3 || n.nodeType === 8); }

  function keyOf(n) {
    return isElement(n) && n.id ? n.id : null;
  }

  // Two nodes are morphable into each other (rather than replaced outright).
  function compatible(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (isElement(a)) return a.tagName === b.tagName && keyOf(a) === keyOf(b);
    return true; // text / comment
  }

  function morphAttributes(from, to) {
    var toAttrs = to.attributes;
    for (var i = 0; i < toAttrs.length; i++) {
      var a = toAttrs[i];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
    // Remove attributes no longer present.
    var fromAttrs = from.attributes;
    for (var j = fromAttrs.length - 1; j >= 0; j--) {
      var name = fromAttrs[j].name;
      if (!to.hasAttribute(name)) from.removeAttribute(name);
    }
  }

  // Preserve the live state of a form control the user is interacting with. The
  // rendered HTML reflects server state; the control in hand reflects the user's
  // unsaved intent, which must win until they submit.
  function preserveFormState(from, to, active) {
    var tag = from.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      // Only keep the live value for the control the user is actually editing.
      if (from === active) {
        // do not let the morph overwrite what they are typing
        return true;
      }
      // For non-focused controls, adopt the new value if the template set one.
      if (tag === 'INPUT' && to.hasAttribute('value')) {
        if (from.value !== to.getAttribute('value')) from.value = to.getAttribute('value');
      }
      if (tag === 'INPUT' && (from.type === 'checkbox' || from.type === 'radio')) {
        from.checked = to.hasAttribute('checked');
      }
    }
    return false;
  }

  function morphNode(from, to, active) {
    if (isText(from)) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return from;
    }
    if (isElement(from)) {
      morphAttributes(from, to);
      var skipChildren = preserveFormState(from, to, active);
      // A focused textarea keeps its own children (its text) untouched.
      if (from.tagName === 'TEXTAREA' && from === active) skipChildren = true;
      if (!skipChildren) morphChildren(from, to, active);
    }
    return from;
  }

  function morphChildren(fromEl, toEl, active) {
    // Index existing keyed children so a reorder reuses nodes instead of
    // rebuilding them (and losing focus inside them).
    var keyed = {};
    var n;
    for (n = fromEl.firstChild; n; n = n.nextSibling) {
      var k = keyOf(n);
      if (k) keyed[k] = n;
    }

    var curFrom = fromEl.firstChild;
    var curTo = toEl.firstChild;

    while (curTo) {
      var nextTo = curTo.nextSibling;
      var toKey = keyOf(curTo);
      var matched = null;

      if (toKey && keyed[toKey]) {
        // Reuse the keyed node, moving it into position.
        matched = keyed[toKey];
        if (matched !== curFrom) fromEl.insertBefore(matched, curFrom);
        morphNode(matched, curTo, active);
        curFrom = matched.nextSibling;
        delete keyed[toKey];
      } else if (curFrom && !keyOf(curFrom) && !toKey && compatible(curFrom, curTo)) {
        // Positional match for unkeyed nodes.
        morphNode(curFrom, curTo, active);
        curFrom = curFrom.nextSibling;
      } else {
        // No reuse: insert a fresh clone before the current cursor.
        var clone = curTo.cloneNode(true);
        fromEl.insertBefore(clone, curFrom || null);
      }
      curTo = nextTo;
    }

    // Remove any leftover old children not consumed above — but never yank the
    // node the user is focused inside; keep it so their work survives.
    n = curFrom;
    while (n) {
      var next = n.nextSibling;
      if (!(active && n.nodeType === 1 && n.contains(active))) {
        fromEl.removeChild(n);
      }
      n = next;
    }
  }

  function morphInto(container, html) {
    var doc = container.ownerDocument || document;
    var tmp = doc.createElement(container.tagName || 'DIV');
    tmp.innerHTML = html;

    var active = doc.activeElement;
    // Capture selection of the focused text control so the caret survives.
    var selStart = null, selEnd = null, activeIsText = false;
    if (active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email|number)$/i.test(active.type || 'text')))) {
      activeIsText = true;
      try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) {}
    }

    morphChildren(container, tmp, active);

    // Restore focus + caret if the focused node still lives in the tree.
    if (active && doc.contains(active) && active !== doc.body) {
      if (doc.activeElement !== active && typeof active.focus === 'function') {
        active.focus();
      }
      if (activeIsText && selStart !== null) {
        try { active.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }

export { morphInto }
