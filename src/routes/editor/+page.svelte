<script lang="ts">
	import { onMount } from 'svelte';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import type * as Monaco from 'monaco-editor';
	import { resolve } from '$app/paths';

	const STORAGE_KEY = 'halite2-bot-code';

	const DEFAULT_CODE = `# Halite II starter bot (Python).
#
# This editor runs in your browser, but bots can only be executed LOCALLY:
# download the engine + starter pack, save this file as MyBot.py inside
# starter-packs/python/, then run:
#
#   halite2 "python3 MyBot.py" "python3 MyBot.py"
#
# The engine writes replay.hlt — drop it on the visualizer to watch.

from hlt import Game, dock, thrust, undock

# The name you pass here shows up in the replay scoreboard.
game = Game("MyFirstBot")

while True:
    game_map = game.update_map()
    me = game_map.me
    commands = []

    for ship in me.ships.values():
        # Docked ships mine halite on their own; leave them be.
        if not ship.is_undocked:
            continue

        # Find planets that still have a free docking spot.
        available = [p for p in game_map.planets.values() if not p.is_full]
        if not available:
            continue

        nearest = min(available, key=ship.distance_to)

        if ship.can_dock(nearest):
            # Close enough: start docking (takes 5 turns).
            commands.append(dock(ship.id, nearest.id))
        else:
            # Fly toward it, capped at the max speed of 7.
            mag = min(7, int(ship.distance_to(nearest)))
            commands.append(thrust(ship.id, mag, ship.angle_to(nearest)))

    game.send_commands(commands)
`;

	let editorEl: HTMLDivElement;
	let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
	let copied = $state(false);
	let infoOpen = $state(false);

	onMount(() => {
		let disposed = false;
		(async () => {
			const monaco = await import('monaco-editor');
			const { default: EditorWorker } =
				await import('monaco-editor/esm/vs/editor/editor.worker?worker');
			self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
			if (disposed) return;

			editor = monaco.editor.create(editorEl, {
				value: localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CODE,
				language: 'python',
				theme: 'vs-dark',
				minimap: { enabled: false },
				fontSize: 13,
				automaticLayout: true,
				scrollBeyondLastLine: false,
				padding: { top: 12 }
			});
			editor.onDidChangeModelContent(() => {
				if (editor) localStorage.setItem(STORAGE_KEY, editor.getValue());
			});
		})();

		return () => {
			disposed = true;
			editor?.dispose();
		};
	});

	function downloadBot() {
		const blob = new Blob([editor?.getValue() ?? DEFAULT_CODE], { type: 'text/x-python' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'MyBot.py';
		a.click();
		URL.revokeObjectURL(a.href);
	}

	async function copyBot() {
		await navigator.clipboard.writeText(editor?.getValue() ?? DEFAULT_CODE);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function resetBot() {
		editor?.setValue(DEFAULT_CODE);
	}

	const pageTitle = 'Bot Editor — Halite II Replay Visualizer';
	const pageDescription =
		'Edit the example Python bot for Halite II in a browser code editor, then download it and run it locally against the open-source Zig engine.';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href="https://halite2.pages.dev/editor" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://halite2.pages.dev/editor" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:image" content="https://halite2.pages.dev/planet.png" />
</svelte:head>

{#snippet instructions()}
	<p class="leading-relaxed text-white/60">
		This is the example bot from the
		<a
			href="https://github.com/margual56/halite2/tree/main/starter-packs"
			class="text-teal-400 hover:underline"
			target="_blank"
			rel="noopener">Python starter pack</a
		>. Edit it here — your changes are saved in your browser.
	</p>

	<div class="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs">
		<p class="leading-relaxed text-amber-200/80">
			<strong class="text-amber-200">Bots run locally, not in the browser.</strong> When you're done
			editing, download the file and run it with the engine on your machine.
		</p>
	</div>

	<ol class="list-inside list-decimal space-y-2 text-xs leading-relaxed text-white/60">
		<li>
			Download the engine from the
			<a
				href="https://github.com/margual56/halite2/releases"
				class="text-teal-400 hover:underline"
				target="_blank"
				rel="noopener">releases page</a
			>
			and the starter pack (your bot needs its <code class="text-teal-300">hlt/</code> helper module).
		</li>
		<li>
			Save this file as <code class="text-teal-300">MyBot.py</code> next to
			<code class="text-teal-300">hlt/</code>.
		</li>
		<li>
			Run
			<code class="mt-1 block rounded bg-white/10 px-2 py-1 text-[11px] text-teal-300"
				>halite2 "python3 MyBot.py" "python3 MyBot.py"</code
			>
		</li>
		<li>
			Drop the resulting <code class="text-teal-300">replay.hlt</code> on the
			<a href={resolve('/')} class="text-teal-400 hover:underline">visualizer</a> — or check the
			<a href={resolve('/rules')} class="text-teal-400 hover:underline">game rules</a> first.
		</li>
	</ol>
{/snippet}

<div class="flex h-screen flex-col bg-gray-950 text-white">
	<SiteHeader active="/editor" />

	<main class="flex min-h-0 flex-1 flex-col sm:flex-row">

		<!-- ── Mobile: collapsible info panel + action strip ─────────────────── -->
		<div class="flex shrink-0 flex-col sm:hidden">
			<!-- Action buttons always visible -->
			<div class="flex gap-2 border-b border-white/10 px-3 py-2">
				<button
					onclick={downloadBot}
					class="flex-1 rounded bg-teal-600 px-2 py-1.5 text-xs font-semibold hover:bg-teal-500 active:bg-teal-700"
				>
					⬇ Download
				</button>
				<button
					onclick={copyBot}
					class="rounded bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
				>
					{copied ? '✓ Copied' : 'Copy'}
				</button>
				<button
					onclick={resetBot}
					class="rounded bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
				>
					Reset
				</button>
			</div>

			<!-- Collapsible instructions -->
			<button
				onclick={() => (infoOpen = !infoOpen)}
				class="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-left text-sm font-medium text-white/70 hover:text-white"
			>
				<span>How to use</span>
				<svg
					class="h-4 w-4 shrink-0 transition-transform {infoOpen ? 'rotate-180' : ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if infoOpen}
				<div class="flex max-h-56 flex-col gap-3 overflow-y-auto border-b border-white/10 p-4 text-sm">
					{@render instructions()}
				</div>
			{/if}
		</div>

		<!-- ── Desktop: fixed sidebar ─────────────────────────────────────────── -->
		<aside
			class="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 p-4 text-sm sm:flex"
		>
			<h1 class="text-lg font-semibold text-white">Python bot editor</h1>

			{@render instructions()}

			<div class="mt-auto flex flex-col gap-2">
				<button
					onclick={downloadBot}
					class="rounded bg-teal-600 px-3 py-2 text-xs font-semibold hover:bg-teal-500 active:bg-teal-700"
				>
					⬇ Download MyBot.py
				</button>
				<div class="flex gap-2">
					<button
						onclick={copyBot}
						class="flex-1 rounded bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
					>
						{copied ? '✓ Copied' : 'Copy code'}
					</button>
					<button
						onclick={resetBot}
						class="flex-1 rounded bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20"
					>
						Reset to example
					</button>
				</div>
			</div>
		</aside>

		<!-- ── Editor ─────────────────────────────────────────────────────────── -->
		<div bind:this={editorEl} class="min-w-0 flex-1"></div>
	</main>
</div>
