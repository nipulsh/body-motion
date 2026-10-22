import { cn } from '@/lib/utils';

export function GridPattern({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]',
        className,
      )}
    >
      <div className="absolute inset-0 bg-black" />
    </div>
  );
}
