import { AppearanceSettingsSection } from './EditorSettingsSection';
import { IconButton } from '../ui';
import { ArrowLeftIcon } from '../icons';
interface SettingsPageProps { onBack: () => void }
export function SettingsPage({ onBack }: SettingsPageProps) {
  return <div className="h-full flex flex-col bg-bg w-full">
    <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border select-none">
      <IconButton onClick={onBack} title="Back to document (Ctrl+,)" aria-label="Back to document"><ArrowLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" /></IconButton>
      <span className="font-medium text-sm">Settings</span>
    </header>
    <div className="flex-1 overflow-auto scrollbar-gutter-stable"><div className="w-full max-w-3xl mx-auto px-6 pb-8">
      <AppearanceSettingsSection />
    </div></div>
  </div>;
}
