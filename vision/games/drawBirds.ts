import type { Bird } from './birdFlight';

export function drawBirds(
  ctx: CanvasRenderingContext2D,
  birds: readonly Bird[],
): void {
  for (const bird of birds) {
    const wing = Math.sin(bird.wingPhase) * 6;
    ctx.save();
    ctx.translate(bird.x, bird.y);
    if (bird.direction < 0) ctx.scale(-1, 1);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(14, 165, 233, 1)';
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(28, -4);
    ctx.lineTo(28, 4);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -4 - wing);
    ctx.lineTo(-18, -10 - wing);
    ctx.moveTo(-6, 4 + wing);
    ctx.lineTo(-18, 10 + wing);
    ctx.stroke();

    ctx.restore();
  }
}
