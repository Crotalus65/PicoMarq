import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '../../lib/desktop';
import { cn } from '../../lib/utils';

const menus = ['File', 'Edit', 'View', 'Help'] as const;

export function ApplicationMenu({ active = true }: { active?: boolean }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const lastInput = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const opening = useRef(false);
  const showMenu = useCallback(async (index: number) => {
    if (opening.current) return;
    const button = buttons.current[index];
    if (!button) return;
    const bounds = button.getBoundingClientRect();
    // Native clipboard menu items act on the last focused editing control.
    lastInput.current?.focus({ preventScroll: true });
    opening.current = true;
    setOpen(index);
    try {
      await invoke('app_menu', { menu: menus[index].toLowerCase(), x: bounds.left, y: bounds.bottom });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      opening.current = false;
      setOpen(null);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const focus = (event: FocusEvent) => {
      const element = event.target;
      if (element instanceof HTMLElement && element.matches('input, textarea, [contenteditable="true"]')) lastInput.current = element;
    };
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = menus.findIndex(menu => menu[0].toLowerCase() === event.key.toLowerCase());
      if (index >= 0) { event.preventDefault(); void showMenu(index); }
    };
    document.addEventListener('focusin', focus);
    window.addEventListener('keydown', key);
    const stop = window.desktop?.onCommand(command => {
      const index = menus.findIndex(menu => command.action === `menu-${menu.toLowerCase()}`);
      if (index >= 0) void showMenu(index);
    });
    return () => { stop?.(); document.removeEventListener('focusin', focus); window.removeEventListener('keydown', key); };
  }, [showMenu, active]);
  return <nav aria-label="Application menus" className="flex items-center h-8 gap-0.5 select-none">
    {menus.map((menu, index) => <button
      key={menu}
      ref={element => { buttons.current[index] = element; }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === index}
      onMouseDown={event => event.preventDefault()}
      onClick={() => void showMenu(index)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); void showMenu(index); }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          buttons.current[(index + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length]?.focus();
        }
      }}
      className={cn('h-7 px-2 text-xs text-text rounded hover:bg-bg-emphasis focus-visible:outline focus-visible:outline-accent', open === index && 'bg-bg-emphasis')}
    >{menu}</button>)}
  </nav>;
}
