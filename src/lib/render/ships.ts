import { hexToRgb } from './colors';

export const SHIP_SIZE = 14; // triangle "radius" in screen pixels

export function drawShipTriangle(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	angle: number,
	color: string,
	healthFrac: number,
	docked: boolean
) {
	ctx.save();
	ctx.translate(sx, sy);
	ctx.rotate(angle);

	// Triangle body, with a soft glow in the player color
	ctx.beginPath();
	ctx.moveTo(SHIP_SIZE, 0);
	ctx.lineTo(-SHIP_SIZE * 0.65, -SHIP_SIZE * 0.55);
	ctx.lineTo(-SHIP_SIZE * 0.65, SHIP_SIZE * 0.55);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.shadowColor = color;
	ctx.shadowBlur = SHIP_SIZE * 0.7;
	ctx.fill();
	ctx.shadowBlur = 0;

	ctx.strokeStyle = 'rgba(0,0,0,0.45)';
	ctx.lineWidth = 0.8;
	ctx.stroke();

	if (healthFrac < 0.99) {
		ctx.beginPath();
		ctx.arc(0, 0, SHIP_SIZE + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * healthFrac);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = 0.55;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	if (docked) {
		ctx.beginPath();
		ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
		ctx.fillStyle = '#fff';
		ctx.fill();
	}

	ctx.restore();
}

/** Fading exhaust trail from last turn's position to the ship's current one. */
export function drawShipTrail(
	ctx: CanvasRenderingContext2D,
	tailX: number,
	tailY: number,
	headX: number,
	headY: number,
	color: string
) {
	const dx = headX - tailX;
	const dy = headY - tailY;
	if (dx * dx + dy * dy <= 4) return;

	const { r, g, b } = hexToRgb(color);
	const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
	grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
	grad.addColorStop(1, `rgba(${r},${g},${b},0.4)`);
	ctx.save();
	ctx.strokeStyle = grad;
	ctx.lineWidth = SHIP_SIZE * 0.3;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(tailX, tailY);
	ctx.lineTo(headX, headY);
	ctx.stroke();
	ctx.restore();
}
