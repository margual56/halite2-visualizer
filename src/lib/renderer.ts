import type { Replay, TurnRecord } from './parser';

export const PLAYER_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308'];
const BG = '#080C18';
const GRID_COLOR = 'rgba(255,255,255,0.04)';
const SHIP_SIZE = 18; // triangle "radius" in screen pixels

// Cached planet texture image
let planetTextureCache: HTMLImageElement | null = null;

/**
 * Persistent per-ship dock angle (radians), keyed by ship id.
 * Populated from the ship's last free-flight heading the turn it begins docking,
 * and held for as long as the ship remains docked/docking/undocking.
 * Cleared when a ship is no longer present in the turn data.
 */
// Per-ship last known approach angle (arrival side) during free flight
const shipApproachAngle = new Map<number, number>();
// Per-ship assigned dock slot: { planetId, slot index }
const shipDockSlot = new Map<number, { planetId: number; slot: number }>();
// Occupied slots: key = "planetId:slotIndex" → shipId
const planetSlotOccupancy = new Map<string, number>();

// Active explosions: { x, y, color, age } where age goes 0→1 over EXPLOSION_TURNS turns
interface Explosion {
	x: number;
	y: number;
	color: string;
	age: number;
}
const explosions: Explosion[] = [];
const EXPLOSION_TURNS = 3; // how many turns the explosion lingers

function getPlanetTexture(): HTMLImageElement {
	if (!planetTextureCache) {
		const img = new Image();
		img.src = '/planet.png';
		planetTextureCache = img;
	}
	return planetTextureCache;
}

/**
 * Seeded pseudo-random rotation angle per planet id (returns radians 0–2π).
 * Uses a simple integer hash so each planet always gets the same rotation.
 */
function planetRotation(planetId: number): number {
	// xorshift-style hash
	let h = planetId ^ 0xdeadbeef;
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	h = (h ^ (h >>> 16)) >>> 0;
	return (h / 0xffffffff) * Math.PI * 2;
}

/**
 * Parse a CSS hex color (#RRGGBB) into {r, g, b} components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const n = parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

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

/**
 * Draw a planet using planet.png as a height/bump map.
 *
 * Steps:
 *  1. Clip to planet circle.
 *  2. Draw the greyscale texture (scaled + randomly rotated around planet center).
 *  3. Overlay a solid tint using "multiply" blend:
 *       • grey  (#8090a0) when undocked / neutral
 *       • player color when any ships are docked / docking there
 *     The multiply blend preserves the texture's light/dark detail.
 *  4. Restore clip.
 */
