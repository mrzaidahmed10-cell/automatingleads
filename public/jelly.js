'use strict';
/* Liquid feel for the glass: press and drag any glass control and it stretches toward your finger, thins out the faster you pull,
   then springs back with a little bounce when you let go. Edges split into colour fringes (dispersion) in proportion to speed.
   Also: a light that follows the pointer across glass panels, and drifting glass orbs behind everything for the glass to refract.
   Pure visual layer. It never blocks clicks, and it switches off for people who ask for reduced motion. */
(function () {
  const reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion:reduce)') : { matches: true };
  if (reduce.matches) return;

  // what can be pulled: selector -> how strongly (1 = default)
  // Only plain buttons and chips, and only with a mouse. Navigation, tabs, switches, inputs, tables and dialogs are never touched.
  const PULL = [['.lg-button', 1], ['.btn', 1], ['.chip', 1]];
  const SEL = PULL.map((p) => p[0]).join(',');
  const gain = (el) => { for (const [s, g] of PULL) if (el.matches(s)) return g; return 1; };
  const NO = 'input,select,textarea,[contenteditable],table,.tw,.msgs,.drawer,.modal,.pal,.scrim,.asst,nav,.tabbar,.lg-tab-bar,.lg-segmented,.lg-switch,#toast';
  const off = () => document.documentElement.dataset.fx === 'calm';

  const live = new Map(); // el -> state
  let raf = 0, last = 0;

  const S = (el) => {
    let s = live.get(el);
    if (!s) {
      s = { el, ox: 0, oy: 0, vx: 0, vy: 0, st: 0, sv: 0, ang: 0, pr: 0, pv: 0, tx: 0, ty: 0, tst: 0, tpr: 0, down: false, id: null, x0: 0, y0: 0, px: 0, py: 0, pt: 0, spd: 0, g: gain(el), w: 1, h: 1, moved: false };
      live.set(el, s);
    }
    return s;
  };

  // spring step: k stiffness, c damping. Lower damping on release = more bounce.
  function spring(x, v, target, k, c, dt) {
    const a = -k * (x - target) - c * v;
    v += a * dt;
    return [x + v * dt, v];
  }

  function frame(t) {
    const dt = Math.min(0.032, (t - last) / 1000 || 0.016);
    last = t;
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (const s of live.values()) {
      // while held the springs are tight and follow the pointer; on release they are loose, so the element overshoots and wobbles
      const k = s.down ? 520 : 240, c = s.down ? 34 : 9.5;
      for (let i = 0; i < n; i++) {
        [s.ox, s.vx] = spring(s.ox, s.vx, s.tx, k, c, h);
        [s.oy, s.vy] = spring(s.oy, s.vy, s.ty, k, c, h);
        [s.st, s.sv] = spring(s.st, s.sv, s.tst, s.down ? 380 : 210, s.down ? 30 : 8.5, h);
        [s.pr, s.pv] = spring(s.pr, s.pv, s.tpr, 420, s.down ? 30 : 10, h);
      }
      s.spd *= Math.pow(0.0005, dt); // pointer speed fades when the pointer stops
      if (s.down && performance.now() - s.pt > 70) s.tst = Math.max(0, s.tst - 0.0); // hold shape when still
      const rest = !s.down && Math.abs(s.ox) + Math.abs(s.oy) < 0.05 && Math.abs(s.vx) + Math.abs(s.vy) < 0.4 && Math.abs(s.st) < 0.002 && Math.abs(s.sv) < 0.05 && Math.abs(s.pr) < 0.002 && Math.abs(s.pv) < 0.05;
      if (rest) { clear(s); live.delete(s.el); continue; }
      draw(s);
    }
    raf = live.size ? requestAnimationFrame(frame) : 0;
  }

  function draw(s) {
    const el = s.el;
    const speed = Math.hypot(s.vx, s.vy); // px/s of the element itself, so the bounce also fringes
    const thin = s.st; // stretch along the pull, thinning across it
    const along = 1 + thin, across = 1 / Math.pow(1 + Math.max(thin, -0.4), 0.7);
    const press = 1 - 0.07 * s.pr;
    el.style.transform = `translate3d(${s.ox.toFixed(2)}px,${s.oy.toFixed(2)}px,0) rotate(${s.ang.toFixed(4)}rad) scale(${(along * press).toFixed(4)},${(across * press).toFixed(4)}) rotate(${(-s.ang).toFixed(4)}rad)`;
    // dispersion: colour fringes split along the motion, wider when moving fast
    const d = Math.min(2.2, speed / 260 + Math.abs(thin) * 8 + Math.abs(s.pr) * 0.5);
    const dx = (s.vx === 0 && s.vy === 0 ? Math.cos(s.ang) : s.vx / (speed || 1)) * d, dy = (s.vx === 0 && s.vy === 0 ? Math.sin(s.ang) : s.vy / (speed || 1)) * d;
    el.style.filter = d > 0.12 ? `drop-shadow(${dx.toFixed(2)}px ${dy.toFixed(2)}px 0 rgb(255 60 110 / .40)) drop-shadow(${(-dx).toFixed(2)}px ${(-dy).toFixed(2)}px 0 rgb(60 150 255 / .40))` : '';
  }

  function clear(s) {
    s.el.style.transform = '';
    s.el.style.filter = '';
    s.el.style.willChange = '';
    s.el.removeAttribute('data-jelly');
  }

  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  function down(e) {
    if (e.button > 0 || !e.isPrimary || e.pointerType !== 'mouse' || off()) return;
    const el = e.target.closest && e.target.closest(SEL);
    if (!el || el.disabled || el.closest(NO)) return;
    const r = el.getBoundingClientRect();
    const s = S(el);
    s.down = true; s.id = e.pointerId; s.x0 = e.clientX; s.y0 = e.clientY; s.px = e.clientX; s.py = e.clientY; s.pt = performance.now();
    s.w = Math.max(24, r.width); s.h = Math.max(24, r.height); s.moved = false; s.spd = 0;
    s.tpr = 1;
    el.setAttribute('data-jelly', '');
    el.style.willChange = 'transform,filter';
    kick();
  }

  function move(e) {
    for (const s of live.values()) {
      if (!s.down || e.pointerId !== s.id) continue;
      if (off()) { s.down = false; s.tx = s.ty = s.tst = s.tpr = 0; continue; }
      const now = performance.now(), dtm = Math.max(1, now - s.pt);
      const vx = (e.clientX - s.px) / dtm, vy = (e.clientY - s.py) / dtm; // px per ms
      s.spd = Math.min(4, s.spd * 0.6 + Math.hypot(vx, vy) * 0.4);
      s.px = e.clientX; s.py = e.clientY; s.pt = now;
      const dx = e.clientX - s.x0, dy = e.clientY - s.y0, dist = Math.hypot(dx, dy);
      if (dist > 10) s.moved = true; // small hand jitter during a click is still a click
      // rubber band: follows the pointer but with growing resistance
      const R = 14 + Math.min(s.w, 220) * 0.08;
      const rub = (d) => R * Math.tanh(d / (R * 2.2)) * s.g;
      const dz = (d) => Math.sign(d) * Math.max(0, Math.abs(d) - 8);
      s.tx = rub(dz(dx)); s.ty = 0; s.ang = 0; // side to side only, after a small dead zone
      // thinning: more the farther you pull, and a lot more the faster you pull
      const size = Math.max(s.w, s.h);
      s.tst = Math.min(0.14, (Math.abs(dx) / (size * 5) + s.spd * 0.03) * s.g);
      kick();
    }
  }

  function up(e) {
    for (const s of live.values()) {
      if (!s.down || (e && e.pointerId !== s.id)) continue;
      s.down = false; s.tx = 0; s.ty = 0; s.tst = 0; s.tpr = 0;
      // let go with the momentum of the pull, so it flings past and wobbles back
      s.vx += Math.sign(s.px - s.x0) * s.spd * 70 * s.g * (s.moved ? 1 : 0);
      
      s.sv += s.spd * 0.8 * s.g;
      s.pv += s.moved ? 0 : 6; // a plain tap gets a small pop
      if (s.moved) suppressClick(s.el);
    }
    kick();
  }

  // a real drag shouldn't also count as a click on the thing you pulled
  function suppressClick(el) {
    const h = (ev) => { if (el.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); } };
    window.addEventListener('click', h, true);
    setTimeout(() => window.removeEventListener('click', h, true), 60);
  }

  document.addEventListener('pointerdown', down, { passive: true });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', up, { passive: true });

  /* ---- light that follows the pointer on glass panels ---- */
  let hov = null, pend = 0, px = 0, py = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || off()) return;
    px = e.clientX; py = e.clientY;
    if (pend) return;
    pend = requestAnimationFrame(() => {
      pend = 0;
      const el = document.elementFromPoint(px, py);
      const g = el && el.closest && el.closest('.card,.top,.side,.drawer,.modal,.kpi');
      if (hov && hov !== g) { hov.style.removeProperty('--mx'); hov.style.removeProperty('--my'); hov.removeAttribute('data-lit'); }
      hov = g;
      if (g) {
        const r = g.getBoundingClientRect();
        g.style.setProperty('--mx', (px - r.left).toFixed(0) + 'px');
        g.style.setProperty('--my', (py - r.top).toFixed(0) + 'px');
        g.setAttribute('data-lit', '');
      }
    });
  }, { passive: true });

  /* ---- drifting glass orbs behind the UI ---- */
  const au = document.getElementById('aurora');
  if (au && !au.querySelector('.orb')) {
    const defs = [
      ['38vmin', '8%', '14%', 'var(--c1)', 0], ['26vmin', '78%', '10%', 'var(--c2)', 1], ['32vmin', '70%', '72%', 'var(--c4)', 2],
      ['20vmin', '12%', '78%', 'var(--c3)', 3], ['16vmin', '46%', '40%', 'var(--c2)', 4],
    ];
    for (const [sz, x, y, c, i] of defs) {
      const o = document.createElement('i');
      o.className = 'orb';
      o.style.cssText = `--sz:${sz};--x:${x};--y:${y};--c:${c};--d:${26 + i * 7}s;--dl:${-i * 6}s`;
      au.appendChild(o);
    }
    // gentle parallax with the pointer, so the orbs slide under the glass
    let ax = 0, ay = 0;
    window.addEventListener('pointermove', (e) => { ax = e.clientX / innerWidth - 0.5; ay = e.clientY / innerHeight - 0.5; au.style.setProperty('--px', (ax * -26).toFixed(1) + 'px'); au.style.setProperty('--py', (ay * -26).toFixed(1) + 'px'); }, { passive: true });
  }
})();
