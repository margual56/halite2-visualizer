import type { Replay, TurnRecord } from './parser';
import { drawBackground, drawGrid } from './render/background';
import { playerColor } from './render/colors';
import { updateDockSlots } from './render/docking';
import { drawAttackBeams, drawExplosions } from './render/effects';
import { drawHud } from './render/hud';
import { drawDockingHint, drawPlanet, planetVisualSize } from './render/planets';
import { drawShipTrail, drawShipTriangle } from './render/ships';
import { makeTransform, wx, wy } from './render/transform';

export { PLAYER_COLORS } from './render/colors';

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

	drawBackground(ctx, cw, ch);
	drawGrid(ctx, replay.width, replay.height, t);

	// --- Per-turn lookups ---
	const haliteByPlanet = new Map(currTurn.planets.map((p) => [p.id, p.halite]));
	const planetById = new Map(replay.planets.map((p) => [p.id, p]));

	// Halite fraction (0–1) per planet — drives both visual radius and orbit radius
	const haliteFracByPlanet = new Map(
		replay.planets.map((p) => {
			const halite = haliteByPlanet.get(p.id) ?? p.initialHalite;
			return [p.id, Math.max(0, Math.min(1, halite / Math.max(0.001, p.initialHalite)))];
		})
	);

	// A planet is "owned" by whichever player has ships docked/docking there.
	const planetOwner = new Map<number, string>(); // planetId -> CSS color
	for (const ship of currTurn.ships) {
		if (ship.state >= 1 && ship.state <= 3 && !planetOwner.has(ship.planetId)) {
			planetOwner.set(ship.planetId, playerColor(replay, ship.ownerId));
		}
	}

	// --- Planets ---
	for (const ph of replay.planets) {
		const haliteFrac = haliteFracByPlanet.get(ph.id) ?? 1;
		const radius = Math.max(4, planetVisualSize(ph.size, haliteFrac) * t.scale);
		const px = wx(ph.x, t);
		const py = wy(ph.y, t);

		drawPlanet(ctx, px, py, radius, ph.id, planetOwner.get(ph.id) ?? null, haliteFrac);
		drawDockingHint(ctx, px, py, radius, t);
	}

	// --- Dock slots ---
	const prevPositions = new Map(
		prevTurn.ships.map((s) => [s.id, { x: s.x, y: s.y, state: s.state }])
	);
	const dockAngles = updateDockSlots(currTurn, prevPositions, planetById);

	// --- Explosions (under the ships) ---
	drawExplosions(ctx, replay, currTurn.turn, alpha, t);

	// --- Ships ---
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
			const dockAngle = dockAngles.get(ship.id);
			if (planet && dockAngle !== undefined) {
				// Sit on the planet's (halite-shrunk) rim at the assigned slot angle
				const orbit = planetVisualSize(planet.size, haliteFracByPlanet.get(planet.id) ?? 1);
				sx = planet.x + Math.cos(dockAngle) * orbit;
				sy = planet.y + Math.sin(dockAngle) * orbit;
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

		const color = playerColor(replay, ship.ownerId);

		// Engine trail: fading exhaust from last turn's position to here
		if (!isDockingOrDocked && prev) {
			drawShipTrail(ctx, wx(prev.x, t), wy(prev.y, t), screenX, screenY, color);
		}

		drawShipTriangle(ctx, screenX, screenY, angle, color, ship.health / 255, isDocked);
	}

	// --- Attack beams (over the ships) ---
	drawAttackBeams(ctx, replay, currTurn.turn, alpha, t, shipScreenPos);

	drawHud(ctx, replay, currTurn);
}
