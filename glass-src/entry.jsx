// Bridges Glisse (React, MIT, by Kelvin Zhang) into the plain-JS dashboard.
// Usage from the page: FLGlass.mount(element, 'TabBar', props); calling it again updates the same element.
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Glass, Menu, SearchField, SegmentedControl, Switch, TabBar } from 'glisse';

const Svg = ({ html, className }) => <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;

function TopTools({ onJump, onDensity, onTheme, density, dark, jumpIcon, themeIcon }) {
  return (
    <div className="gl-tools">
      <Button aria-label="Quick jump (Ctrl K)" onClick={onJump} icon={<Svg html={jumpIcon} />}>
        <span className="gl-hm">Jump</span>
      </Button>
      <SegmentedControl
        aria-label="Row density"
        className="gl-dens"
        items={[{ value: 'compact', label: 'Compact' }, { value: 'comfy', label: 'Comfy' }]}
        value={density}
        onValueChange={onDensity}
      />
      <Button aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={onTheme} icon={<Svg html={themeIcon} />} />
    </div>
  );
}

function Tabs({ items, value, label }) {
  return (
    <TabBar
      aria-label={label || 'Main'}
      value={value}
      items={items.map((i) => ({
        value: i.value,
        href: i.href,
        icon: <span className="gl-tabicon"><Svg html={i.icon} />{i.badge ? <b className="gl-badge">{i.badge}</b> : null}</span>,
        label: i.label,
      }))}
    />
  );
}

function Search({ value, onValueChange, label, placeholder }) {
  return <SearchField aria-label={label} placeholder={placeholder} value={value} onValueChange={onValueChange} />;
}

function Seg({ items, value, onValueChange, label }) {
  return <SegmentedControl aria-label={label} items={items} value={value} onValueChange={onValueChange} />;
}

function Btn({ label, icon, variant, onClick, disabled, destructive }) {
  return (
    <Button variant={variant} destructive={destructive} disabled={disabled} onClick={onClick} icon={icon ? <Svg html={icon} /> : undefined}>
      {label}
    </Button>
  );
}

function Panel({ node, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && node) ref.current.appendChild(node);
  }, [node]);
  return <Glass ref={ref} className={className} />;
}

const C = { TopTools, Tabs, Search, Seg, Btn, Panel, Switch, Menu };
const roots = new Map();

window.FLGlass = {
  ok: true,
  mount(el, name, props) {
    if (!el || !C[name]) return;
    let r = roots.get(el);
    if (!r) {
      r = createRoot(el);
      roots.set(el, r);
    }
    const Comp = C[name];
    r.render(<Comp {...props} />);
  },
  // Called before a page re-renders its HTML, so removed controls stop running their glass effects
  unmountWithin(box) {
    for (const [el, r] of [...roots]) if (box.contains(el)) { r.unmount(); roots.delete(el); }
  },
  unmount(el) {
    const r = roots.get(el);
    if (r) {
      r.unmount();
      roots.delete(el);
    }
  },
};
