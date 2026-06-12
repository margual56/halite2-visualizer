import { hexToRgb } from './colors';

/**
 * Ship sprites from the original Halite II visualizer (MIT licensed):
 * https://github.com/HaliteChallenge/Halite-II — libhaliteviz/assets/ship-neutral.png
 * White-on-transparent art, tinted per player color at load time, like the
 * original did with PIXI sprite tints.
 */
const SHEET_SRC = '/ship-neutral.png';
const FRAMES = {
	ship: { x: 1, y: 1, w: 26, h: 16 },
	beam: { x: 29, y: 1, w: 71, h: 71 },
	aura: { x: 102, y: 1, w: 76, h: 76 },
	trail: { x: 180, y: 1, w: 11, h: 130 } // bright end at y=0
} as const;
type FrameName = keyof typeof FRAMES;

let sheet: HTMLImageElement | null = null;
const tintCache = new Map<string, Record<FrameName, HTMLCanvasElement>>();

/**
 * Ship visual size (sprite edge) in screen px. The original sized ships in
 * world units (0.7 × weapon radius); our engine's planets are smaller than
 * the original's, so we use a smaller world size with a pixel floor.
 */
export function shipSizePx(scale: number): number {
	return Math.max(10, 1.8 * scale);
}

function getTintedFrames(color: string): Record<FrameName, HTMLCanvasElement> | null {
	if (!sheet) {
		sheet = new Image();
		sheet.src = SHEET_SRC;
	}
	if (!sheet.complete || sheet.naturalWidth === 0) return null;
	const cached = tintCache.get(color);
	if (cached) return cached;

	const frames = {} as Record<FrameName, HTMLCanvasElement>;
	for (const name of Object.keys(FRAMES) as FrameName[]) {
		const f = FRAMES[name];
		const c = document.createElement('canvas');
		c.width = f.w;
		c.height = f.h;
		const cctx = c.getContext('2d')!;
		cctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
		// Tint: multiply the white art by the player color, keep original alpha
		cctx.globalCompositeOperation = 'multiply';
		cctx.fillStyle = color;
		cctx.fillRect(0, 0, f.w, f.h);
		cctx.globalCompositeOperation = 'destination-in';
		cctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
		frames[name] = c;
	}
	tintCache.set(color, frames);
	return frames;
}

/**
 * Draw one ship: halo + tinted sprite. As in the original, the halo's alpha
 * is the health indicator (brighter halo = healthier ship).
 * @param angle direction the ship faces, radians, 0 = east
 */
export function drawShip(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	angle: number,
	color: string,
	healthFrac: number,
	sizePx: number
) {
	const frames = getTintedFrames(color);
	if (!frames) {
		drawShipFallback(ctx, sx, sy, angle, color, sizePx);
		return;
	}

	ctx.save();
	ctx.translate(sx, sy);

	// Halo ring — alpha encodes health, like the original's aura
	const auraSize = sizePx * 1.6;
	ctx.globalAlpha = 0.12 + 0.38 * healthFrac;
	ctx.drawImage(frames.aura, -auraSize / 2, -auraSize / 2, auraSize, auraSize);

	// Ship sprite (art points up; our angle convention is 0 = east)
	ctx.rotate(angle + Math.PI / 2);
	ctx.globalAlpha = 1;
	ctx.shadowColor = color;
	ctx.shadowBlur = sizePx * 0.35;
	ctx.drawImage(frames.ship, -sizePx / 2, -sizePx / 2, sizePx, sizePx);

	ctx.restore();
}

/** Triangle stand-in for the first frames while the sprite sheet loads. */
function drawShipFallback(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	angle: number,
	color: string,
	sizePx: number
) {
	const r = sizePx / 2;
	ctx.save();
	ctx.translate(sx, sy);
	ctx.rotate(angle);
	ctx.beginPath();
	ctx.moveTo(r, 0);
	ctx.lineTo(-r * 0.65, -r * 0.55);
	ctx.lineTo(-r * 0.65, r * 0.55);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
}

/**
 * Tractor-beam connector between a docking/docked ship and its planet,
 * reaching 80% of the way like the original's docking arms. Pulses faster
 * and brighter while the ship is actively docking or undocking.
 */
export function drawDockBeam(
	ctx: CanvasRenderingContext2D,
	shipX: number,
	shipY: number,
	planetX: number,
	planetY: number,
	color: string,
	state: number, // 1=DOCKING 2=DOCKED 3=UNDOCKING
	sizePx: number
) {
	const dist = Math.hypot(planetX - shipX, planetY - shipY);
	if (dist < 1) return;

	const tNow = performance.now() / 1000;
	const transferring = state === 1 || state === 3;
	const alpha = transferring ? 0.45 + 0.25 * Math.sin(tNow * 8) : 0.3 + 0.15 * Math.sin(tNow * 3);

	// Rotate so the local +y axis points from the ship toward the planet
	const rot = Math.atan2(planetY - shipY, planetX - shipX) - Math.PI / 2;
	const w = sizePx * 0.55;
	const len = dist * 0.8;

	ctx.save();
	ctx.translate(shipX, shipY);
	ctx.rotate(rot);
	ctx.globalAlpha = Math.max(0.1, alpha);

	const frames = getTintedFrames(color);
	if (frames) {
		ctx.drawImage(frames.beam, -w / 2, 0, w, len);
	} else {
		const { r, g, b } = hexToRgb(color);
		const grad = ctx.createLinearGradient(0, 0, 0, len);
		grad.addColorStop(0, `rgba(${r},${g},${b},0.8)`);
		grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.strokeStyle = grad;
		ctx.lineWidth = w * 0.4;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(0, len);
		ctx.stroke();
	}
	ctx.restore();
}

/** Exhaust trail from last turn's position to the ship's current one. */
export function drawShipTrail(
	ctx: CanvasRenderingContext2D,
	tailX: number,
	tailY: number,
	headX: number,
	headY: number,
	color: string,
	sizePx: number
) {
	const dx = headX - tailX;
	const dy = headY - tailY;
	const dist = Math.hypot(dx, dy);
	if (dist <= 2) return;

	const frames = getTintedFrames(color);
	if (frames) {
		// Rotate so the local +y axis points backward (head → tail);
		// the sprite's bright end (y=0) sits just behind the ship.
		const rot = Math.atan2(tailY - headY, tailX - headX) - Math.PI / 2;
		ctx.save();
		ctx.translate(headX, headY);
		ctx.rotate(rot);
		ctx.globalAlpha = 0.55;
		ctx.drawImage(frames.trail, -sizePx * 0.14, sizePx * 0.3, sizePx * 0.28, dist * 0.9);
		ctx.restore();
		return;
	}

	const { r, g, b } = hexToRgb(color);
	const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
	grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
	grad.addColorStop(1, `rgba(${r},${g},${b},0.4)`);
	ctx.save();
	ctx.strokeStyle = grad;
	ctx.lineWidth = sizePx * 0.15;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(tailX, tailY);
	ctx.lineTo(headX, headY);
	ctx.stroke();
	ctx.restore();
}
