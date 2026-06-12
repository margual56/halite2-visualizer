import type { PlanetHeader, TurnRecord } from '../parser';

/**
 * Persistent dock-slot assignment.
 *
 * Halite II model: each planet has `capacity` evenly-spaced slots around its
 * rim (0..capacity-1). When a ship first enters docking state it claims the
 * free slot nearest to its approach angle, and holds it until it undocks or
 * dies. This is render-side state (the replay doesn't record slots), so it is
 * rebuilt as the replay plays; scrubbing far backwards may reassign slots.
 */

// Per-ship last known approach angle (arrival side) during free flight
const shipApproachAngle = new Map<number, number>();
// Per-ship assigned dock slot: { planetId, slot index }
const shipDockSlot = new Map<number, { planetId: number; slot: number }>();
// Occupied slots: key = "planetId:slotIndex" → shipId
const planetSlotOccupancy = new Map<string, number>();

interface PrevShipState {
	x: number;
	y: number;
	state: number;
}

/**
 * Advance the dock-slot state for this turn and return each docking/docked
 * ship's rim angle (radians), keyed by ship id.
 */
export function updateDockSlots(
	currTurn: TurnRecord,
	prevPositions: Map<number, PrevShipState>,
	planetById: Map<number, PlanetHeader>
): Map<number, number> {
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

	// --- Release slots for ships that are no longer docking or no longer alive ---
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

	// --- Assign slots to newly-docking ships ---
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

	// --- Resolve assigned slots to rim angles ---
	const dockAngles = new Map<number, number>();
	for (const [shipId, { planetId, slot }] of shipDockSlot) {
		const planet = planetById.get(planetId);
		if (!planet) continue;
		const capacity = Math.floor(planet.size);
		dockAngles.set(shipId, (2 * Math.PI * slot) / capacity);
	}
	return dockAngles;
}
