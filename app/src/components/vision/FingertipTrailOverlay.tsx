import { useEffect, useRef } from 'react';
import type { TrailPoint } from '../../hooks/useExerciseHandTrail';

interface FingertipTrailOverlayProps {
  trail: TrailPoint[];
  className?: string;
}

export function FingertipTrailOverlay({ trail, className }: FingertipTrailOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (trail.length < 2) {
        if (trail.length === 1) {
          const point = trail[0]!;
          ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
          ctx.beginPath();
          ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(trail[0]!.x, trail[0]!.y);
      for (let i = 1; i < trail.length; i += 1) {
        ctx.lineTo(trail[i]!.x, trail[i]!.y);
      }
      ctx.stroke();

      const tip = trail[trail.length - 1]!;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
      ctx.fill();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [trail]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
      aria-hidden
      data-testid="fingertip-trail-overlay"
    />
  );
}
