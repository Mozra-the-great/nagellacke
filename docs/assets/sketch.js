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
  // 0. i18n (#250) — German is the canonical copy already in index.html;
  // this only ever adds an English overlay on top of it. Static text goes
  // through the generic [data-i18n] sweep in applyLang(); the shelf's
  // per-bottle name/note (only shown after a click, not static markup) and
  // the small "Finish: " / "× getragen" bits it builds are looked up
  // through currentLang/UI_STRINGS/FINISH_EN directly from initShelf.
  // =======================================================================
  var LANG_KEY = 'nagellacke.lang';
  var currentLang = 'de';
  var langChangeListeners = [];
  function onLangChange(fn) {
    langChangeListeners.push(fn);
  }

  var UI_STRINGS = {
    de: { finish: 'Finish: ', worn: '× getragen' },
    en: { finish: 'Finish: ', worn: '× worn' }
  };
  // Only finish word that actually differs between the two languages —
  // the rest (Classic/Shimmer/Glitter/Chrome/Holo) are the same in both.
  var FINISH_EN = { Matt: 'Matte' };

  // English text for every [data-i18n] key in index.html. Anything not
  // listed here (or not found by an element's key) simply falls back to
  // the German text already sitting in the DOM.
  var DICT = {
    'skip-link': 'Skip to content',
    'nav-aria': 'Main navigation',
    'nav-regal': 'Shelf',
    'word-tagebuch': 'Diary',
    'nav-app': 'App',
    'nav-privacy': 'Privacy',
    'lang-toggle-aria': 'Choose language / Sprache wählen',

    'hero-kicker': 'Collect · Wear · Remember',
    'hero-h1-a': 'Your polish collection',
    'hero-h1-b': 'as a',
    'hero-h1-c': 'Sketchbook',
    'hero-lead':
      'Keep your shelf, try out colors and finishes, and log every mani in the diary — with a photo, date, and a note on why that exact polish had to be the one that day.',
    'hero-cta-primary': 'Browse the shelf',
    'hero-cta-secondary': 'What the app can do',
    'hero-fact-1': 'no tracking',
    'hero-fact-2': 'your data stays with you',
    'hero-fact-3': 'works offline',
    'hero-svg-label': 'Favorite polish ♥',

    'regal-h2': 'Your shelf',
    'regal-lead':
      "What you own, what's still on the wishlist, and what's sadly run dry — your whole collection at a glance.",
    'filters-aria': 'Filter shelf',
    'filter-all': 'All',
    'filter-ok': 'In stock',
    'filter-wish': 'Wishlist',
    'filter-empty': 'Empty',
    'shelf-empty': 'Nothing to see here — try a different filter.',
    'shelf-placeholder': 'Tap a bottle on the shelf to learn more about it.',

    'diary-h2': 'The diary',
    'diary-lead':
      "Which mani was on when, with a little note about it — to flip back through when you don't know what to wish for next.",
    'diary-date-1': 'March 3',
    'diary-polish-1': 'Cherry Pit Kiss',
    'diary-note-1':
      'Rainy Tuesday, coffee instead of tax returns. Lasted eleven days without a single chip.',
    'diary-date-2': 'April 18',
    'diary-polish-2': 'Pearl & Dusty Rose',
    'diary-note-2':
      'First spring walk in the park. Already slightly nibbled at the tips after a week.',
    'diary-date-3': 'June 9',
    'diary-polish-3': 'Ink Blue + Glitter Accent',
    'diary-note-3':
      "Birthday party at K.'s, the registry office the day after. The glitter held smoothly all the way to summer vacation.",
    'diary-date-4': 'July 27',
    'diary-polish-4': 'Sage with Flower Sticker',
    'diary-note-4':
      "Hot afternoon in the garden, applied the stickers a bit too early. Two had already fallen off after three days.",
    'diary-tally': '4 of 132 entries',

    'app-h2': 'What it looks like day to day',
    'app-lead': 'Swipe through the views and see what everyday life with the app looks like.',
    'phone-tabs-aria': 'Choose app view',
    'word-sammlung': 'Collection',
    'word-statistik': 'Stats',
    'word-sticker': 'Stickers',
    'panel-sammlung':
      'Search your whole collection by color, brand, or finish, and see at a glance what’s still missing.',
    'panel-tagebuch':
      'Keep track of which polish you wore when — with a photo, date, and a few words about it.',
    'panel-statistik': 'See which brands and color families really dominate your shelf.',
    'panel-sticker':
      'Also manage your nail art stickers and foils, ready for the next manicure.',
    'platform-web': 'Web app in the browser',
    'platform-offline': 'works offline',

    'zahlen-h2': 'What your shelf reveals',
    'zahlen-lead':
      'After a few months of collecting, the shelf reveals a lot about your own taste.',
    'chart-brands-h3': 'Top brands',
    'chart-colors-h3': 'Color families',
    'color-rot': 'Red',
    'color-rose': 'Rose',
    'color-blau': 'Blue',
    'color-gruen': 'Green',
    'color-nude': 'Nude',
    'big-number-lacke': 'Polishes',
    'big-number-manis': 'Manis',
    'big-number-wuensche': 'Wishes',

    'footer-note': 'Built with pencil, pen, and a bit of code.',
    'footer-privacy': 'Privacy Policy',
    'footer-top': 'Back to top',
    'footer-github': 'Project on GitHub',
    'footer-fine': 'A private, ad-free app. No cookies, no tracking on this page.'
  };

  function applyLang(lang) {
    qsa('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var enText = DICT[key];
      var attrName = el.getAttribute('data-i18n-attr');
      if (attrName) {
        if (el.__deAttr == null) el.__deAttr = el.getAttribute(attrName) || '';
        el.setAttribute(attrName, lang === 'en' && enText ? enText : el.__deAttr);
      } else {
        if (el.__deText == null) el.__deText = el.textContent;
        el.textContent = lang === 'en' && enText ? enText : el.__deText;
      }
    });

    currentLang = lang;
    document.documentElement.lang = lang;
    qsa('.lang-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    langChangeListeners.forEach(function (fn) {
      fn(lang);
    });
  }

  function initI18n() {
    var buttons = qsa('.lang-btn');

    var stored = lsGet(LANG_KEY);
    var initial = stored === 'en' || stored === 'de' ? stored : 'de';
    applyLang(initial);

    if (!buttons.length) return;
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.getAttribute('data-lang') === 'en' ? 'en' : 'de';
        if (lang === currentLang) return;
        applyLang(lang);
        lsSet(LANG_KEY, lang);
      });
    });
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

    // Scoped to .filters: the DE/EN toggle buttons reuse the .chip class for
    // its look, a bare qsa('.chip') would wrongly pull them into the filter
    // group and reset their aria-pressed state on every filter click.
    var chips = qsa('.filters .chip');
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
        var strings = UI_STRINGS[currentLang] || UI_STRINGS.de;
        var rows = [
          { cls: 'shelf-detail-name', text: data.name },
          { cls: 'shelf-detail-brand', text: data.brand },
          { cls: 'shelf-detail-finish', text: strings.finish + data.finish },
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
      var isEn = currentLang === 'en';
      var name = (isEn && btn.getAttribute('data-name-en')) || btn.getAttribute('data-name') || '';
      var note = (isEn && btn.getAttribute('data-note-en')) || btn.getAttribute('data-note') || '';
      var finishRaw = btn.getAttribute('data-finish') || '';
      var finish = (isEn && FINISH_EN[finishRaw]) || finishRaw;
      var strings = UI_STRINGS[currentLang] || UI_STRINGS.de;
      fillDetail({
        name: name,
        brand: btn.getAttribute('data-brand') || '',
        finish: finish,
        hex: isValidHex(color) ? color.toUpperCase() : color,
        worn: (btn.getAttribute('data-worn') || '0') + strings.worn,
        note: note
      });
    }

    function bindBottle(btn) {
      btn.addEventListener('click', function () {
        selectBottle(btn);
      });
    }

    qsa('.bottle', shelf).forEach(bindBottle);

    // Bottle names shown on the shelf itself (not just in the detail card)
    // also need to follow the active language, and the selected bottle's
    // detail card needs refreshing in place when the toggle is clicked.
    function applyShelfLang() {
      qsa('.bottle', shelf).forEach(function (b) {
        var label = qs('.bottle-label', b);
        if (!label) return;
        var nameEn = b.getAttribute('data-name-en');
        label.textContent = (currentLang === 'en' && nameEn) || b.getAttribute('data-name') || '';
      });
      var selected = qs('.bottle.is-selected', shelf);
      if (selected) selectBottle(selected);
    }
    applyShelfLang();
    onLangChange(applyShelfLang);

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
    initI18n();
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
