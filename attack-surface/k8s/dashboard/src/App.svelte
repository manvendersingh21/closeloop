<script>
  import EnvironmentFeed from "./lib/EnvironmentFeed.svelte";
  import CustomerData from "./lib/CustomerData.svelte";

  let tab = $state("environment"); // "environment" | "customers"
</script>

<main>
  <section class="hero">
    <span class="eyebrow">Authorized security-research lab · kind-attack-sandbox</span>
    <h1>Attack Surface Dashboard</h1>
    <p class="dek">
      A public app, an internal backend, and a protected canary — two deliberate
      Kubernetes misconfigurations (NetworkPolicy, RBAC) connect them. This page
      watches the live cluster, not a replay.
    </p>
  </section>

  <section class="tabs-section">
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === "environment"} class:active={tab === "environment"} onclick={() => (tab = "environment")}>
        View Environment
      </button>
      <button role="tab" aria-selected={tab === "customers"} class:active={tab === "customers"} onclick={() => (tab = "customers")}>
        Customer Data
      </button>
    </div>

    <div class="tab-body">
      {#if tab === "environment"}
        <EnvironmentFeed />
      {:else}
        <CustomerData />
      {/if}
    </div>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0a100f;
    color: #e6eeec;
    font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
  }
  main { max-width: 960px; margin: 0 auto; padding: 48px 20px 80px; }

  .hero { max-width: 60ch; margin-bottom: 40px; }
  .eyebrow {
    font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .08em;
    text-transform: uppercase; color: #4fc3ab;
  }
  h1 { font-size: 32px; margin: 8px 0 12px; letter-spacing: -.01em; }
  .dek { color: #93a5a0; line-height: 1.55; margin: 0; }

  .tabs { display: flex; gap: 6px; border-bottom: 1px solid #2a3a37; margin-bottom: 20px; }
  .tabs button {
    font: inherit; font-size: 14px; padding: 10px 16px; background: none; border: none;
    color: #93a5a0; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs button.active { color: #e6eeec; border-bottom-color: #4fc3ab; }
  .tabs button:hover { color: #e6eeec; }
</style>
