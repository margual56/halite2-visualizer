import type { Replay } from '../parser';
import { playerColor } from './colors';

/**
 * Combat events are not stored in the replay — they are derived from turn
 * diffs, computed once per replay and looked up by turn number at render
 * time, so scrubbing/stepping works.
 */

// A ship present in turn N-1 but absent in turn N explodes at turn N.
export interface DeathEvent {
	x: number;
	y: number;
	color: string;
}
const deathCache = new WeakMap<Replay, Map<number, DeathEvent[]>>();

// A ship whose health dropped (or that vanished) between turn N-1 and N was
// hit during turn N. Any enemy ship within combat range is treated as an
// attacker and gets a beam drawn.
export interface AttackEvent {
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

export function getDeathsByTurn(replay: Replay): Map<number, DeathEvent[]> {
	let byTurn = deathCache.get(replay);
	if (byTurn) return byTurn;
	byTurn = new Map();
	for (let i = 1; i < replay.turns.length; i++) {
		const curr = replay.turns[i];
		const currIds = new Set(curr.ships.map((s) => s.id));
		for (const ship of replay.turns[i - 1].ships) {
			if (currIds.has(ship.id)) continue;
			let list = byTurn.get(curr.turn);
			if (!list) {
				list = [];
				byTurn.set(curr.turn, list);
			}
			list.push({ x: ship.x, y: ship.y, color: playerColor(replay, ship.ownerId) });
		}
	}
	deathCache.set(replay, byTurn);
	return byTurn;
}

export function getAttacksByTurn(replay: Replay): Map<number, AttackEvent[]> {
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
						c.died && c.ownerId !== v.ownerId && Math.hypot(c.x - v.x, c.y - v.y) < COLLISION_RANGE
				);
				if (rammed) continue;
			}
			for (const a of combatants) {
				if (a.ownerId === v.ownerId) continue;
				if (Math.hypot(a.x - v.x, a.y - v.y) > ATTACK_RANGE) continue;
				events.push({
					attackerId: a.id,
					victimId: v.id,
					ax: a.x,
					ay: a.y,
					vx: v.x,
					vy: v.y,
					color: playerColor(replay, a.ownerId)
				});
			}
		}
		if (events.length > 0) byTurn.set(curr.turn, events);
	}
	attackCache.set(replay, byTurn);
	return byTurn;
}
