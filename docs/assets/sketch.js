/*
 * Nagellacke — sketch.js
 * Reines ES2020, kein Framework, kein Build. Alles defensiv: fehlt ein
 * Element im DOM, wird die jeweilige Funktion einfach übersprungen, nichts
 * wirft einen Fehler.
 */
(function () {
  'use strict';

  var HEX_RE = /^#[0-9a-f]{6}$/i;

  var reduceMotion = false;
  try {
    reduceMotion =
      !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    reduceMotion = false;
  }

  // ---------------------------------------------------------------------
  // Mood copy per palette color, keyed by hex (lowercase). One warm German
  // sentence each, plus a generic one for custom-mixed colors.
  // ---------------------------------------------------------------------
  var MOODS = {
    '#b3122e': 'Mutig und ein bisschen frech — der Lack für Tage, an denen du auffallen willst.',
    '#d98a9a': 'Zart und verträumt, wie ein Sonntagmorgen mit Kaffee im Bett.',
    '#5a1f45': 'Dunkel und geheimnisvoll, ein Hauch Bühnenlicht am Abend.',
    '#7a3b8f': 'Verspielt und selbstbewusst — für Tage, die nach mehr verlangen.',
    '#24418f': 'Ruhig und klar, wie ein tiefer Atemzug an einem frischen Morgen.',
    '#8fc7e8': 'Leicht wie eine Wolke, frisch wie der erste Frühlingstag.',
    '#8aa87a': 'Erdig und gelassen, wie ein Spaziergang durch den Garten.',
    '#1f5f43': 'Satt und würdevoll, wie ein Waldweg im Dickicht.',
    '#b9793f': 'Warm und gemütlich, wie eine Wolldecke an einem Regentag.',
    '#f2c14e': 'Sonnig und übermütig — dieser Lack lacht einfach mit.',
    '#e9dfd2': 'Dezent und edel, der stille Auftritt für jeden Anlass.',
    '#3a2a24': 'Erdverbunden und stark, wie der erste Schluck Espresso am Morgen.'
  };
  var GENERIC_MOOD = 'Deine eigene Mischung — noch namenlos, aber schon ganz du.';

  var FINISH_LABELS = {
    classic: 'Classic',
    shimmer: 'Shimmer',
    glitter: 'Glitter',
    matte: 'Matt',
    chrome: 'Chrome',
    holo: 'Holo'
  };

  // ---------------------------------------------------------------------
  // Small defensive helpers
  // ---------------------------------------------------------------------
  function qs(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  }
  function qsa(sel, root) {
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }
  function isValidHex(hex) {
    return typeof hex === 'string' && HEX_RE.test(hex);
  }
  function setProp(el, prop, value) {
    if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
    el.style.setProperty(prop, value);
  }
  function closest(el, selector) {
    if (!el) return null;
    if (typeof el.closest === 'function') {
      try {
        return el.closest(selector);
      } catch (e) {
        return null;
      }
    }
    // Minimal manual fallback for very old browsers.
    var node = el;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* private mode / disabled storage: fail silently */
    }
  }
  function lsRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  // =======================================================================
  // 1. Scroll reveal
  // =======================================================================
  function initReveal() {
    var els = qsa('.reveal');
    if (!els.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8%' }
    );

    els.forEach(function (el) {
      observer.observe(el);
    });
  }

  // =======================================================================
  // 3. Shelf — the demo shelf: preset chips, a detail readout, and whatever
  // the visitor added in earlier visits (localStorage).
  // =======================================================================
  function initShelf() {
    var shelf = qs('#shelf');
    if (!shelf) return;

    var chips = qsa('.chip');
    var detail = qs('#shelfDetail');
    var clearBtn = qs('#clearShelf');
    var emptyMsg = qs('.shelf-empty') || qs('#shelfEmpty');

    var SHELF_KEY = 'nagellacke.shelf';

    function ensureEmptyMessage() {
      if (emptyMsg) return emptyMsg;
      var host = shelf.parentElement;
      if (!host) return null;
      var el = document.createElement('p');
      el.className = 'shelf-empty';
      el.textContent = 'Hier ist gerade nichts zu sehen — versuch einen anderen Filter.';
      el.hidden = true;
      host.appendChild(el);
      emptyMsg = el;
      return emptyMsg;
    }

    function currentFilter() {
      var active = chips.filter(function (c) {
        return c.getAttribute('aria-pressed') === 'true';
      })[0];
      return active ? active.getAttribute('data-filter') : 'all';
    }

    function refreshVisibility() {
      var filter = currentFilter();
      var anyVisible = false;
      qsa('.bottle', shelf).forEach(function (b) {
        var show = filter === 'all' || b.getAttribute('data-status') === filter;
        if (show) {
          b.removeAttribute('hidden');
          anyVisible = true;
        } else {
          b.setAttribute('hidden', '');
        }
      });
      var msg = ensureEmptyMessage();
      if (msg) msg.hidden = anyVisible;
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        refreshVisibility();
      });
    });

    // ---- Detail card -----------------------------------------------
    function fillDetail(data) {
      if (!detail) return;
      var fieldNames = ['name', 'brand', 'finish', 'hex', 'worn', 'note'];
      var hasFieldSlots = fieldNames.some(function (f) {
        return qs('[data-field="' + f + '"]', detail);
      });

      if (hasFieldSlots) {
        fieldNames.forEach(function (f) {
          var el = qs('[data-field="' + f + '"]', detail);
          if (el) el.textContent = data[f];
        });
      } else {
        // No explicit sub-elements provided in the markup: rebuild the
        // card content via DOM methods (never innerHTML).
        while (detail.firstChild) detail.removeChild(detail.firstChild);
        var rows = [
          { cls: 'shelf-detail-name', text: data.name },
          { cls: 'shelf-detail-brand', text: data.brand },
          { cls: 'shelf-detail-finish', text: 'Finish: ' + data.finish },
          { cls: 'shelf-detail-hex', text: data.hex },
          { cls: 'shelf-detail-worn', text: data.worn },
          { cls: 'shelf-detail-note', text: data.note }
        ];
        rows.forEach(function (row) {
          var p = document.createElement('p');
          p.className = row.cls;
          p.textContent = row.text;
          detail.appendChild(p);
        });
      }
      detail.classList.add('has-selection');
    }

    function selectBottle(btn) {
      qsa('.bottle', shelf).forEach(function (b) {
        var selected = b === btn;
        b.classList.toggle('is-selected', selected);
        b.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });

      var color = btn.getAttribute('data-color') || '';
      fillDetail({
        name: btn.getAttribute('data-name') || '',
        brand: btn.getAttribute('data-brand') || '',
        finish: btn.getAttribute('data-finish') || '',
        hex: isValidHex(color) ? color.toUpperCase() : color,
        worn: (btn.getAttribute('data-worn') || '0') + '× getragen',
        note: btn.getAttribute('data-note') || ''
      });
    }

    function bindBottle(btn) {
      btn.addEventListener('click', function () {
        selectBottle(btn);
      });
    }

    qsa('.bottle', shelf).forEach(bindBottle);

    // ---- Add to shelf + persistence ---------------------------------
    function loadStored() {
      var raw = lsGet(SHELF_KEY);
      if (!raw) return [];
      try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    function saveStored(list) {
      lsSet(SHELF_KEY, JSON.stringify(list));
    }
    function updateClearVisibility() {
      if (!clearBtn) return;
      clearBtn.hidden = loadStored().length === 0;
    }

    function buildBottleEl(entry) {
      var btn = document.createElement('button');
      btn.className = 'bottle';
      btn.setAttribute('data-status', entry.status || 'ok');
      btn.setAttribute('data-name', entry.name || '');
      btn.setAttribute('data-brand', entry.brand || '');
      btn.setAttribute('data-finish', entry.finish || 'classic');
      btn.setAttribute('data-color', entry.color || '');
      btn.setAttribute('data-worn', String(entry.worn != null ? entry.worn : 0));
      btn.setAttribute('data-note', entry.note || '');
      btn.setAttribute('data-added-by-js', 'true');

      var svgNS = 'http://www.w3.org/2000/svg';
      var xlinkNS = 'http://www.w3.org/1999/xlink';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 64 130');
      svg.setAttribute('aria-hidden', 'true');
      var use = document.createElementNS(svgNS, 'use');
      use.setAttribute('href', '#bottleTpl');
      use.setAttributeNS(xlinkNS, 'xlink:href', '#bottleTpl');
      if (isValidHex(entry.color)) {
        setProp(use, '--polish', entry.color);
      }
      svg.appendChild(use);
      btn.appendChild(svg);

      var label = document.createElement('span');
      label.className = 'bottle-label';
      label.textContent = entry.name || '';
      btn.appendChild(label);

      bindBottle(btn);
      return btn;
    }

    function addEntry(entry, opts) {
      var animate = !!(opts && opts.animate);
      var el = buildBottleEl(entry);
      shelf.appendChild(el);

      var filter = currentFilter();
      var show = filter === 'all' || entry.status === filter;
      if (!show) el.setAttribute('hidden', '');

      if (animate && !reduceMotion) {
        el.classList.add('pop-in');
        window.setTimeout(function () {
          el.classList.remove('pop-in');
        }, 400);
      }

      refreshVisibility();
      return el;
    }

    // Restore previously saved custom bottles.
    loadStored().forEach(function (entry) {
      addEntry(entry, { animate: false });
    });
    updateClearVisibility();
    refreshVisibility();


    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        qsa('.bottle[data-added-by-js="true"]', shelf).forEach(function (el) {
          el.remove();
        });
        lsRemove(SHELF_KEY);
        updateClearVisibility();
        refreshVisibility();
      });
    }
  }

  // =======================================================================
  // 7. Diary flip
  // =======================================================================
  function initDiaryFlip() {
    qsa('.diary-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var flipped = card.getAttribute('aria-pressed') === 'true';
        card.classList.toggle('is-flipped', !flipped);
        card.setAttribute('aria-pressed', flipped ? 'false' : 'true');
      });
    });
  }

  // =======================================================================
  // 8. App tabs — ARIA tabs pattern with arrow keys + Home/End.
  // =======================================================================
  function initAppTabs() {
    var tabs = qsa('.tab');
    if (!tabs.length) return;

    var tablist = closest(tabs[0], '[role="tablist"]') || tabs[0].parentElement;
    var screens = qsa('.screen');
    var notes = qsa('.screen-note');

    function activate(tab, moveFocus) {
      var target = tab.getAttribute('data-screen');

      tabs.forEach(function (t) {
        var isActive = t === tab;
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        t.setAttribute('tabindex', isActive ? '0' : '-1');
      });
      screens.forEach(function (s) {
        if (s.getAttribute('data-screen') === target) s.removeAttribute('hidden');
        else s.setAttribute('hidden', '');
      });
      notes.forEach(function (n) {
        if (n.getAttribute('data-screen') === target) n.removeAttribute('hidden');
        else n.setAttribute('hidden', '');
      });

      if (moveFocus) tab.focus();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab, false);
      });
    });

    if (tablist) {
      tablist.addEventListener('keydown', function (ev) {
        var idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        var next = null;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
          next = (idx + 1) % tabs.length;
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
          next = (idx - 1 + tabs.length) % tabs.length;
        } else if (ev.key === 'Home') {
          next = 0;
        } else if (ev.key === 'End') {
          next = tabs.length - 1;
        }
        if (next !== null) {
          ev.preventDefault();
          activate(tabs[next], true);
        }
      });
    }

    var initial =
      tabs.filter(function (t) {
        return t.getAttribute('aria-selected') === 'true';
      })[0] || tabs[0];
    activate(initial, false);
  }

  // =======================================================================
  // 9. Bar chart animation (#zahlen)
  // =======================================================================
  function initBars() {
    var bars = qsa('.bar');
    if (!bars.length) return;

    function setBarWidth(bar) {
      var w = bar.style.getPropertyValue('--w');
      if (w) bar.style.width = w;
    }

    if (reduceMotion || !('IntersectionObserver' in window)) {
      bars.forEach(setBarWidth);
      return;
    }

    var containers = [];
    bars.forEach(function (bar) {
      var container = closest(bar, '.reveal') || closest(bar, '.section') || bar.parentElement;
      if (container && containers.indexOf(container) === -1) containers.push(container);
    });

    if (!containers.length) {
      bars.forEach(setBarWidth);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            qsa('.bar', entry.target).forEach(setBarWidth);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8%' }
    );

    containers.forEach(function (c) {
      observer.observe(c);
    });
  }

  // =======================================================================
  // Bootstrap
  // =======================================================================
  function init() {
    initReveal();
    initShelf();
    initDiaryFlip();
    initAppTabs();
    initBars();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
