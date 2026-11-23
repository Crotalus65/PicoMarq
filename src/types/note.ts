export interface NoteMetadata {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  path: string;
  modified: number;
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
}

export type FontFamily = "system-sans" | "serif" | "monospace" | "system-font";
export type TextDirection = "auto" | "ltr" | "rtl";
export type EditorWidth = "full" | "custom";
export type StartupBehavior = 'restore' | 'new';

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  systemFontFamily?: string;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
  lineHeight?: number; // default 1.6
}

// Customizable theme color keys (maps to CSS --color-* variables)
export type ThemeColorKey =
  | "bg"
  | "bg-secondary"
  | "bg-muted"
  | "bg-emphasis"
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "bold"
  | "italic"
  | "text-muted"
  | "border"
  | "accent"
  | "selection";

// Partial map of color overrides (hex strings)
export type CustomColors = Partial<Record<ThemeColorKey, string>>;

// Appearance settings, saved separately from document files.
export interface Settings {
  theme: ThemeSettings;
  /** Behavior on the next launch; existing profiles default to restore. */
  startupBehavior?: StartupBehavior;
  editorFont?: EditorFontSettings;
  editorWidth?: EditorWidth;
  customEditorWidthPx?: number;
  interfaceZoom?: number;
  toolbarIconScale?: 1 | 1.5 | 2;
  /** Curly quotes, em dashes and ellipses as you type (default on). */
  smartTypography?: boolean;
  customColorsLight?: CustomColors;
  customColorsDark?: CustomColors;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteMetadata[];
}
