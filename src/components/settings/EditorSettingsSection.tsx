import { useState, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { invoke } from "../../lib/desktop";
import { useTheme, defaultThemeColors } from "../../context/ThemeContext";
import { Button, IconButton, Input, Select } from "../ui";
import { ColorPicker } from "../ui/ColorPicker";
import type {
  FontFamily,
  EditorWidth,
  ThemeColorKey,
  StartupBehavior,
} from "../../types/note";
import { ChevronRightIcon, MinusIcon, PlusIcon } from "../icons";
import { cn } from "../../lib/utils";

// Human-readable labels for theme color keys, grouped logically
const colorLabels: { key: ThemeColorKey; label: string; group: string }[] = [
  // Surfaces
  { key: "bg", label: "Background", group: "Surfaces" },
  { key: "bg-secondary", label: "Secondary background", group: "Surfaces" },
  { key: "bg-muted", label: "Hover & Subtle Fill", group: "Surfaces" },
  { key: "bg-emphasis", label: "Strong Fill", group: "Surfaces" },
  // Document text colors are editor-only preferences, not Markdown styles.
  { key: "text", label: "Normal paragraph text", group: "Text" },
  { key: "heading-1", label: "Heading 1", group: "Text" },
  { key: "heading-2", label: "Heading 2", group: "Text" },
  { key: "heading-3", label: "Heading 3", group: "Text" },
  { key: "heading-4", label: "Heading 4", group: "Text" },
  { key: "bold", label: "Bold", group: "Text" },
  { key: "italic", label: "Italic", group: "Text" },
  // Interface controls
  { key: "text-muted", label: "Secondary text", group: "UI" },
  { key: "accent", label: "Primary & Buttons", group: "UI" },
  { key: "border", label: "Borders", group: "UI" },
  { key: "selection", label: "Selection Highlight", group: "UI" },
];

// Page width options
const editorWidthOptions: { value: EditorWidth; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" },
];

// Font family options
const fontFamilyOptions: { value: FontFamily; label: string }[] = [
  { value: "system-sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Mono" },
];

// Bold weight options (medium excluded for monospace)
const boldWeightOptions = [
  { value: 500, label: "Medium", excludeForMonospace: true },
  { value: 600, label: "Semibold", excludeForMonospace: false },
  { value: 700, label: "Bold", excludeForMonospace: false },
  { value: 800, label: "Extra Bold", excludeForMonospace: false },
];

// On/off switch styled like the other controls
function Switch({ id, checked, onChange, ...props }: { id: string; checked: boolean; onChange: (value: boolean) => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'id'>) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
        checked ? "bg-accent" : "bg-bg-emphasis",
      )}
      {...props}
    >
      <span className={cn("inline-block h-4.5 w-4.5 rounded-full bg-bg shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}

// A number box that keeps what is typed. Changing the value on every
// keystroke and forcing it into range made typing impossible: the "1" of "18"
// became 12, then "128" became 24. Here a number in range takes effect at once
// (18 applies as soon as the 8 is typed), and anything else waits for Enter or
// for leaving the box, where it is moved into range (or, if it is not a
// number, the current value comes back). The Up and Down keys still step it.
function NumberBox({ value, min, max, wholeNumbers = false, onCommit, ...props }: {
  value: number;
  min: number;
  max: number;
  wholeNumbers?: boolean;
  onCommit: (value: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type">) {
  const [draft, setDraft] = useState(() => String(value));
  // True between the first keystroke and Enter or leaving the box.
  const editingRef = useRef(false);
  // Show changes made elsewhere (Reset to defaults, Load Theme, another
  // window, the page-edge handles) unless the box is being typed in.
  useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    if (!editingRef.current) {
      setDraft(String(value));
      return;
    }
    editingRef.current = false;
    const parsed = parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    let next = Math.min(Math.max(parsed, min), max);
    if (wholeNumbers) next = Math.round(next);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        editingRef.current = true;
        const text = e.target.value;
        setDraft(text);
        const parsed = parseFloat(text);
        if (
          Number.isFinite(parsed) &&
          parsed >= min &&
          parsed <= max &&
          (!wholeNumbers || Number.isInteger(parsed))
        ) {
          onCommit(parsed);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function AppearanceSettingsSection() {
  const {
    startupBehavior,
    setStartupBehavior,
    resolvedTheme,
    setTheme,
    editorFontSettings,
    setEditorFontSetting,
    resetEditorFontSettings,
    editorWidth,
    setEditorWidth,
    interfaceZoom,
    setInterfaceZoom,
    toolbarIconScale,
    setToolbarIconScale,
    resetInterfaceSettings,
    smartTypography,
    setSmartTypography,
    customEditorWidthPx,
    setCustomEditorWidthPx,
    customColorsLight,
    customColorsDark,
    setCustomColor,
    resetCustomColor,
    resetAllCustomColors,
  } = useTheme();

  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [fontError, setFontError] = useState('');
  async function loadFonts(refresh = false) {
    setFontsLoading(true);
    try {
      setSystemFonts(await invoke<string[]>('installed_fonts', { refresh }));
      setFontError('');
    } catch (error) {
      setFontError(error instanceof Error ? error.message : String(error));
    } finally { setFontsLoading(false); }
  }
  useEffect(() => { void loadFonts(); }, []);

  // Validated numeric change handler
  const handleNumericChange = (
    field: "baseFontSize" | "lineHeight",
    value: string,
    min: number,
    max: number,
  ) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(Math.max(parsed, min), max);
    setEditorFontSetting(field, clamped);
  };

  // Check if settings differ from defaults
  const hasCustomFonts =
    editorFontSettings.baseFontFamily !== "system-sans" ||
    editorFontSettings.systemFontFamily !== "" ||
    editorFontSettings.baseFontSize !== 15 ||
    editorFontSettings.boldWeight !== 600 ||
    editorFontSettings.lineHeight !== 1.6 ||
    !smartTypography;
  const hasCustomInterface =
    editorWidth !== "full" ||
    Math.round(interfaceZoom * 100) !== 100 ||
    toolbarIconScale !== 1;

  // Filter weight options based on font family
  const isMonospace = editorFontSettings.baseFontFamily === "monospace";
  const availableWeightOptions = boldWeightOptions.filter(
    (opt) => !isMonospace || !opt.excludeForMonospace,
  );

  // Handle font family change - bump up weight if needed
  const handleFontFamilyChange = (newFamily: FontFamily) => {
    setEditorFontSetting("baseFontFamily", newFamily);
    // If switching to monospace and current weight is medium, bump to semibold
    if (newFamily === "monospace" && editorFontSettings.boldWeight === 500) {
      setEditorFontSetting("boldWeight", 600);
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* Theme Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-3">Theme</h2>
        <div className="flex gap-2 p-1 rounded-[10px] border border-border">
          {(["light", "dark"] as const).map((mode) => (
            <Button
              key={mode}
              onClick={() => setTheme(mode)}
              variant={resolvedTheme === mode ? "primary" : "ghost"}
              size="md"
              className="flex-1"
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
        {/* Customize Colors (for the mode in use) */}
        <ColorsExpandable
          label="Customize colors"
          mode={resolvedTheme}
          customColors={
            resolvedTheme === "dark" ? customColorsDark : customColorsLight
          }
          setCustomColor={setCustomColor}
          resetCustomColor={resetCustomColor}
          resetAllCustomColors={resetAllCustomColors}
          className="mt-4"
        />
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Typography Section */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-medium">Typography</h2>
          {hasCustomFonts && (
            <Button onClick={resetEditorFontSettings} variant="ghost" size="sm">
              Reset to defaults
            </Button>
          )}
        </div>

        <div className="rounded-[10px] border border-border pl-4 py-3 pr-3 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="font-family" className="text-sm text-text font-medium">Font</label>
            <Select id="font-family" aria-label="Font" value={editorFontSettings.baseFontFamily === 'system-font' ? `font:${editorFontSettings.systemFontFamily}` : editorFontSettings.baseFontFamily}
              onChange={e => {
                if (e.target.value.startsWith('font:')) {
                  setEditorFontSetting('systemFontFamily', e.target.value.slice(5));
                  setEditorFontSetting('baseFontFamily', 'system-font');
                } else handleFontFamilyChange(e.target.value as FontFamily);
              }} className="w-64 max-w-[70%]">
              <optgroup label="Defaults">{fontFamilyOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</optgroup>
              <optgroup label="Installed system fonts">
                {editorFontSettings.systemFontFamily && !systemFonts.includes(editorFontSettings.systemFontFamily) && <option value={`font:${editorFontSettings.systemFontFamily}`}>{editorFontSettings.systemFontFamily} (unavailable)</option>}
                {systemFonts.map(name => <option key={name} value={`font:${name}`}>{name}</option>)}
              </optgroup>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
            <span>{fontError || (fontsLoading ? 'Reading installed fonts…' : `${systemFonts.length} installed font families`)}</span>
            <Button size="sm" variant="ghost" onClick={() => loadFonts(true)}>Refresh fonts</Button>
          </div>

          {/* Base Font Size */}
          <div className="flex items-center justify-between">
            <label htmlFor="font-size" className="text-sm text-text font-medium">Point Size (12-24)</label>
            <div className="relative w-40">
              <NumberBox
                id="font-size"
                min={12}
                max={24}
                value={editorFontSettings.baseFontSize}
                onCommit={(size) => setEditorFontSetting("baseFontSize", size)}
                className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Bold Weight */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Bold Weight</label>
            <Select
              value={editorFontSettings.boldWeight}
              onChange={(e) =>
                setEditorFontSetting("boldWeight", Number(e.target.value))
              }
              className="w-40"
            >
              {availableWeightOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Line Height */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Line Height</label>
            <div className="relative w-40">
              <Input
                type="number"
                min="1.0"
                max="2.5"
                step="0.1"
                value={editorFontSettings.lineHeight}
                onChange={(e) =>
                  handleNumericChange("lineHeight", e.target.value, 1.0, 2.5)
                }
                className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Smart Typography */}
          <div className="flex items-center justify-between gap-4 pt-1">
            <div className="min-w-0">
              <label htmlFor="smart-typography" className="text-sm text-text font-medium">Smart Typography</label>
              <p className="text-xs text-text-muted mt-0.5">
                Two hyphens become an em dash, three periods an ellipsis, and straight quotes become curly quotes as you type. Edit &gt; Apply Smart Typography converts an existing document.
              </p>
            </div>
            <Switch id="smart-typography" checked={smartTypography} onChange={setSmartTypography} aria-label="Smart Typography" />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* User Interface Section */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-medium">User Interface</h2>
          {hasCustomInterface && (
            <Button onClick={resetInterfaceSettings} variant="ghost" size="sm">
              Reset to defaults
            </Button>
          )}
        </div>

        <div className="rounded-[10px] border border-border pl-4 py-3 pr-3 space-y-2">
          {/* Page Width */}
          <div className="flex items-center justify-between">
            <label htmlFor="editor-width" className="text-sm text-text font-medium">Page Width</label>
            <Select
              id="editor-width"
              value={editorWidth}
              onChange={(e) => setEditorWidth(e.target.value as EditorWidth)}
              className="w-40"
            >
              {editorWidthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          {editorWidth === "custom" && (
            <div className="flex items-center justify-between">
              <label htmlFor="custom-width" className="text-sm text-text font-medium">
                Custom Width
              </label>
              <div className="relative w-40 flex items-center gap-2">
                <NumberBox
                  id="custom-width"
                  min={480}
                  max={3840}
                  step="10"
                  wholeNumbers
                  value={customEditorWidthPx}
                  onCommit={setCustomEditorWidthPx}
                  className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-text-muted">px</span>
              </div>
            </div>
          )}

          {/* Document Text Zoom */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">
              Text Zoom
            </label>
            <div className="flex items-center gap-1 w-40">
              <IconButton
                variant="outline"
                size="md"
                onClick={() => setInterfaceZoom((prev) => prev - 0.05)}
                disabled={interfaceZoom <= 0.5}
                title="Zoom out"
              >
                <MinusIcon className="w-4 h-4" />
              </IconButton>
              <span className="text-sm font-medium tabular-nums flex-1 text-center">
                {Math.round(interfaceZoom * 100)}%
              </span>
              <IconButton
                variant="outline"
                size="md"
                onClick={() => setInterfaceZoom((prev) => prev + 0.05)}
                disabled={interfaceZoom >= 2}
                title="Zoom in"
              >
                <PlusIcon className="w-4 h-4" />
              </IconButton>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="toolbar-icon-size" className="text-sm text-text font-medium">Icon Size</label>
            <Select id="toolbar-icon-size" value={toolbarIconScale} onChange={event => setToolbarIconScale(event.target.value === '2' ? 2 : event.target.value === '1.5' ? 1.5 : 1)} className="w-40">
              <option value="1">100%</option>
              <option value="1.5">150%</option>
              <option value="2">200%</option>
            </Select>
          </div>
        </div>

      </section>

      <div className="border-t border-border border-dashed" />

      <section>
        <h2 className="text-xl font-medium mb-3">Startup</h2>
        <div className="rounded-[10px] border border-border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="startup-behavior" className="text-sm text-text font-medium">When PicoMarQ starts</label>
            <Select
              id="startup-behavior"
              value={startupBehavior}
              onChange={event => setStartupBehavior(event.target.value as StartupBehavior)}
              aria-describedby="startup-description"
              className="w-64 max-w-full"
            >
              <option value="restore">Restore previous session</option>
              <option value="new">Start new session</option>
            </Select>
          </div>
          <p id="startup-description" className="text-xs text-text-muted">
            Applies the next time PicoMarQ starts. Preferences and recent files are kept. After an unexpected shutdown, unsaved work can still be recovered.
          </p>
        </div>
      </section>

      <div className="border-t border-border border-dashed" />

      <SpellingSection />
    </div>
  );
}

// Words added with Add to Dictionary (right-click a misspelled word) stay in
// the dictionary until they are cleared here. The desktop shell asks first.
function SpellingSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const clearDictionary = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await invoke<{ removed: number; kept?: number; empty?: boolean } | null>('clear_custom_dictionary');
      if (!result) return;
      if (result.empty) setStatus('The custom dictionary is empty.');
      else setStatus(`Removed ${result.removed === 1 ? '1 word' : `${result.removed.toLocaleString()} words`} from the custom dictionary.${result.kept ? ` ${result.kept.toLocaleString()} could not be removed.` : ''}`);
    } catch (error) {
      setStatus(`Could not clear the custom dictionary: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2 className="text-xl font-medium mb-3">Spelling</h2>
      <div className="rounded-[10px] border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-text font-medium">Custom Dictionary</span>
          <Button variant="outline" size="lg" onClick={clearDictionary} disabled={busy} aria-describedby="custom-dictionary-description">
            Clear Custom Dictionary…
          </Button>
        </div>
        <p id="custom-dictionary-description" className="text-xs text-text-muted">
          Removes every word you added with Add to Dictionary, after asking. Those words are marked as misspelled again.
        </p>
        {status && <p data-dictionary-status role="status" aria-live="polite" className="text-xs text-text-muted">{status}</p>}
      </div>
    </section>
  );
}

// Expandable subsection for customizing colors for a single theme mode
function ColorsExpandable({
  label,
  mode,
  customColors,
  setCustomColor,
  resetCustomColor,
  resetAllCustomColors,
  className,
}: {
  label: string;
  mode: "light" | "dark";
  customColors: Partial<Record<ThemeColorKey, string>>;
  setCustomColor: (
    mode: "light" | "dark",
    key: ThemeColorKey,
    value: string,
  ) => void;
  resetCustomColor: (mode: "light" | "dark", key: ThemeColorKey) => void;
  resetAllCustomColors: (mode: "light" | "dark") => void;
  className?: string;
}) {
  const defaults = defaultThemeColors[mode];
  const hasAnyCustom = Object.keys(customColors).length > 0;

  return (
    <details className={cn("text-sm", className)}>
      <summary className="cursor-pointer text-text-muted hover:text-text select-none flex items-center gap-1 font-medium">
        <ChevronRightIcon className="w-3.5 h-3.5 stroke-2 transition-transform [[open]>&]:rotate-90" />
        {label}
        {hasAnyCustom && (
          <Button
            onClick={(e) => {
              e.preventDefault();
              resetAllCustomColors(mode);
            }}
            variant="ghost"
            size="sm"
            className="ml-auto"
          >
            Reset all
          </Button>
        )}
      </summary>
      <div className="mt-2 rounded-[10px] border border-border pl-4 py-3 pr-3 space-y-1.5">
        {(() => {
          let lastGroup = "";
          return colorLabels.map(({ key, label: colorLabel, group }) => {
            const showGroup = group !== lastGroup;
            lastGroup = group;
            return (
              <div key={key}>
                {showGroup && (
                  <div
                    className={`text-base text-text-muted font-medium ${key !== colorLabels[0].key ? "mt-6" : ""} mb-2.5`}
                  >
                    {group}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label className="text-sm text-text font-medium">
                    {colorLabel}
                  </label>
                  <ColorPicker
                    color={customColors[key] ?? defaults[key]}
                    defaultColor={defaults[key]}
                    onChange={(value) => setCustomColor(mode, key, value)}
                    onReset={() => resetCustomColor(mode, key)}
                  />
                </div>
              </div>
            );
          });
        })()}
      </div>
    </details>
  );
}
