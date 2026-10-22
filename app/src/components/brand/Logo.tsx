import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-lg border border-white/20 bg-black text-primary">
        <Activity className="size-5" />
      </span>
      <span className="text-base font-semibold tracking-tight">Body Motion</span>
    </div>
  );
}
