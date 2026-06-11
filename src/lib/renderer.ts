import type { Replay, TurnRecord } from './parser';

export const PLAYER_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308'];
const BG = '#080C18';
const PLANET_EMPTY = { r: 30, g: 32, b: 48 };
const PLANET_FULL = { r: 58, g: 180, b: 200 };
const GRID_COLOR = 'rgba(255,255,255,0.04)';
const SHIP_SIZE = 18; // triangle "radius" in screen pixels

interface Transform {
	scale: number;
	ox: number;
	oy: number;
}

function makeTransform(cw: number, ch: number, mw: number, mh: number, margin = 24): Transform {
	const scale = Math.min((cw - margin * 2) / mw, (ch - margin * 2) / mh);
	return {
		scale,
		ox: (cw - scale * mw) / 2,
		oy: (ch - scale * mh) / 2
	};
}

function wx(gx: number, t: Transform) {
	return t.ox + gx * t.scale;
}
function wy(gy: number, t: Transform) {
	return t.oy + gy * t.scale;
}

function lerpColor(
	a: { r: number; g: number; b: number },
	b: { r: number; g: number; b: number },
	alpha: number
) {
	return `rgb(${Math.round(a.r + (b.r - a.r) * alpha)},${Math.round(a.g + (b.g - a.g) * alpha)},${Math.round(a.b + (b.b - a.b) * alpha)})`;
}

function drawShipTriangle(
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

	// Triangle body
	ctx.beginPath();
	ctx.moveTo(SHIP_SIZE, 0); // tip (forward direction)
	ctx.lineTo(-SHIP_SIZE * 0.65, -SHIP_SIZE * 0.55);
	ctx.lineTo(-SHIP_SIZE * 0.65, SHIP_SIZE * 0.55);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();

	// Thin dark outline so triangle reads well against planet fills
	ctx.strokeStyle = 'rgba(0,0,0,0.45)';
	ctx.lineWidth = 0.8;
	ctx.stroke();

	// Health arc (outer ring, dims as health drops)
	if (healthFrac < 0.99) {
		ctx.beginPath();
		ctx.arc(0, 0, SHIP_SIZE + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * healthFrac);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = 0.55;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	// Docking indicator: small white dot at center
	if (docked) {
		ctx.beginPath();
		ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
		ctx.fillStyle = '#fff';
		ctx.fill();
	}

	ctx.restore();
}

/**
 * Render one frame onto the canvas.
 * @param alpha  0 = show prevTurn positions, 1 = show currTurn positions (for interpolation)
 */
export function render(
	ctx: CanvasRenderingContext2D,
	replay: Replay,
	prevTurn: TurnRecord,
	currTurn: TurnRecord,
	alpha: number
) {
	const cw = ctx.canvas.width;
	const ch = ctx.canvas.height;
	const t = makeTransform(cw, ch, replay.width, replay.height);

	// Background
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, cw, ch);

	// Subtle grid
	ctx.strokeStyle = GRID_COLOR;
	ctx.lineWidth = 1;
	const gridStep = replay.width / 10;
	for (let gx = 0; gx <= replay.width; gx += gridStep) {
		ctx.beginPath();
		ctx.moveTo(wx(gx, t), wy(0, t));
		ctx.lineTo(wx(gx, t), wy(replay.height, t));
		ctx.stroke();
	}
	for (let gy = 0; gy <= replay.height; gy += gridStep) {
		ctx.beginPath();
		ctx.moveTo(wx(0, t), wy(gy, t));
		ctx.lineTo(wx(replay.width, t), wy(gy, t));
		ctx.stroke();
	}

	// Build halite lookup from current turn
	const haliteByPlanet = new Map(currTurn.planets.map((p) => [p.id, p.halite]));

	// Planet lookup by id (for docked ship angle computation)
	const planetById = new Map(replay.planets.map((p) => [p.id, p]));

	// Planets
	for (const ph of replay.planets) {
		const halite = haliteByPlanet.get(ph.id) ?? ph.initialHalite;
		const fraction = Math.max(0, Math.min(1, halite / Math.max(0.001, ph.initialHalite)));
		const radius = Math.max(4, ph.size * t.scale);
		const px = wx(ph.x, t);
		const py = wy(ph.y, t);

		// Semi-transparent fill so ships overlapping the planet remain readable
		ctx.beginPath();
		ctx.arc(px, py, radius, 0, Math.PI * 2);
		ctx.fillStyle = lerpColor(PLANET_EMPTY, PLANET_FULL, fraction);
		ctx.globalAlpha = 0.75;
		ctx.fill();
		ctx.globalAlpha = 1;

		// Opaque ring
		ctx.strokeStyle = `rgba(255,255,255,0.2)`;
		ctx.lineWidth = 1;
		ctx.stroke();

		// Docking radius hint (faint dashed)
		ctx.beginPath();
		ctx.arc(px, py, radius + 4 * t.scale, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(255,255,255,0.05)';
		ctx.setLineDash([3, 5]);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Build prev ship position lookup for interpolation
	const prevPositions = new Map(prevTurn.ships.map((s) => [s.id, { x: s.x, y: s.y }]));

	// Ships as triangles
	for (const ship of currTurn.ships) {
		const prev = prevPositions.get(ship.id);
		let sx = prev ? prev.x + (ship.x - prev.x) * alpha : ship.x;
		let sy = prev ? prev.y + (ship.y - prev.y) * alpha : ship.y;

		let angle = 0;
		const isDocked = ship.state === 2;
		const isDocking = ship.state === 1 || ship.state === 3;

		if (isDocked || isDocking) {
			const planet = planetById.get(ship.planetId);
			if (planet) {
				// Collect all ships at this planet, sort by id for a stable order, find this ship's rank
				const siblings = currTurn.ships
					.filter((s) => s.state >= 1 && s.state <= 3 && s.planetId === ship.planetId)
					.sort((a, b) => a.id - b.id);
				const slot = siblings.findIndex((s) => s.id === ship.id);
				const total = siblings.length;
				const slotAngle = (2 * Math.PI * slot) / total;
				const r = planet.size + 1.2;
				sx = planet.x + Math.cos(slotAngle) * r;
				sy = planet.y + Math.sin(slotAngle) * r;
				angle = slotAngle;
			}
		} else if (prev) {
			// Undocked: point in direction of movement
			const dx = ship.x - prev.x;
			const dy = ship.y - prev.y;
			if (dx !== 0 || dy !== 0) angle = Math.atan2(dy, dx);
		}

		const screenX = wx(sx, t);
		const screenY = wy(sy, t);

		const playerIdx = replay.playerIndex.get(ship.ownerId) ?? 0;
		const color = PLAYER_COLORS[playerIdx % PLAYER_COLORS.length];
		const healthFrac = ship.health / 255;

		drawShipTriangle(ctx, screenX, screenY, angle, color, healthFrac, isDocked);
	}

	// Turn number (HUD)
	ctx.font = `bold ${Math.round(12 * (cw / 640))}px monospace`;
	ctx.fillStyle = 'rgba(255,255,255,0.4)';
	ctx.textAlign = 'left';
	ctx.fillText(`Turn ${currTurn.turn}`, t.ox + 4, t.oy - 6);
}
