'use strict';
/* Accessibility layer: labels, dialogs, focus, keyboard, quick jump */
(function () {
  const ov = document.getElementById('ov');
  let opener = null;

  // Auto-link <label> to the next control so screen readers announce fields.
  let n = 0;
  function fixLabels(root) {
    root.querySelectorAll('label:not([for])').forEach((l) => {
      const c = l.parentElement && l.parentElement.querySelector('input,select,textarea');
      if (!c) return;
      if (!c.id) c.id = 'f' + ++n;
      l.setAttribute('for', c.id);
    });
  }

  // Overlays behave as real dialogs: role, label, focus in, background inert, focus restored.
  function setBg(inert) {
    ['app', 'toast'].forEach((id) => {
      const e = document.getElementById(id);
      if (e && id === 'app') { if (inert) e.setAttribute('inert', ''); else e.removeAttribute('inert'); }
    });
  }
  new MutationObserver(() => {
    const open = ov.innerHTML.trim() !== '';
    const box = ov.querySelector('.drawer,.modal,.pal');
    if (open && box && !box.dataset.a11y) {
      box.dataset.a11y = '1';
      if (!opener) opener = document.activeElement;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      const h = box.querySelector('h2'); if (h) { h.id = h.id || 'dlgT'; box.setAttribute('aria-labelledby', h.id); } else box.setAttribute('aria-label', 'Dialog');
      box.tabIndex = -1; setBg(true); fixLabels(box);
      const first = box.querySelector('input,textarea,select') || box;
      setTimeout(() => first.focus({ preventScroll: true }), 20);
    } else if (!open) {
      setBg(false);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      opener = null;
    }
  }).observe(ov, { childList: true });

  // Keep focus inside the open dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const box = ov.querySelector('[role=dialog]'); if (!box) return;
    const f = [...box.querySelectorAll('a[href],button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === a || document.activeElement === box)) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });

  // Enter/Space activates clickable rows.
  document.addEventListener('keydown', (e) => {
    const r = e.target.closest && e.target.closest('tr.lead[tabindex]');
    if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); }
  });

  // Label fields on every view render.
  new MutationObserver(() => fixLabels(document.getElementById('view'))).observe(document.getElementById('view'), { childList: true });

  /* ----- quick jump (Ctrl/Cmd+K) ----- */
  function items(q) {
    const out = [];
    Object.entries(ROUTES).forEach(([k, v]) => out.push({ t: 'Go to ' + v[0], s: 'page', run: () => go(k) }));
    out.push({ t: 'Open the assistant', s: 'Ctrl J', run: () => openAssist(true) });
    out.push({ t: 'Add a lead', s: 'action', run: () => { go('leads'); setTimeout(() => A.addLeadModal(), 50); } });
    out.push({ t: 'Toggle dark mode', s: 'action', run: toggleTheme });
    out.push({ t: 'Toggle compact / comfy', s: 'action', run: () => A.density() });
    S.leads.forEach((l) => out.push({ t: l.name, s: l.status, run: () => { go('leads'); setTimeout(() => A.openLead && A.openLead({ dataset: { id: l.id } }, { target: document.body }), 30); } }));
    const k = q.toLowerCase();
    return out.filter((x) => !k || x.t.toLowerCase().includes(k)).slice(0, 12);
  }
  let sel = 0, list = [];
  function draw() {
    const q = document.getElementById('palQ').value;
    list = items(q); sel = Math.min(sel, Math.max(0, list.length - 1));
    document.getElementById('palR').innerHTML = list.length
      ? list.map((x, i) => `<button class="pi ${i === sel ? 'on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">${esc(x.t)}<small>${esc(x.s)}</small></button>`).join('')
      : '<div class="hint" style="padding:10px">No matches</div>';
  }
  function pick(i) { const x = list[i]; if (!x) return; closeOv(); setTimeout(x.run, 10); }
  A.palette = () => {
    if (ov.innerHTML.trim()) return;
    ov.innerHTML = `<div class="scrim c" data-act="closeBg"><div class="card pal"><label class="sr" for="palQ">Quick jump</label><input id="palQ" placeholder="Jump to a page, lead or action…" autocomplete="off" role="combobox" aria-controls="palR" aria-expanded="true"><div class="pr" id="palR" role="listbox"></div></div></div>`;
    sel = 0; draw();
    const q = document.getElementById('palQ');
    q.oninput = () => { sel = 0; draw(); };
    q.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    };
    document.getElementById('palR').onclick = (e) => { const b = e.target.closest('.pi'); if (b) pick(+b.dataset.i); };
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('app').classList.contains('hide')) { e.preventDefault(); A.palette(); }
  });
})();
