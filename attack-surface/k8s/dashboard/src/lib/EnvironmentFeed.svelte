<script>
  import { onDestroy, onMount } from "svelte";

  let lines = $state([]);
  let status = $state("connecting");
  let box;

  onMount(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => (status = "live");
    es.onerror = () => (status = "reconnecting");
    es.onmessage = (e) => {
      const { line, ts } = JSON.parse(e.data);
      lines = [...lines.slice(-299), { line, ts }];
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight;
      });
    };
    onDestroy(() => es.close());
  });
</script>

<div class="feed">
  <div class="feed-head">
    <span class="dot" class:live={status === "live"}></span>
    <span class="label">{status === "live" ? "LIVE" : status.toUpperCase()}</span>
    <span class="sub">kubectl get events -A --watch · kind-attack-sandbox</span>
  </div>
  <div class="feed-body" bind:this={box}>
    {#if lines.length === 0}
      <div class="line dim">waiting for events…</div>
    {/if}
    {#each lines as l}
      <div class="line"><span class="ts">{l.ts.slice(11, 19)}</span> {l.line}</div>
    {/each}
  </div>
</div>

<style>
  .feed {
    border: 1px solid #2a3a37;
    border-radius: 8px;
    background: #0b1312;
    overflow: hidden;
  }
  .feed-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #2a3a37;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
  .dot.live { background: #4fc3ab; box-shadow: 0 0 0 3px rgba(79,195,171,.2); }
  .label { font-weight: 600; color: #e6eeec; letter-spacing: .04em; }
  .sub { color: #7f8f8b; margin-left: auto; }
  .feed-body {
    height: 320px;
    overflow-y: auto;
    padding: 10px 14px;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
    color: #c8d6d2;
  }
  .line { white-space: pre-wrap; word-break: break-word; }
  .line.dim { color: #5c6b67; }
  .ts { color: #4fc3ab; margin-right: 8px; }
</style>