function drawPlanet(
	ctx: CanvasRenderingContext2D,
	px: number,
	py: number,
	radius: number,
	planetId: number,
	ownerColor: string | null,
	haliteFraction: number
) {
	const texture = getPlanetTexture();

	ctx.save();

	// --- Clip to circle ---
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.clip();

	// --- Draw rotated texture ---
	const angle = planetRotation(planetId);
	// Scale texture so it fills the diameter (2*radius), with a tiny 5% overshoot
	// so rotation never reveals a gap at the edges.
	const texSize = radius * 2 * 1.05;

	ctx.save();
	ctx.translate(px, py);
	ctx.rotate(angle);
	ctx.globalAlpha = 1;

	if (texture.complete && texture.naturalWidth > 0) {
		ctx.drawImage(texture, -texSize / 2, -texSize / 2, texSize, texSize);
	} else {
		// Fallback while texture is loading: solid mid-grey circle
		ctx.fillStyle = '#505060';
		ctx.fillRect(-texSize / 2, -texSize / 2, texSize, texSize);

		// Re-attach onload so subsequent frames pick it up automatically
		if (!texture.onload) {
			texture.onload = () => {
				// Nothing needed – next render() call will use the loaded image
			};
		}
	}
	ctx.restore();

	// --- Tint overlay (multiply blend) ---
	// "multiply" darkens by the tint color while keeping texture contrast.
	// Neutral/undocked planets get a cool grey-blue; owned ones get the player color.
	const tintColor = ownerColor ?? '#7888a8';

	// Halite-based brightness: full halite = fully saturated tint, empty = desaturated.
	// We achieve this by mixing the tint toward grey as halite depletes.
	const { r, g, b } = hexToRgb(tintColor);
	const grey = 128;
	const mix = 0.35 + haliteFraction * 0.65; // range 0.35–1.0
	const tr = Math.round(grey + (r - grey) * mix);
	const tg = Math.round(grey + (g - grey) * mix);
	const tb = Math.round(grey + (b - grey) * mix);

	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = 0.92;
	ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.fill();

	// Reset composite mode before the glow
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;

	ctx.restore(); // removes clip

	// --- Outer ring (on top of clip so it's always crisp) ---
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.strokeStyle = ownerColor
		? `${ownerColor}88` // colored ring for owned
		: 'rgba(255,255,255,0.18)';
	ctx.lineWidth = ownerColor ? 2 : 1;
	ctx.stroke();

	// --- Docking radius hint (faint dashed) ---
	// Reuse the outer transform (no active clip here)
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
	ctx.moveTo(SHIP_SIZE, 0);
	ctx.lineTo(-SHIP_SIZE * 0.65, -SHIP_SIZE * 0.55);
	ctx.lineTo(-SHIP_SIZE * 0.65, SHIP_SIZE * 0.55);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();

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

	// Halite fraction (0–1) per planet — drives both visual radius and orbit radius
	const haliteFracByPlanet = new Map(
		replay.planets.map((p) => {
			const halite = haliteByPlanet.get(p.id) ?? p.initialHalite;
			return [p.id, Math.max(0, Math.min(1, halite / Math.max(0.001, p.initialHalite)))];
		})
	);

	// Planet lookup by id (for docked ship angle computation)
	const planetById = new Map(replay.planets.map((p) => [p.id, p]));

	// --- Determine planet ownership from docked/docking ships ---
	// A planet is "owned" by whichever player has ships docked/docking there.
	// If multiple players somehow share (shouldn't happen in Halite II but just in case),
	// we pick the first one found.
	const planetOwner = new Map<number, string>(); // planetId -> CSS color
	for (const ship of currTurn.ships) {
		const isDocked = ship.state === 2;
		const isDocking = ship.state === 1 || ship.state === 3;
		if (isDocked || isDocking) {
			if (!planetOwner.has(ship.planetId)) {
				const playerIdx = replay.playerIndex.get(ship.ownerId) ?? 0;
				planetOwner.set(ship.planetId, PLAYER_COLORS[playerIdx % PLAYER_COLORS.length]);
			}
		}
	}

	// Planets
	for (const ph of replay.planets) {
		const halite = haliteByPlanet.get(ph.id) ?? ph.initialHalite;
		const fraction = Math.max(0, Math.min(1, halite / Math.max(0.001, ph.initialHalite)));
		const haliteFrac = Math.max(0, Math.min(1, halite / Math.max(0.001, ph.initialHalite)));
		const radius = Math.max(4, ph.size * t.scale * (0.4 + 0.6 * haliteFrac));
		const px = wx(ph.x, t);
		const py = wy(ph.y, t);
		const ownerColor = planetOwner.get(ph.id) ?? null;

		drawPlanet(ctx, px, py, radius, ph.id, ownerColor, fraction);

		// Docking radius hint (faint dashed, outside the clip region)
		ctx.beginPath();
		ctx.arc(px, py, radius + 4 * t.scale, 0, Math.PI * 2);
		ctx.strokeStyle = 'rgba(255,255,255,0.05)';
		ctx.setLineDash([3, 5]);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Build prev ship position lookup for interpolation + state tracking
	const prevPositions = new Map(
		prevTurn.ships.map((s) => [s.id, { x: s.x, y: s.y, state: s.state }])
	);

	// On the first turn, wipe any stale state from a previous replay load.
	if (currTurn.turn <= 1) {
		shipApproachAngle.clear();
		shipDockSlot.clear();
		planetSlotOccupancy.clear();
		explosions.length = 0;
	}

	// --- Track free-flight approach angles ---
	// Every turn a ship moves freely, record the direction it came FROM
	// (opposite of travel vector) so it's ready when docking begins.
	for (const ship of currTurn.ships) {
		if (ship.state !== 0) continue;
		const prev = prevPositions.get(ship.id);
		if (prev && (ship.x !== prev.x || ship.y !== prev.y)) {
			const travelAngle = Math.atan2(ship.y - prev.y, ship.x - prev.x);
			shipApproachAngle.set(ship.id, travelAngle + Math.PI); // arrival side
		}
	}

	// --- Assign dock slots ---
	// Halite II model: each planet has `capacity` evenly-spaced slots (0..capacity-1).
	// When a ship first enters docking state it claims the nearest free slot to its
	// approach angle. That slot is held until the ship leaves or is destroyed.

	// Release slots for ships that are no longer docking or no longer alive
	const liveShipIds = new Set(currTurn.ships.map((s) => s.id));
	const dockingShipIds = new Set(
		currTurn.ships.filter((s) => s.state >= 1 && s.state <= 3).map((s) => s.id)
	);
	for (const [shipId, { planetId, slot }] of shipDockSlot) {
		if (!liveShipIds.has(shipId) || !dockingShipIds.has(shipId)) {
			planetSlotOccupancy.delete(`${planetId}:${slot}`);
			shipDockSlot.delete(shipId);
		}
	}
	shipApproachAngle.forEach((_, id) => {
		if (!liveShipIds.has(id)) shipApproachAngle.delete(id);
	});

	// Assign slots to newly-docking ships
	for (const ship of currTurn.ships) {
		if (ship.state < 1 || ship.state > 3) continue;
		if (shipDockSlot.has(ship.id)) continue; // already assigned

		const planet = planetById.get(ship.planetId);
		if (!planet) continue;

		const capacity = Math.floor(planet.size);
		const slotAngles = Array.from({ length: capacity }, (_, i) => (2 * Math.PI * i) / capacity);

		// Approach angle: use stored free-flight angle, or fall back to prev→planet vector
		let approachAngle = shipApproachAngle.get(ship.id);
		if (approachAngle === undefined) {
			const prev = prevPositions.get(ship.id);
			if (prev) {
				approachAngle = Math.atan2(prev.y - planet.y, prev.x - planet.x);
			} else {
				approachAngle = Math.atan2(ship.y - planet.y, ship.x - planet.x);
			}
		}

		// Shortest angular distance between two angles
		const angDist = (a: number, b: number) =>
			Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

		// Find nearest free slot
		let bestSlot = -1;
		let bestDist = Infinity;
		for (let s = 0; s < capacity; s++) {
			if (planetSlotOccupancy.has(`${ship.planetId}:${s}`)) continue;
			const d = angDist(approachAngle, slotAngles[s]);
			if (d < bestDist) {
				bestDist = d;
				bestSlot = s;
			}
		}
		// Fallback: all slots full — pick nearest regardless
		if (bestSlot === -1) {
			for (let s = 0; s < capacity; s++) {
				const d = angDist(approachAngle, slotAngles[s]);
				if (d < bestDist) {
					bestDist = d;
					bestSlot = s;
				}
			}
		}

		planetSlotOccupancy.set(`${ship.planetId}:${bestSlot}`, ship.id);
		shipDockSlot.set(ship.id, { planetId: ship.planetId, slot: bestSlot });
	}

	// Build finalDockAngle from assigned slots
	const finalDockAngle = new Map<number, number>();
	for (const [shipId, { planetId, slot }] of shipDockSlot) {
		const planet = planetById.get(planetId);
		if (!planet) continue;
		const capacity = Math.floor(planet.size);
		finalDockAngle.set(shipId, (2 * Math.PI * slot) / capacity);
	}

	// --- Explosions ---
	// Detect ships that existed last turn but are gone this turn (killed)
	const currShipIds = new Set(currTurn.ships.map((s) => s.id));
	for (const prev of prevTurn.ships) {
		if (!currShipIds.has(prev.id)) {
			// Ship died — spawn explosion at its last known position
			const playerIdx = replay.playerIndex.get(prev.ownerId) ?? 0;
			const color = PLAYER_COLORS[playerIdx % PLAYER_COLORS.length];
			explosions.push({ x: prev.x, y: prev.y, color, age: 0 });
		}
	}

	// Draw and age existing explosions
	for (let i = explosions.length - 1; i >= 0; i--) {
		const ex = explosions[i];
		// Progress within this turn: explosions created this turn start at alpha,
		// older ones are further along
		const progress = Math.min(1, (ex.age + alpha) / EXPLOSION_TURNS);
		const screenX = wx(ex.x, t);
		const screenY = wy(ex.y, t);

		// Outer fading ring
		const maxR = (SHIP_SIZE * 3.5 * t.scale) / t.scale; // in screen px
		const r = maxR * progress;
		const opacity = (1 - progress) * 0.85;

		ctx.save();
		ctx.beginPath();
		ctx.arc(screenX, screenY, r * t.scale, 0, Math.PI * 2);
		ctx.strokeStyle = ex.color;
		ctx.lineWidth = 2.5 * (1 - progress * 0.7);
		ctx.globalAlpha = opacity;
		ctx.stroke();

		// Inner bright flash (only in first half)
		if (progress < 0.5) {
			const flashR = maxR * 0.5 * (1 - progress * 2) * t.scale;
			ctx.beginPath();
			ctx.arc(screenX, screenY, flashR, 0, Math.PI * 2);
			ctx.fillStyle = ex.color;
			ctx.globalAlpha = (0.5 - progress) * 1.5;
			ctx.fill();
		}
		ctx.restore();

		// Age by one turn when alpha wraps (i.e. on the canonical frame, not interpolated)
		if (alpha >= 1) {
			ex.age += 1;
			if (ex.age >= EXPLOSION_TURNS) explosions.splice(i, 1);
		}
	}

	// Ships as triangles
	for (const ship of currTurn.ships) {
		const prev = prevPositions.get(ship.id);
		let sx = prev ? prev.x + (ship.x - prev.x) * alpha : ship.x;
		let sy = prev ? prev.y + (ship.y - prev.y) * alpha : ship.y;

		let angle = 0;
		const isDocked = ship.state === 2;
		const isDockingOrDocked = ship.state >= 1 && ship.state <= 3;

		if (isDockingOrDocked) {
			const planet = planetById.get(ship.planetId);
			const dockAngle = finalDockAngle.get(ship.id);
			if (planet && dockAngle !== undefined) {
				// Orbit in game units: planet surface radius + small gap
				const halite = haliteByPlanet.get(planet.id) ?? planet.initialHalite;
				const haliteFrac = Math.max(0, Math.min(1, halite / Math.max(0.001, planet.initialHalite)));
				const visualSize = planet.size * (0.4 + 0.6 * haliteFrac);
				sx = planet.x + Math.cos(dockAngle) * visualSize;
				sy = planet.y + Math.sin(dockAngle) * visualSize;
				angle = dockAngle;
			}
			// If no angle yet (e.g. very first docking frame), leave sx/sy at
			// interpolated position — it'll snap into place next frame.
		} else if (prev) {
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

	// --- HUD ---
	const hudScale = cw / 640;
	const lineH = Math.round(18 * hudScale);
	const pad = Math.round(12 * hudScale);

	// Turn number
	ctx.font = `bold ${Math.round(12 * hudScale)}px monospace`;
	ctx.fillStyle = 'rgba(255,255,255,0.4)';
	ctx.textAlign = 'left';
	ctx.fillText(`Turn ${currTurn.turn}`, pad, pad + lineH * 0.8);

	// Scoreboard — one row per player, top-right corner
	const isGameOver = currTurn.turn === replay.turns[replay.turns.length - 1].turn;

	// Build live ship counts from current turn
	const liveShipCount = new Map<number, number>();
	for (const ship of currTurn.ships) {
		liveShipCount.set(ship.ownerId, (liveShipCount.get(ship.ownerId) ?? 0) + 1);
	}

	ctx.textAlign = 'right';
	const scoreX = cw - pad;
	let scoreY = pad + lineH * 0.8;
	const fontSize = Math.round(11 * hudScale);
	ctx.font = `bold ${fontSize}px monospace`;

	for (let i = 0; i < replay.players.length; i++) {
		const player = replay.players[i];
		const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
		const ships = liveShipCount.get(player.id) ?? 0;

		let label: string;
		if (isGameOver && replay.rankings) {
			const r = replay.rankings.find((r) => r.playerId === player.id);
			if (r) {
				const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
				label = `${medal} ${player.name}  ✦${r.shipCount}  ◈${Math.round(r.resources)}`;
			} else {
				label = `${player.name}  ✦${ships}`;
			}
		} else {
			label = `${player.name}  ✦${ships}`;
		}

		// Background pill
		const textW = ctx.measureText(label).width;
		const pillH = lineH * 1.1;
		const pillW = textW + pad * 1.5;
		const pillX = scoreX - pillW;
		const pillY = scoreY - lineH * 0.8;

		ctx.save();
		ctx.globalAlpha = 0.55;
		ctx.fillStyle = '#0a0e1a';
		ctx.beginPath();
		ctx.roundRect(pillX, pillY, pillW, pillH, 4);
		ctx.fill();
		ctx.globalAlpha = 1;

		// Left color bar
		ctx.fillStyle = color;
		ctx.fillRect(pillX, pillY, 3, pillH);
		ctx.restore();

		// Text
		ctx.fillStyle = color;
		ctx.fillText(label, scoreX - pad * 0.5, scoreY);

		scoreY += lineH * 1.3;
	}
}
