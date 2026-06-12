<script lang="ts">
	import { onMount } from 'svelte';
	import { parseReplay } from '$lib/parser';
	import type { Replay } from '$lib/parser';
	import ReplayViewer from '$lib/components/ReplayViewer.svelte';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import { resolve } from '$app/paths';

	let replay = $state<Replay | null>(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/demo.hlt');
			if (!res.ok) throw new Error(`Failed to fetch the demo replay (HTTP ${res.status})`);
			replay = parseReplay(await res.arrayBuffer());
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : String(e);
		}
	});

	const pageTitle = 'Demo Match — Halite II Replay Visualizer';
	const pageDescription =
		'Watch a demo Halite II match in your browser: two starter bots race to dock planets, mine halite, build fleets and fight for the map.';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href="https://halite2.pages.dev/demo" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://halite2.pages.dev/demo" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta property="og:image" content="https://halite2.pages.dev/planet.png" />
</svelte:head>

<div class="flex h-screen flex-col bg-gray-950 text-white select-none">
	<SiteHeader active="/demo" />

	<div
		class="flex shrink-0 items-center justify-center gap-2 border-b border-white/5 bg-teal-950/30 px-4 py-1.5 text-xs text-white/50"
	>
		<span>
			This is a bundled demo: two copies of the Python starter bot fighting over five planets. Write
			your own with the
			<a href={resolve('/editor')} class="text-teal-400 hover:underline">bot editor</a> and the
			<a
				href="https://github.com/margual56/halite2"
				class="text-teal-400 hover:underline"
				target="_blank"
				rel="noopener">Zig engine</a
			>.
		</span>
	</div>

	<main class="relative min-h-0 flex-1">
		{#if replay}
			<ReplayViewer {replay} />
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-white/40">Loading demo match…</p>
			</div>
		{/if}
	</main>
</div>
