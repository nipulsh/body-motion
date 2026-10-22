import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MirrorPortraitCardProps {
  children: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Full-screen shell for Smart Mirror flows. Fills the kiosk stage, which is
 * software-rotated 90° left on a landscape laptop/TV.
 */
export const MirrorPortraitCard = forwardRef<HTMLDivElement, MirrorPortraitCardProps>(
  function MirrorPortraitCard({ children, className, testId }, ref) {
    return (
      <div
        ref={ref}
        data-testid={testId}
        className={cn(
          'relative flex h-full min-h-full w-full max-w-none flex-col bg-black text-white',
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
