import { RotateCcw } from 'lucide-react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { Button } from '../components/ui/button';
import { cn } from '@/lib/utils';

interface ViewerResetButtonProps {
  onReset: () => void;
  /** Mirror: larger target, reachable by the hand-gesture pointer. */
  handControl?: boolean;
}

/** "Reset view" control pinned to the top-right corner of a 3D viewer. */
export function ViewerResetButton({ onReset, handControl = false }: ViewerResetButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size={handControl ? 'lg' : 'sm'}
      data-testid="viewer-reset"
      aria-label="Reset view"
      title="Reset view"
      {...(handControl ? { [MIRROR_GESTURE_TARGET_ATTR]: 'true' } : {})}
      className={cn('absolute top-3 right-3 z-10', handControl && 'text-base')}
      onClick={onReset}
    >
      <RotateCcw aria-hidden="true" />
      Reset
    </Button>
  );
}
