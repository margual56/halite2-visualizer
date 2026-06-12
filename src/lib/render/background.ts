import { wx, wy, type Transform } from './transform';

const GRID_COLOR = 'rgba(255,255,255,0.04)';

// --- Starfield ---
interface Star {
	x: number; // 0–1 fraction of canvas
	y: number;
	r: number; // radius in screen px
	a: number; // base alpha
	phase: number;
	speed: number;
	tint: string;
}
let starCache: Star[] | null = null;

/** Deterministic PRNG so the starfield is identical every load. */
function mulberry32(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let z = s;
		z = Math.imul(z ^ (z >>> 15), z | 1);
		z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
		return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
	};
}

function getStars(): Star[] {
	if (starCache) return starCache;
	const rnd = mulberry32(0x48414c49);
	const TINTS = ['#ffffff', '#ffffff', '#ffffff', '#aaccff', '#ffeecc'];
	starCache = Array.from({ length: 320 }, () => ({
		x: rnd(),
		y: rnd(),
		r: 0.4 + rnd() * rnd() * 1.5,
		a: 0.12 + rnd() * 0.5,
		phase: rnd() * Math.PI * 2,
		speed: 0.3 + rnd() * 1.8,
		tint: TINTS[Math.floor(rnd() * TINTS.length)]
	}));
	return starCache;
}

/** Deep-space gradient + twinkling starfield. */
export function drawBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
	const g = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
	g.addColorStop(0, '#0b1126');
	g.addColorStop(0.6, '#070b18');
	g.addColorStop(1, '#04060d');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, cw, ch);

	const tNow = performance.now() / 1000;
	ctx.save();
	for (const s of getStars()) {
		const twinkle = 0.65 + 0.35 * Math.sin(tNow * s.speed + s.phase);
		ctx.globalAlpha = s.a * twinkle;
		ctx.fillStyle = s.tint;
		ctx.beginPath();
		ctx.arc(s.x * cw, s.y * ch, s.r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

/** Subtle 10×10 grid over the map area. */
export function drawGrid(ctx: CanvasRenderingContext2D, mw: number, mh: number, t: Transform) {
	ctx.strokeStyle = GRID_COLOR;
	ctx.lineWidth = 1;
	const gridStep = mw / 10;
	for (let gx = 0; gx <= mw; gx += gridStep) {
		ctx.beginPath();
		ctx.moveTo(wx(gx, t), wy(0, t));
		ctx.lineTo(wx(gx, t), wy(mh, t));
		ctx.stroke();
	}
	for (let gy = 0; gy <= mh; gy += gridStep) {
		ctx.beginPath();
		ctx.moveTo(wx(0, t), wy(gy, t));
		ctx.lineTo(wx(mw, t), wy(gy, t));
		ctx.stroke();
	}
}
