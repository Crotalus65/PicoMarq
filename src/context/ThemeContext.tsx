import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { invoke } from '../lib/desktop';
import type { Settings, EditorFontSettings, EditorWidth, CustomColors, ThemeColorKey, StartupBehavior } from '../types/note';
import { defaultThemeColors } from './theme-colors';
export { defaultThemeColors } from './theme-colors';

type ThemeMode = 'light' | 'dark' | 'system';
export const defaultEditorFontSettings: Required<EditorFontSettings> = { baseFontFamily: 'system-sans', systemFontFamily: '', baseFontSize: 15, boldWeight: 600, lineHeight: 1.6 };
const fontPresets = {
  'system-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
};
export function fontCss(fonts: Required<EditorFontSettings>) {
  return fonts.baseFontFamily === 'system-font' && fonts.systemFontFamily ? `${JSON.stringify(fonts.systemFontFamily)}, sans-serif` : fontPresets[fonts.baseFontFamily as keyof typeof fontPresets] || fontPresets['system-sans'];
}
interface ThemeContextType {
  startupBehavior: StartupBehavior;
  setStartupBehavior: (value: StartupBehavior) => void;
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
  editorFontSettings: Required<EditorFontSettings>;
  setEditorFontSetting: <K extends keyof EditorFontSettings>(key: K, value: EditorFontSettings[K]) => void;
  resetEditorFontSettings: () => void;
  textDirection: 'auto';
  editorWidth: EditorWidth;
  setEditorWidth: (width: EditorWidth) => void;
  interfaceZoom: number;
  setInterfaceZoom: (value: number | ((prev: number) => number)) => void;
  toolbarIconScale: 1 | 1.5 | 2;
  setToolbarIconScale: (value: 1 | 1.5 | 2) => void;
  resetInterfaceSettings: () => void;
  smartTypography: boolean;
  setSmartTypography: (value: boolean) => void;
  customEditorWidthPx: number;
  setCustomEditorWidthPx: (px: number) => void;
  setEditorMaxWidthLive: (value: string) => void;
  customColorsLight: CustomColors;
  customColorsDark: CustomColors;
  setCustomColor: (mode: 'light' | 'dark', key: ThemeColorKey, value: string) => void;
  resetCustomColor: (mode: 'light' | 'dark', key: ThemeColorKey) => void;
  resetAllCustomColors: (mode: 'light' | 'dark') => void;
}
const ThemeContext = createContext<ThemeContextType | null>(null);
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is required.');
  return value;
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRef = useRef<Settings>({ theme: { mode: 'system' } });
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const stop = window.desktop?.onSettingsChanged(value => {
      receivedUpdate = true;
      settingsRef.current = value;
      setSettings(value);
    });
    invoke<Settings>('get_settings').then(value => {
      if (!active || receivedUpdate) return;
      // The theme is Light or Dark. A profile still set to "system" (the
      // old default) takes the operating system's current choice once and
      // keeps it from then on.
      const mode = value.theme?.mode;
      if (mode !== 'light' && mode !== 'dark') {
        const resolved = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        value = { ...value, theme: { ...value.theme, mode: resolved } };
        void invoke('update_settings', { patch: { theme: value.theme } }).catch(() => {});
      }
      settingsRef.current = value;
      setSettings(value);
    }).catch(error => {
      if (active) { setSettings(settingsRef.current); toast.error(`Could not load settings: ${error}`); }
    });
    return () => { active = false; stop?.(); };
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);
  const patch = useCallback((changes: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...changes };
    settingsRef.current = next;
    setSettings(next);
    void invoke('update_settings', { patch: changes }).catch(error => toast.error(`Could not save settings: ${error}`));
  }, []);
  const theme = settings?.theme?.mode || 'system';
  const resolvedTheme = theme === 'system' ? systemTheme : theme;
  const fonts = { ...defaultEditorFontSettings, ...settings?.editorFont };
  const width = settings?.editorWidth === 'custom' ? 'custom' : 'full';
  const zoom = Math.min(2, Math.max(0.5, settings?.interfaceZoom ?? 1));
  const storedIconScale = settings?.toolbarIconScale;
  const toolbarIconScale: 1 | 1.5 | 2 = storedIconScale === 2 || storedIconScale === 1.5 ? storedIconScale : 1;
  const customWidth = settings?.customEditorWidthPx ?? 768;
  const smartTypography = settings?.smartTypography !== false;
  const colorsLight = settings?.customColorsLight || {};
  const colorsDark = settings?.customColorsDark || {};
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.setProperty('--editor-font-family', fontCss(fonts));
    root.style.setProperty('--editor-text-zoom', String(zoom));
    root.style.setProperty('--editor-base-font-size', `${fonts.baseFontSize * zoom}px`);
    root.style.setProperty('--editor-source-font-size', `${14 * zoom}px`);
    root.style.setProperty('--editor-bold-weight', String(fonts.boldWeight));
    root.style.setProperty('--editor-line-height', String(fonts.lineHeight));
    // Heading 4 remains halfway between Heading 3 and body text in size.
    [2, 1.5, 1.25, 1.125, 1, 1].forEach((scale, index) => root.style.setProperty(`--editor-h${index + 1}-size`, `${fonts.baseFontSize * scale * zoom}px`));
    root.style.setProperty('--editor-paragraph-spacing', '0.875em');
    root.style.setProperty('--editor-max-width', width === 'custom' ? `${customWidth}px` : '100%');
    const activeColors = resolvedTheme === 'light' ? colorsLight : colorsDark;
    for (const [key, value] of Object.entries(defaultThemeColors[resolvedTheme])) root.style.setProperty(`--color-${key}`, activeColors[key as ThemeColorKey] ?? value);
    void invoke('set_title_bar_theme', { isDark: resolvedTheme === 'dark' }).catch(() => {});
  }, [settings, resolvedTheme]);
  if (!settings) return null;
  function setColor(mode: 'light' | 'dark', key: ThemeColorKey, value?: string) {
    const settingKey = mode === 'light' ? 'customColorsLight' : 'customColorsDark';
    const colors = { ...settingsRef.current[settingKey] };
    if (value === undefined) delete colors[key]; else colors[key] = value;
    patch({ [settingKey]: colors });
  }
  return <ThemeContext.Provider value={{
    startupBehavior: settings.startupBehavior === 'new' ? 'new' : 'restore',
    setStartupBehavior: value => patch({ startupBehavior: value }),
    theme, resolvedTheme, setTheme: value => patch({ theme: { mode: value } }),
    editorFontSettings: fonts,
    setEditorFontSetting: (key, value) => patch({ editorFont: { ...defaultEditorFontSettings, ...settingsRef.current.editorFont, [key]: value } }),
    resetEditorFontSettings: () => patch({ editorFont: defaultEditorFontSettings, smartTypography: true }),
    textDirection: 'auto', editorWidth: width, setEditorWidth: value => patch({ editorWidth: value }),
    interfaceZoom: zoom, setInterfaceZoom: value => {
      const current = settingsRef.current.interfaceZoom ?? 1;
      const next = typeof value === 'function' ? value(current) : value;
      patch({ interfaceZoom: Math.round(Math.min(2, Math.max(0.5, next)) * 20) / 20 });
    },
    toolbarIconScale, setToolbarIconScale: value => patch({ toolbarIconScale: value }),
    resetInterfaceSettings: () => patch({ editorWidth: 'full', interfaceZoom: 1, toolbarIconScale: 1, customEditorWidthPx: 768 }),
    smartTypography, setSmartTypography: value => patch({ smartTypography: value }),
    customEditorWidthPx: customWidth,
    setCustomEditorWidthPx: value => patch({ editorWidth: 'custom', customEditorWidthPx: Math.max(480, Math.min(3840, value)) }),
    setEditorMaxWidthLive: value => document.documentElement.style.setProperty('--editor-max-width', value),
    customColorsLight: colorsLight, customColorsDark: colorsDark,
    setCustomColor: (mode, key, value) => setColor(mode, key, value),
    resetCustomColor: (mode, key) => setColor(mode, key),
    resetAllCustomColors: mode => patch({ [mode === 'light' ? 'customColorsLight' : 'customColorsDark']: {} }),
  }}>{children}</ThemeContext.Provider>;
}
