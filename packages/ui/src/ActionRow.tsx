import { Button } from './Button';
import { Kbd } from './Kbd';

export function ActionRow({
  icon,
  label,
  shortcut,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onPress={onPress}
      className="flex w-72 items-center gap-3 px-4 py-3 text-fg-faint hover:bg-hover hover:text-fg-muted"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left font-mono text-base">{label}</span>
      {shortcut != null && <Kbd>{shortcut}</Kbd>}
    </Button>
  );
}
