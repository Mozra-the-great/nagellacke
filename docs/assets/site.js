/*
 * Nagellacke project page — site.js
 *
 * Plain ES2020, no framework, no build step. Every feature is defensive: a
 * missing element skips that feature instead of throwing, so the same file
 * serves index.html and privacy-policy.html.
 *
 *   1. Language (DE/EN) — German is the markup default; elements carrying
 *      data-en (text) or data-en-aria-label get the English text when EN is
 *      active. The privacy page swaps whole [data-lang-block] sections via CSS
 *      on <html lang>.
 *   2. Scroll reveal — the only motion kept from the old page, off for
 *      prefers-reduced-motion.
 *   3. Shelf — filter and tap-for-details (note + wear counter).
 *   4. App tabs — WAI-ARIA tabs with arrow-key navigation.
 */
(function () {
  'use strict';

  var doc = document;
  doc.documentElement.classList.add('js');

  var LANG_KEY = 'nagellacke.lang';
  var currentLang = 'de';

  function qs(sel, root) {
    return (root || doc).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || doc).querySelectorAll(sel));
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
      /* private mode or blocked storage: the choice just is not remembered */
    }
  }
  function prefersReducedMotion() {
    try {
      return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- 1. i18n
  var STRINGS = {
    de: {
      count: function (shown, total) {
        return 'Angezeigt: ' + shown + ' von ' + total + ' Lacken';
      }
    },
    en: {
      count: function (shown, total) {
        return 'Showing ' + shown + ' of ' + total + ' polishes';
      }
    }
  };
  var langListeners = [];

  function applyLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'de';
    var en = currentLang === 'en';

    qsa('[data-en]').forEach(function (el) {
      if (el.__de === undefined) el.__de = el.textContent;
      el.textContent = en ? el.getAttribute('data-en') : el.__de;
    });
    qsa('[data-en-aria-label]').forEach(function (el) {
      if (el.__deLabel === undefined) el.__deLabel = el.getAttribute('aria-label') || '';
      el.setAttribute('aria-label', en ? el.getAttribute('data-en-aria-label') : el.__deLabel);
    });
    qsa('[data-en-content]').forEach(function (el) {
      if (el.__deContent === undefined) el.__deContent = el.getAttribute('content') || '';
      el.setAttribute('content', en ? el.getAttribute('data-en-content') : el.__deContent);
    });

    doc.documentElement.lang = currentLang;
    qsa('.lang-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === currentLang ? 'true' : 'false');
    });
    langListeners.forEach(function (fn) {
      fn();
    });
  }

  function initLang() {
    var stored = lsGet(LANG_KEY);
    var initial = stored;
    if (initial !== 'de' && initial !== 'en') {
      var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'de';
      initial = /^en\b/i.test(nav) ? 'en' : 'de';
    }
    if (initial === 'en') applyLang('en');

    qsa('.lang-btn').forEach(function (btn) {
      if (initial !== 'en') btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === 'de' ? 'true' : 'false');
      btn.addEventListener('click', function () {
        var lang = btn.getAttribute('data-lang') === 'en' ? 'en' : 'de';
        if (lang === currentLang) return;
        applyLang(lang);
        lsSet(LANG_KEY, lang);
      });
    });
  }

  // ------------------------------------------------------------- 2. reveal
  function initReveal() {
    var els = qsa('.reveal');
    if (!els.length) return;
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
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
      { threshold: 0, rootMargin: '0px 0px -8% 0px' }
    );
    els.forEach(function (el) {
      observer.observe(el);
    });
  }

  // -------------------------------------------------------------- 3. shelf
  function initShelf() {
    var shelf = qs('#shelf');
    if (!shelf) return;
    var cards = qsa('.shelf-card', shelf);
    var chips = qsa('.filters [data-filter]');
    var countEl = qs('#shelfCount');

    function setOpen(card, open) {
      var btn = qs('.shelf-toggle', card);
      var detail = qs('.shelf-detail', card);
      if (!btn || !detail) return;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      detail.hidden = !open;
      card.classList.toggle('is-open', open);
    }

    function updateCount() {
      if (!countEl) return;
      var shown = cards.filter(function (c) {
        return !c.hidden;
      }).length;
      countEl.textContent = STRINGS[currentLang].count(shown, cards.length);
    }

    cards.forEach(function (card) {
      var btn = qs('.shelf-toggle', card);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var willOpen = btn.getAttribute('aria-expanded') !== 'true';
        cards.forEach(function (other) {
          if (other !== card) setOpen(other, false);
        });
        setOpen(card, willOpen);
      });
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
          setOpen(card, false);
          btn.focus();
        }
      });
    });

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var filter = chip.getAttribute('data-filter');
        chips.forEach(function (c) {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        cards.forEach(function (card) {
          var show = filter === 'all' || card.getAttribute('data-status') === filter;
          card.hidden = !show;
          if (!show) setOpen(card, false);
        });
        updateCount();
      });
    });

    langListeners.push(updateCount);
    updateCount();
  }

  // --------------------------------------------------------------- 4. tabs
  function initTabs() {
    var list = qs('[role="tablist"]');
    if (!list) return;
    var tabs = qsa('[role="tab"]', list);
    var panels = tabs.map(function (tab) {
      return doc.getElementById(tab.getAttribute('aria-controls'));
    });

    function select(index, focus) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () {
        select(i, false);
      });
      tab.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        select(next, true);
      });
    });

    var initial = tabs.findIndex(function (tab) {
      return tab.getAttribute('aria-selected') === 'true';
    });
    select(initial < 0 ? 0 : initial, false);
  }

  initLang();
  initReveal();
  initShelf();
  initTabs();
})();
