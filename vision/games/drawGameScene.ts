import type { Bird } from './birdFlight';
import { drawBirds } from './drawBirds';
import type { CanvasPoint } from './playerMarker';

export function drawPlayerMarker(
  ctx: CanvasRenderingContext2D,
  player: CanvasPoint,
  pulse: boolean,
): void {
  ctx.save();
  ctx.fillStyle = pulse ? 'rgba(52, 211, 153, 0.95)' : 'rgba(250, 204, 21, 0.9)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(player.x, player.y, pulse ? 16 : 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawBirdHighlight(ctx: CanvasRenderingContext2D, bird: Bird): void {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawBalanceBirdScene(
  ctx: CanvasRenderingContext2D,
  birds: readonly Bird[],
  player: CanvasPoint | null,
  balanced: boolean,
  pulsePlayer: boolean,
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  drawBirds(ctx, birds);
  if (player) {
    for (const bird of birds) {
      if (balanced && Math.hypot(bird.x - player.x, bird.y - player.y) < 72) {
        drawBirdHighlight(ctx, bird);
      }
    }
    drawPlayerMarker(ctx, player, pulsePlayer);
  }
}
