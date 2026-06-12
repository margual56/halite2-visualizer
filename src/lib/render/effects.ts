import type { Replay } from '../parser';
import { getAttacksByTurn, getDeathsByTurn } from './events';
import { shipSizePx } from './ships';
import { wx, wy, type Transform } from './transform';

const EXPLOSION_TURNS = 3; // how many turns an explosion lingers

/**
 * Draw any death that happened within the last EXPLOSION_TURNS turns, with
 * progress derived from the current fractional turn time.
 */
export function drawExplosions(
	ctx: CanvasRenderingContext2D,
	replay: Replay,
	currTurnNumber: number,
	alpha: number,
	t: Transform
) {
	const deathsByTurn = getDeathsByTurn(replay);
	const now = currTurnNumber + alpha;
	for (let back = 0; back < EXPLOSION_TURNS; back++) {
		const deathTurn = currTurnNumber - back;
		const deaths = deathsByTurn.get(deathTurn);
		if (!deaths) continue;
		const progress = (now - deathTurn) / EXPLOSION_TURNS;
		if (progress < 0 || progress >= 1) continue;

		const maxR = shipSizePx(t.scale) * 1.75; // screen px
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
}

/**
 * Draw this turn's attack beams between the live interpolated ship positions.
 * Beams fade in and out within the turn (peak at mid-interpolation).
 */
export function drawAttackBeams(
	ctx: CanvasRenderingContext2D,
	replay: Replay,
	currTurnNumber: number,
	alpha: number,
	t: Transform,
	shipScreenPos: Map<number, { x: number; y: number }>
) {
	const attacks = getAttacksByTurn(replay).get(currTurnNumber);
	if (!attacks) return;
	const intensity = Math.sin(alpha * Math.PI);
	if (intensity <= 0.02) return;

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
