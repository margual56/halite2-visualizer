import type { Replay, TurnRecord } from './parser';

export const PLAYER_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308'];
const GRID_COLOR = 'rgba(255,255,255,0.04)';
const SHIP_SIZE = 14; // triangle "radius" in screen pixels

// Cached planet texture images — each planet picks one by id hash
const PLANET_TEXTURE_SRCS = ['/planet.png', '/planet2.png', '/planet3.png'];
let planetTextureCache: HTMLImageElement[] | null = null;

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

// Explosions are derived deterministically from the replay: a ship present in
// turn N-1 but absent in turn N explodes at turn N. Computed once per replay
// and looked up by turn number at render time, so scrubbing/stepping works.
interface DeathEvent {
	x: number;
	y: number;
	color: string;
}
const deathCache = new WeakMap<Replay, Map<number, DeathEvent[]>>();
const EXPLOSION_TURNS = 3; // how many turns the explosion lingers

function getDeathsByTurn(replay: Replay): Map<number, DeathEvent[]> {
	let byTurn = deathCache.get(replay);
	if (byTurn) return byTurn;
	byTurn = new Map();
	for (let i = 1; i < replay.turns.length; i++) {
		const curr = replay.turns[i];
		const currIds = new Set(curr.ships.map((s) => s.id));
		for (const ship of replay.turns[i - 1].ships) {
			if (currIds.has(ship.id)) continue;
			const playerIdx = replay.playerIndex.get(ship.ownerId) ?? 0;
			let list = byTurn.get(curr.turn);
			if (!list) {
				list = [];
				byTurn.set(curr.turn, list);
			}
			list.push({ x: ship.x, y: ship.y, color: PLAYER_COLORS[playerIdx % PLAYER_COLORS.length] });
		}
	}
	deathCache.set(replay, byTurn);
	return byTurn;
}

// Attacks are likewise derived from the replay: a ship whose health dropped
// (or that vanished) between turn N-1 and N was hit during turn N. Any enemy
// ship within combat range is treated as an attacker and gets a beam drawn.
interface AttackEvent {
	attackerId: number;
	victimId: number;
	// Fallback world coords in case either ship is gone this turn
	ax: number;
	ay: number;
	vx: number;
	vy: number;
	color: string;
}
const attackCache = new WeakMap<Replay, Map<number, AttackEvent[]>>();
// The engine resolves combat per 5×5 spatial cell, so two fighting ships can
// be up to one cell diagonal (~7.1 units) apart.
const ATTACK_RANGE = 7.2;
// Two enemy ships closer than this that both die collided (ram), not shot.
const COLLISION_RANGE = 1.5;

function getAttacksByTurn(replay: Replay): Map<number, AttackEvent[]> {
	let byTurn = attackCache.get(replay);
	if (byTurn) return byTurn;
	byTurn = new Map();
	for (let i = 1; i < replay.turns.length; i++) {
		const prev = replay.turns[i - 1];
		const curr = replay.turns[i];
		const prevById = new Map(prev.ships.map((s) => [s.id, s]));
		const currById = new Map(curr.ships.map((s) => [s.id, s]));

		// Every ship that could have dealt damage this turn, at its last known position
		const combatants: { id: number; ownerId: number; x: number; y: number; died: boolean }[] =
			curr.ships.map((s) => ({ id: s.id, ownerId: s.ownerId, x: s.x, y: s.y, died: false }));
		for (const p of prev.ships) {
			if (!currById.has(p.id))
				combatants.push({ id: p.id, ownerId: p.ownerId, x: p.x, y: p.y, died: true });
		}

		// Victims: lost health this turn, or vanished entirely
		const victims = combatants.filter((c) => {
			if (c.died) return true;
			const p = prevById.get(c.id);
			return p !== undefined && currById.get(c.id)!.health < p.health;
		});
		if (victims.length === 0) continue;

		const events: AttackEvent[] = [];
		for (const v of victims) {
			// Mutual ramming deaths show explosions only, no beams
			if (v.died) {
				const rammed = combatants.some(
					(c) =>
						c.died &&
						c.ownerId !== v.ownerId &&
						Math.hypot(c.x - v.x, c.y - v.y) < COLLISION_RANGE
				);
				if (rammed) continue;
			}
			for (const a of combatants) {
				if (a.ownerId === v.ownerId) continue;
				if (Math.hypot(a.x - v.x, a.y - v.y) > ATTACK_RANGE) continue;
				const playerIdx = replay.playerIndex.get(a.ownerId) ?? 0;
				events.push({
					attackerId: a.id,
					victimId: v.id,
					ax: a.x,
					ay: a.y,
					vx: v.x,
					vy: v.y,
					color: PLAYER_COLORS[playerIdx % PLAYER_COLORS.length]
				});
			}
		}
		if (events.length > 0) byTurn.set(curr.turn, events);
	}
	attackCache.set(replay, byTurn);
	return byTurn;
}

