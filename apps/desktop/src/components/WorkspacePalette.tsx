import type { Workspace } from '@superagent/db';

export interface WorkspacePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}

export function WorkspacePalette({ isOpen, onClose }: WorkspacePaletteProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="presentation">
      <div style={{ background: '#161622', border: '1px solid #2a2a3e', borderRadius: '10px', padding: '24px', color: 'var(--text-muted)' }}>
        Palette placeholder — will be implemented in Task 5
      </div>
    </div>
  );
}
