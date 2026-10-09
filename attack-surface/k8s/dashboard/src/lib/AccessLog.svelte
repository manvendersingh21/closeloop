<script>
  import { onDestroy, onMount } from "svelte";

  let entries = $state([]);
  let status = $state("connecting");

  const META = {
    exfiltration: { label: "EXFILTRATION", color: "#ff8a7a", bg: "#3a1d1a" },
    write:        { label: "WRITE",        color: "#f0b95a", bg: "#382a0e" },
    read:         { label: "READ",         color: "#4fc3ab", bg: "#0e2a24" },
    recon:        { label: "RECON",        color: "#93a5a0", bg: "#1a2422" },
  };

  onMount(() => {
    const es = new EventSource("/api/logs/stream");
    es.onopen = () => (status = "live");
    es.onerror = () => (status = "reconnecting");
    es.onmessage = (e) => {
      const entry = JSON.parse(e.data);
      entries = [entry, ...entries].slice(0, 200);
    };
    onDestroy(() => es.close());
  });
</script>

<div class="panel">
  <div class="panel-head">
    <span class="dot" class:live={status === "live"}></span>
    <span class="label">{status === "live" ? "LIVE" : status.toUpperCase()}</span>
    <span class="sub">canary-api escalation log — every read / write / exfiltration attempt, in real time</span>
  </div>

  <div class="legend">
    {#each Object.entries(META) as [k, m]}
      <span class="tag" style="color:{m.color};background:{m.bg}">{m.label}</span>
    {/each}
  </div>

  <div class="rows">
    {#if entries.length === 0}
      <div class="empty">No requests observed yet — waiting for activity against canary-api.</div>
    {/if}
    {#each entries as e (e.id)}
      {@const m = META[e.category] || META.recon}
      <div class="row">
        <span class="tag" style="color:{m.color};background:{m.bg}">{m.label}</span>
        <span class="ts">{e.ts.slice(11, 19)}</span>
        <span class="method">{e.method}</span>
        <span class="path">{e.path}</span>
        <span class="ip">{e.ip}</span>
        {#if e.detail}
          <span class="detail">
            {#if e.category === "write" && e.detail.fieldsChanged}
              edited {e.detail.fieldsChanged.join(", ")} on customer #{e.detail.id}
            {:else if e.category === "exfiltration"}
              {e.detail.recordCount} records returned in one call
            {:else if e.detail.id !== undefined}
              customer #{e.detail.id}
            {/if}
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .panel { border: 1px solid #2a3a37; border-radius: 8px; background: #0b1312; overflow: hidden; }
  .panel-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #2a3a37; font-family: ui-monospace, monospace; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
  .dot.live { background: #4fc3ab; box-shadow: 0 0 0 3px rgba(79,195,171,.2); }
  .label { font-weight: 600; color: #e6eeec; letter-spacing: .04em; }
  .sub { color: #7f8f8b; margin-left: 4px; }
  .legend { display: flex; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #1d2a28; }
  .tag { font-family: ui-monospace, monospace; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
  .rows { max-height: 420px; overflow-y: auto; }
  .empty { padding: 24px 14px; color: #5c6b67; font-size: 13px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-bottom: 1px solid #141d1c; font-family: ui-monospace, monospace; font-size: 12px; }
  .row:hover { background: #0e1716; }
  .ts { color: #4fc3ab; }
  .method { color: #93a5a0; width: 42px; }
  .path { color: #c8d6d2; min-width: 160px; }
  .ip { color: #5c6b67; width: 110px; }
  .detail { color: #7f8f8b; font-style: italic; }
</style>
