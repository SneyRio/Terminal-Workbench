import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react';

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'muted';
  group?: string;
}

// The OS dropdown ignores the app theme and gets clipped by scrolling containers, so the app draws its own list.
// The menu is portalled and placed above the trigger, which covers the chat composer and the status bar alike.
export function Picker({ label, title, value, placeholder, options, onSelect, menuClassName, buttonClassName }: {
  label: string;
  title?: string;
  value: string;
  placeholder?: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  menuClassName?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number; minWidth: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const listId = useMemo(() => 'pick-' + Math.random().toString(36).slice(2, 9), []);
  const current = options.find(o => o.id === value);
  const selected = Math.max(0, options.findIndex(o => o.id === value));
  const place = () => {
    const el = trigger.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = menu.current?.offsetWidth || 0;
    const left = width ? Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) : Math.max(8, Math.min(rect.left, window.innerWidth - 320));
    setPos({ left, bottom: window.innerHeight - rect.top + 6, minWidth: rect.width });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    // Scrolling moves the anchor, and a menu pinned to the old spot is worse than no menu.
    const onScroll = () => setOpen(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  const show = () => {
    const el = trigger.current;
    if (!el || !options.length) return;
    const rect = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), bottom: window.innerHeight - rect.top + 6, minWidth: rect.width });
    setActive(selected); setOpen(true);
  };
  const pick = (i: number) => { const option = options[i]; if (!option) return; onSelect(option.id); setOpen(false); trigger.current?.focus(); };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + options.length) % options.length); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    // Esc closes only this list: elsewhere in the pane it interrupts the running turn.
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return <>
    <button ref={trigger} type="button" className={'picker-trigger' + (buttonClassName ? ' ' + buttonClassName : '')} role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[active] ? listId + '-' + active : undefined} title={title} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown}>
      <span className={current ? '' : 'picker-placeholder'}>{current?.label || placeholder || ''}</span><CaretDown size={10} weight="bold"/>
    </button>
    {open && pos && createPortal(<div ref={menu} className={'picker-menu' + (menuClassName ? ' ' + menuClassName : '')} role="listbox" id={listId} aria-label={label} style={{ left: pos.left, bottom: pos.bottom, minWidth: Math.max(pos.minWidth, 180) }}>
      {options.map((o, i) => <Fragment key={o.id}>
        {(o.group && options[i - 1]?.group !== o.group) && <div className="picker-group" aria-hidden="true">{o.group}</div>}
        <button type="button" id={listId + '-' + i} role="option" tabIndex={-1} aria-selected={o.id === value} className={'picker-option' + (o.id === value ? ' selected' : '') + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(i)}>
          <span className="picker-option-label">{o.label}</span>
          {o.hint && <span className={'picker-option-hint ' + (o.tone || 'muted')}>{o.hint}</span>}
        </button>
      </Fragment>)}
    </div>, document.body)}
  </>;
}
