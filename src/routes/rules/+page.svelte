<script lang="ts">
	import SiteHeader from '$lib/components/SiteHeader.svelte';

	const pageTitle = 'Game Rules — Halite II Replay Visualizer';
	const pageDescription =
		'How Halite II works: ships, planets, docking, mining, combat and win conditions — the game mechanics of the open-source Zig engine, explained for bot writers.';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href="https://halite2.pages.dev/rules" />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://halite2.pages.dev/rules" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:image" content="https://halite2.pages.dev/planet.png" />
</svelte:head>

<div class="flex h-screen flex-col bg-gray-950 text-white">
	<SiteHeader active="/rules" />

	<main class="min-h-0 flex-1 overflow-y-auto">
		<article class="mx-auto max-w-2xl space-y-8 px-6 py-10">
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-white">Halite&nbsp;II game rules</h1>
				<p class="mt-2 text-sm text-white/60">
					The mechanics implemented by the
					<a
						href="https://github.com/margual56/halite2"
						class="text-teal-400 hover:underline"
						target="_blank"
						rel="noopener">Zig engine</a
					>, condensed for bot writers. Numbers below are the engine defaults.
				</p>
			</div>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">The map &amp; turns</h2>
				<p class="text-sm leading-relaxed text-white/60">
					Matches are played by 2–4 bots on a rectangular map over at most
					<strong class="text-white/80">200 turns</strong>. Each player starts with
					<strong class="text-white/80">3 ships</strong>. Every turn, each bot receives the full
					game state and replies with one command per ship. All commands are resolved
					simultaneously.
				</p>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Ships</h2>
				<ul class="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-white/60">
					<li><strong class="text-white/80">255 health</strong>, radius 0.5 units.</li>
					<li>
						Move with a thrust command: integer speed
						<strong class="text-white/80">0–7 units/turn</strong> and integer angle 0–359°.
					</li>
					<li>
						Two ships closer than <strong class="text-white/80">1.0 units</strong> collide — both are
						destroyed instantly. Ramming is a legitimate (if costly) tactic.
					</li>
				</ul>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Planets &amp; docking</h2>
				<ul class="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-white/60">
					<li>
						Each planet has <strong class="text-white/80">⌊radius⌋ docking spots</strong> and a finite
						halite reserve (the visualizer shrinks planets as it depletes).
					</li>
					<li>
						To dock, a ship must be within
						<strong class="text-white/80">planet radius + 4.5 units</strong> of the planet center
						and the planet must have a free spot. Docking takes
						<strong class="text-white/80">5 turns</strong>; undocking takes 5 turns too.
					</li>
					<li>Docked ships cannot move. Only one player can be docked at a planet at a time.</li>
				</ul>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Mining &amp; ship production</h2>
				<ul class="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-white/60">
					<li>
						Each docked ship mines <strong class="text-white/80">2%</strong> of the planet's
						<em>remaining</em> halite per turn into your resource bank, so yields shrink over time.
					</li>
					<li>
						Every <strong class="text-white/80">8 turns</strong>, each planet where you have docked
						ships spawns a new ship next to it — if you can pay the
						<strong class="text-white/80">40 halite</strong> cost.
					</li>
				</ul>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Combat</h2>
				<ul class="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-white/60">
					<li>
						Combat is automatic — there is no attack command. Ships fight all enemy ships in their
						vicinity (the engine resolves combat in 5×5-unit cells).
					</li>
					<li>
						Each ship deals <strong class="text-white/80">64 damage per turn</strong> to every enemy ship
						near it. Four hits kill a fresh ship.
					</li>
					<li>
						Docked ships still fight back, but they can't move — catching a mining operation
						undefended is usually lethal.
					</li>
				</ul>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Winning</h2>
				<p class="text-sm leading-relaxed text-white/60">
					The match ends when only one player has ships left, or when the turn limit is reached. At
					the limit, the winner is the player with the most ships, with total mined halite as the
					tie-breaker.
				</p>
			</section>

			<section class="space-y-2">
				<h2 class="text-lg font-semibold text-white">Command reference</h2>
				<p class="text-sm leading-relaxed text-white/60">
					Bots talk to the engine over stdin/stdout. The starter packs wrap this for you, but the
					raw per-ship commands are:
				</p>
				<div class="overflow-hidden rounded-lg border border-white/10">
					<table class="w-full text-left text-xs">
						<thead class="bg-white/5 text-white/70">
							<tr>
								<th class="px-3 py-2 font-semibold">Command</th>
								<th class="px-3 py-2 font-semibold">Effect</th>
							</tr>
						</thead>
						<tbody class="text-white/60">
							<tr class="border-t border-white/10">
								<td class="px-3 py-2 font-mono text-teal-300"
									>t &lt;id&gt; &lt;speed&gt; &lt;angle&gt;</td
								>
								<td class="px-3 py-2">Thrust: move the ship at speed 0–7 toward angle 0–359°.</td>
							</tr>
							<tr class="border-t border-white/10">
								<td class="px-3 py-2 font-mono text-teal-300">d &lt;id&gt; &lt;planet&gt;</td>
								<td class="px-3 py-2">Dock the ship at the given planet (must be in range).</td>
							</tr>
							<tr class="border-t border-white/10">
								<td class="px-3 py-2 font-mono text-teal-300">u &lt;id&gt;</td>
								<td class="px-3 py-2">Undock the ship from its planet.</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p class="text-sm leading-relaxed text-white/60">
					Full protocol details live in
					<a
						href="https://github.com/margual56/halite2/blob/main/starter-packs/PROTOCOL.md"
						class="text-teal-400 hover:underline"
						target="_blank"
						rel="noopener">PROTOCOL.md</a
					>.
				</p>
			</section>

			<footer class="border-t border-white/10 pt-6 text-sm text-white/60">
				Ready? Start from the
				<a href="/editor" class="text-teal-400 hover:underline">bot editor</a>, watch the
				<a href="/demo" class="text-teal-400 hover:underline">demo match</a>, or grab the engine
				from
				<a
					href="https://github.com/margual56/halite2/releases"
					class="text-teal-400 hover:underline"
					target="_blank"
					rel="noopener">the releases page</a
				>.
			</footer>
		</article>
	</main>
</div>
