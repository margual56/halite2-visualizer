export interface PlayerHeader {
	id: number;
	name: string;
}

export interface PlanetHeader {
	id: number;
	x: number;
	y: number;
	size: number;
	initialHalite: number;
	dockingSpots: number;
}

export interface ShipRecord {
	id: number;
	ownerId: number;
	x: number;
	y: number;
	health: number;
	state: number; // 0=UNDOCKED 1=DOCKING 2=DOCKED 3=UNDOCKING
	planetId: number;
}

export interface PlanetRecord {
	id: number;
	halite: number;
	dockedCount: number;
}

export interface TurnRecord {
	turn: number;
	ships: ShipRecord[];
	planets: PlanetRecord[]; // same count as planets header, keyed by id
}

export interface Replay {
	width: number;
	height: number;
	players: PlayerHeader[];
	planets: PlanetHeader[];
	turns: TurnRecord[];
	/** maps owner_id → player slot index (for coloring) */
	playerIndex: Map<number, number>;
}

function r8(view: DataView, off: number, ctx: string): number {
	if (off + 1 > view.byteLength)
		throw new Error(`[off=${off}] out of bounds reading u8 for ${ctx} (file=${view.byteLength}b)`);
	return view.getUint8(off);
}
function r32(view: DataView, off: number, ctx: string): number {
	if (off + 4 > view.byteLength)
		throw new Error(`[off=${off}] out of bounds reading u32 for ${ctx} (file=${view.byteLength}b)`);
	return view.getUint32(off, true);
}
function r64(view: DataView, off: number, ctx: string): number {
	if (off + 8 > view.byteLength)
		throw new Error(`[off=${off}] out of bounds reading f64 for ${ctx} (file=${view.byteLength}b)`);
	return view.getFloat64(off, true);
}

export function parseReplay(buffer: ArrayBuffer): Replay {
	const view = new DataView(buffer);
	let off = 0;

	const magic = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3)
	);
	off = 4;
	if (magic !== 'HLT2') throw new Error(`Invalid magic: "${magic}" (expected "HLT2")`);

	const _version = r8(view, off++, 'version');

	const width = r32(view, off, 'width'); off += 4;
	const height = r32(view, off, 'height'); off += 4;

	const nPlayers = r8(view, off++, 'nPlayers');
	console.log(`[parser] ${view.byteLength}b file, ${nPlayers} players`);
	const players: PlayerHeader[] = [];
	for (let i = 0; i < nPlayers; i++) {
		const id = r32(view, off, `player[${i}].id`); off += 4;
		const nameBytes = new Uint8Array(buffer, off, 16); off += 16;
		const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim();
		players.push({ id, name });
	}

	const nPlanets = r32(view, off, 'nPlanets'); off += 4;
	{
		const hex = (start: number, len: number) =>
			Array.from(new Uint8Array(buffer, start, Math.min(len, buffer.byteLength - start)))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join(' ');
		console.log(`[parser] nPlayers=${nPlayers} off=${off} nPlanets=${nPlanets}`);
		console.log(`[parser] bytes@0:  ${hex(0, 20)}`);
		console.log(`[parser] bytes@13: ${hex(13, 10)} (nPlayers byte + player[0].id)`);
		console.log(`[parser] bytes@${off - 4}: ${hex(off - 4, 8)} (raw nPlanets u32 + next)`);
	}
	if (nPlanets > 500)
		throw new Error(
			`[off=${off}] implausible nPlanets=${nPlanets} — likely a format mismatch. ` +
				`Expected ≤ 100. Check that the engine was rebuilt after the latest replay.zig changes.`
		);
	const planets: PlanetHeader[] = [];
	for (let i = 0; i < nPlanets; i++) {
		const id = r32(view, off, `planet[${i}].id`); off += 4;
		const x = r64(view, off, `planet[${i}].x`); off += 8;
		const y = r64(view, off, `planet[${i}].y`); off += 8;
		const size = r64(view, off, `planet[${i}].size`); off += 8;
		const initialHalite = r64(view, off, `planet[${i}].halite`); off += 8;
		const dockingSpots = r8(view, off++, `planet[${i}].dockingSpots`);
		planets.push({ id, x, y, size, initialHalite, dockingSpots });
	}

	console.log(`[parser] off=${off} after planet headers, starting turns`);
	const turns: TurnRecord[] = [];
	while (off < view.byteLength) {
		const remaining = view.byteLength - off;
		if (remaining < 8) {
			console.warn(`[parser] ${remaining} trailing bytes at off=${off}, stopping`);
			break;
		}
		const turn = r32(view, off, 'turn'); off += 4;
		const nShips = r32(view, off, 'nShips'); off += 4;

		if (nShips > 100_000) throw new Error(`[off=${off}] implausible nShips=${nShips} at turn ${turn}`);

		const ships: ShipRecord[] = [];
		for (let i = 0; i < nShips; i++) {
			const id = r32(view, off, `ship[${i}].id`); off += 4;
			const ownerId = r32(view, off, `ship[${i}].ownerId`); off += 4;
			const x = r64(view, off, `ship[${i}].x`); off += 8;
			const y = r64(view, off, `ship[${i}].y`); off += 8;
			const health = r8(view, off++, `ship[${i}].health`);
			const state = r8(view, off++, `ship[${i}].state`);
			const planetId = r32(view, off, `ship[${i}].planetId`); off += 4;
			ships.push({ id, ownerId, x, y, health, state, planetId });
		}

		const planetRecords: PlanetRecord[] = [];
		for (let i = 0; i < nPlanets; i++) {
			const id = r32(view, off, `turnPlanet[${i}].id`); off += 4;
			const halite = r64(view, off, `turnPlanet[${i}].halite`); off += 8;
			const dockedCount = r8(view, off++, `turnPlanet[${i}].dockedCount`);
			planetRecords.push({ id, halite, dockedCount });
		}

		turns.push({ turn, ships, planets: planetRecords });
	}

	console.log(`[parser] done: ${turns.length} turns parsed`);
	const playerIndex = new Map(players.map((p, i) => [p.id, i]));
	return { width, height, players, planets, turns, playerIndex };
}
