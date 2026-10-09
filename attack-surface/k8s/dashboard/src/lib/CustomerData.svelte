<script>
  let customers = $state([]);
  let error = $state(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch("/api/customers");
      const data = await res.json();
      if (data.source === "unavailable") throw new Error(data.error + " — " + data.hint);
      customers = data.customers || [];
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  load();
</script>

<div class="panel">
  <div class="panel-head">
    <div>
      <span class="eyebrow">protected/canary-api · live</span>
      <h3>Customer data</h3>
    </div>
    <button onclick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
  </div>

  {#if error}
    <div class="err">
      Could not reach canary-api: {error}
    </div>
  {:else}
    <p class="note">
      {customers.length} synthetic records — fabricated for this lab, fetched live from the
      protected service exactly as an attacker would see it after escaping public → protected.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Email</th><th>Account #</th><th>Card</th><th>Plan</th><th>MRR</th></tr>
        </thead>
        <tbody>
          {#each customers as c}
            <tr>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>{c.email}</td>
              <td>{c.account_number}</td>
              <td>•••• {c.card_last4}</td>
              <td><span class="chip chip-{c.plan}">{c.plan}</span></td>
              <td>${c.mrr_usd}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .panel {
    border: 1px solid #2a3a37;
    border-radius: 8px;
    background: #0e1716;
    padding: 16px;
  }
  .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #7f8f8b; }
  h3 { margin: 2px 0 0; color: #e6eeec; }
  button {
    font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 6px;
    border: 1px solid #4fc3ab; background: transparent; color: #4fc3ab; cursor: pointer;
  }
  button:hover { background: #4fc3ab; color: #06201a; }
  button:disabled { opacity: .5; cursor: default; }
  .note { color: #93a5a0; font-size: 13px; margin: 0 0 12px; }
  .err { color: #ff8a7a; font-family: ui-monospace, monospace; font-size: 13px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #1d2a28; white-space: nowrap; }
  th { color: #7f8f8b; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  td { color: #c8d6d2; font-variant-numeric: tabular-nums; }
  .chip { padding: 2px 8px; border-radius: 999px; font-size: 11.5px; }
  .chip-free { background: #2a3a37; color: #93a5a0; }
  .chip-pro { background: #12301f; color: #6fd39a; }
  .chip-enterprise { background: #382a0e; color: #f0b95a; }
</style>
