// The tabs under the display: Radio, Repeaters, Satellites, Logbook.

const STORAGE_KEY = 'console.tab';

export function setupTabs() {
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const listeners = [];
  let current = null;

  function show(id, focus = false) {
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    current = tab.id;
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* not remembered, no harm */
    }
    for (const fn of listeners) fn(current);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => show(tab.id));
    // Left and right arrows move between tabs, as tab lists are expected to.
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      show(next.id, true);
    });
  });

  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* start on the first tab */
  }
  show(saved || tabs[0].id);

  return {
    show,
    get current() {
      return current;
    },
    onShow(fn) {
      listeners.push(fn);
    },
  };
}
