<script>
  let data = $state(null);
  let error = $state(null);
  let filter = $state("all");

  const META = {
    P1: { color: "#ff8a7a", bg: "#3a1d1a", label: "P1 — immediate response" },
    P2: { color: "#f0b95a", bg: "#382a0e", label: "P2 — immediate response" },
    P3: { color: "#93a5a0", bg: "#1a2422", label: "P3" },
    P4: { color: "#5c6b67", bg: "#141d1c", label: "P4" },
  };

  async function load() {
    try {
      const res = await fetch("/findings.json");
      data = await res.json();
    } catch (e) {
      error = e.message;
    }
  }
  load();

  let shown = $derived(
    !data ? [] : filter === "all" ? data.findings : data.findings.filter((f) => f.priority === filter)
  );
  let urgent = $derived(
    !data ? 0 : (data.counts.P1 || 0) + (data.counts.P2 || 0)
  );
</script>

<div class="panel">
  {#if error}
    <div class="err">Could not load findings.json: {error}</div>
  {:else if !data}
    <div class="err">Loading…</div>
  {:else}
    <div class="head">
      <div>
        <span class="eyebrow">{data.total} findings — classified by {data.classifier}</span>
        <h3>Vulnerability triage</h3>
      </div>
      {#if urgent > 0}
        <div class="banner">{urgent} finding{urgent === 1 ? "" : "s"} need immediate response (P1/P2)</div>
      {:else}
        <div class="banner ok">No P1/P2 findings right now</div>
      {/if}
    </div>

    <div class="counts">
      {#each ["P1", "P2", "P3", "P4"] as p}
        <button
          class="count-chip"
          class:active={filter === p}
          style="--c:{META[p].color};--bg:{META[p].bg}"
          onclick={() => (filter = filter === p ? "all" : p)}
        >
          <span class="n">{data.counts[p] || 0}</span>
          <span class="l">{p}</span>
        </button>
      {/each}
      <button class="count-chip all" class:active={filter === "all"} onclick={() => (filter = "all")}>
        <span class="n">{data.total}</span>
        <span class="l">all</span>
      </button>
    </div>

    <div class="rows">
      {#each shown as f}
        {@const m = META[f.priority]}
        <div class="row">
          <span class="tag" style="color:{m.color};background:{m.bg}">{f.priority}</span>
          <div class="body">
            <div class="title-line">
              <span class="title">{f.title}</span>
              <span class="source">{f.source}</span>
              {#if f.jev_confidence !== undefined}
                <span class="conf" class:low={f.jev_confidence < 0.65}>jev confidence {f.jev_confidence}</span>
              {/if}
            </div>
            <div class="path">{f.path}</div>
            <div class="message">{f.message}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel { border: 1px solid #2a3a37; border-radius: 8px; background: #0e1716; }
  .err { padding: 20px; color: #ff8a7a; font-family: ui-monospace, monospace; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px; border-bottom: 1px solid #1d2a28; flex-wrap: wrap; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #7f8f8b; }
  h3 { margin: 2px 0 0; color: #e6eeec; }
  .banner { font-size: 12.5px; font-weight: 600; color: #ff8a7a; background: #3a1d1a; padding: 6px 12px; border-radius: 6px; white-space: nowrap; }
  .banner.ok { color: #6fd39a; background: #12301f; }
  .counts { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #1d2a28; flex-wrap: wrap; }
  .count-chip { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 14px; border-radius: 8px; border: 1px solid #2a3a37; background: #0b1312; cursor: pointer; color: #e6eeec; }
  .count-chip.active { border-color: var(--c, #4fc3ab); background: var(--bg, #0b1312); }
  .count-chip .n { font-family: ui-monospace, monospace; font-size: 16px; font-weight: 700; }
  .count-chip .l { font-size: 10px; color: #7f8f8b; letter-spacing: .04em; }
  .count-chip.all { border-style: dashed; }
  .rows { max-height: 480px; overflow-y: auto; }
  .row { display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #141d1c; }
  .tag { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; height: fit-content; white-space: nowrap; }
  .body { flex: 1; min-width: 0; }
  .title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .title { color: #e6eeec; font-size: 13.5px; font-weight: 500; }
  .source { font-family: ui-monospace, monospace; font-size: 10px; color: #5c6b67; border: 1px solid #2a3a37; border-radius: 4px; padding: 1px 6px; }
  .conf { font-family: ui-monospace, monospace; font-size: 10px; color: #6fd39a; }
  .conf.low { color: #f0b95a; }
  .path { font-family: ui-monospace, monospace; font-size: 11.5px; color: #4fc3ab; margin-top: 2px; }
  .message { font-size: 12.5px; color: #93a5a0; margin-top: 4px; line-height: 1.4; }
</style>
