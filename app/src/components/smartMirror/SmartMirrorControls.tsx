import { Tv } from 'lucide-react';
import type { ConnectedDisplay } from '../../display/smartMirrorDisplay';
import type { MirrorPhase } from '../../display/mirrorWindow';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

export function SmartMirrorControls({
  phase,
  error,
  choices,
  collapsed,
  onOpen,
  onClose,
  onChoose,
}: {
  phase: MirrorPhase;
  error: string | null;
  choices: ConnectedDisplay[];
  collapsed: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChoose: (displayId: string) => void;
}) {
  const open = phase === 'closed';
  const label = open ? 'Open Smart Mirror' : phase === 'open' ? 'Close Smart Mirror' : 'Cancel mirror';

  return (
    <div className={cn('flex flex-col gap-2', collapsed && 'items-center')}>
      <Button
        type="button"
        variant={open ? 'secondary' : 'outline'}
        className={cn('justify-start gap-2.5', collapsed && 'size-10 justify-center px-0')}
        title={error ?? label}
        aria-label={label}
        onClick={open ? onOpen : onClose}
      >
        <Tv className="size-4 shrink-0" />
        {collapsed ? null : label}
      </Button>
      {!collapsed && choices.length > 0 ? (
        <div className="flex flex-col gap-1">
          {choices.map((display) => (
            <Button
              key={display.id}
              type="button"
              variant="ghost"
              className="h-9 justify-start px-2 text-left"
              onClick={() => onChoose(display.id)}
            >
              {display.name ?? display.id}
              {' · '}
              {display.width}×{display.height}
            </Button>
          ))}
        </div>
      ) : null}
      {!collapsed && error ? (
        <p className="px-1 text-xs text-muted-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