// --- Starfield background ---
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

function drawBackground(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
	// Deep-space radial gradient instead of a flat fill
	const g = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
	g.addColorStop(0, '#0b1126');
	g.addColorStop(0.6, '#070b18');
	g.addColorStop(1, '#04060d');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, cw, ch);

	// Twinkling stars
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

function getPlanetTextures(): HTMLImageElement[] {
	if (!planetTextureCache) {
		planetTextureCache = PLANET_TEXTURE_SRCS.map((src) => {
			const img = new Image();
			img.src = src;
			return img;
		});
	}
	return planetTextureCache;
}

/**
 * Deterministic per-planet hash (u32) — drives texture choice and rotation
 * so each planet always looks the same.
 */
function planetHash(planetId: number): number {
	// xorshift-style hash
	let h = planetId ^ 0xdeadbeef;
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	return (h ^ (h >>> 16)) >>> 0;
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
	const textures = getPlanetTextures();
	const h = planetHash(planetId);
	const texture = textures[(h >>> 3) % textures.length];

	ctx.save();

	// --- Clip to circle ---
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.clip();

	// --- Base color disc ---
	// The textures are black planets with white crater rims, so the color comes
	// from a solid tinted disc and the texture is added on top with "screen".
	// Neutral/undocked planets get a cool grey-blue; owned ones the player color.
	const tintColor = ownerColor ?? '#aab9d4';

	// Halite-based saturation: full halite = full tint, depleted = grey.
	const { r, g, b } = hexToRgb(tintColor);
	const grey = 152;
	const mix = 0.35 + haliteFraction * 0.65; // range 0.35–1.0
	// Darken the base so the screened white details read as lit relief
	const base = 0.55;
	const tr = Math.round((grey + (r - grey) * mix) * base);
	const tg = Math.round((grey + (g - grey) * mix) * base);
	const tb = Math.round((grey + (b - grey) * mix) * base);

	ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.fill();

	// --- Texture detail (screen blend lights up crater rims and sheen) ---
	if (texture.complete && texture.naturalWidth > 0) {
		const angle = (h / 0xffffffff) * Math.PI * 2;
		// Scale texture so it fills the diameter (2*radius), with a tiny 5% overshoot
		// so rotation never reveals a gap at the edges.
		const texSize = radius * 2 * 1.05;
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(angle);
		ctx.globalCompositeOperation = 'screen';
		ctx.globalAlpha = 0.85;
		ctx.drawImage(texture, -texSize / 2, -texSize / 2, texSize, texSize);
		ctx.restore();
	}

	// --- Sphere shading: soft light from the upper-left, shadow at lower-right ---
	const shade = ctx.createRadialGradient(
		px - radius * 0.45,
		py - radius * 0.45,
		radius * 0.1,
		px,
		py,
		radius * 1.35
	);
	shade.addColorStop(0, 'rgba(255,255,255,0.28)');
	shade.addColorStop(0.5, 'rgba(255,255,255,0)');
	shade.addColorStop(1, 'rgba(0,0,0,0.4)');
	ctx.fillStyle = shade;
	ctx.beginPath();
	ctx.arc(px, py, radius, 0, Math.PI * 2);
	ctx.fill();

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

	// Background: deep-space gradient + twinkling starfield
	drawBackground(ctx, cw, ch);

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
	// Draw any death that happened within the last EXPLOSION_TURNS turns,
	// with progress derived from the current fractional turn time.
	const deathsByTurn = getDeathsByTurn(replay);
	const now = currTurn.turn + alpha;
	for (let back = 0; back < EXPLOSION_TURNS; back++) {
		const deathTurn = currTurn.turn - back;
		const deaths = deathsByTurn.get(deathTurn);
		if (!deaths) continue;
		const progress = (now - deathTurn) / EXPLOSION_TURNS;
		if (progress < 0 || progress >= 1) continue;

		const maxR = SHIP_SIZE * 3.5; // screen px
		const r = maxR * progress;
		const opacity = (1 - progress) * 0.85;

		for (const ex of deaths) {
			const screenX = wx(ex.x, t);
			const screenY = wy(ex.y, t);

			ctx.save();
			// Outer fading ring
			ctx.shadowColor = ex.color;
			ctx.shadowBlur = 10;
			ctx.beginPath();
			ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
			ctx.strokeStyle = ex.color;
			ctx.lineWidth = 2.5 * (1 - progress * 0.7);
			ctx.globalAlpha = opacity;
			ctx.stroke();

			// Inner bright flash (only in first half)
			if (progress < 0.5) {
				const flashR = maxR * 0.5 * (1 - progress * 2);
				ctx.beginPath();
				ctx.arc(screenX, screenY, flashR, 0, Math.PI * 2);
				ctx.fillStyle = ex.color;
				ctx.globalAlpha = (0.5 - progress) * 1.5;
				ctx.fill();

				// White-hot core
				ctx.beginPath();
				ctx.arc(screenX, screenY, flashR * 0.45, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.globalAlpha = (0.5 - progress) * 1.2;
				ctx.fill();
			}
			ctx.restore();
		}
	}

	// Ships as triangles
	// Interpolated screen position per ship id, for the attack-beam pass below
	const shipScreenPos = new Map<number, { x: number; y: number }>();
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
		shipScreenPos.set(ship.id, { x: screenX, y: screenY });

		const playerIdx = replay.playerIndex.get(ship.ownerId) ?? 0;
		const color = PLAYER_COLORS[playerIdx % PLAYER_COLORS.length];
		const healthFrac = ship.health / 255;

		// Engine trail: fading exhaust from last turn's position to here
		if (!isDockingOrDocked && prev) {
			const tailX = wx(prev.x, t);
			const tailY = wy(prev.y, t);
			const dx = screenX - tailX;
			const dy = screenY - tailY;
			if (dx * dx + dy * dy > 4) {
				const { r, g, b } = hexToRgb(color);
				const grad = ctx.createLinearGradient(tailX, tailY, screenX, screenY);
				grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
				grad.addColorStop(1, `rgba(${r},${g},${b},0.4)`);
				ctx.save();
				ctx.strokeStyle = grad;
				ctx.lineWidth = SHIP_SIZE * 0.3;
				ctx.lineCap = 'round';
				ctx.beginPath();
				ctx.moveTo(tailX, tailY);
				ctx.lineTo(screenX, screenY);
				ctx.stroke();
				ctx.restore();
			}
		}

		drawShipTriangle(ctx, screenX, screenY, angle, color, healthFrac, isDocked);
	}

	// --- Attack beams ---
	// Beams fade in and out within the turn (peak at mid-interpolation), drawn
	// between the live interpolated ship positions.
	const attacks = getAttacksByTurn(replay).get(currTurn.turn);
	if (attacks) {
		const intensity = Math.sin(alpha * Math.PI);
		if (intensity > 0.02) {
			for (const ev of attacks) {
				const a = shipScreenPos.get(ev.attackerId) ?? { x: wx(ev.ax, t), y: wy(ev.ay, t) };
				const v = shipScreenPos.get(ev.victimId) ?? { x: wx(ev.vx, t), y: wy(ev.vy, t) };

				ctx.save();
				// Weapon-range flash around the attacker
				ctx.globalAlpha = 0.06 * intensity;
				ctx.fillStyle = ev.color;
				ctx.beginPath();
				ctx.arc(a.x, a.y, 3.5 * t.scale, 0, Math.PI * 2);
				ctx.fill();

				// The beam itself
				ctx.globalAlpha = 0.8 * intensity;
				ctx.strokeStyle = ev.color;
				ctx.lineWidth = 1.6;
				ctx.shadowColor = ev.color;
				ctx.shadowBlur = 8;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(v.x, v.y);
				ctx.stroke();

				// Impact spark on the victim
				ctx.shadowColor = '#ffffff';
				ctx.shadowBlur = 12;
				ctx.fillStyle = '#ffffff';
				ctx.globalAlpha = 0.9 * intensity;
				ctx.beginPath();
				ctx.arc(v.x, v.y, 1.8 + 1.6 * intensity, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();
			}
		}
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
