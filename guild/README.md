# Guild reviewer (`closeloop-reviewer`)

Before CloseLoop applies a least-privilege policy change, a separate LLM agent hosted on
[Guild.ai](https://docs.guild.ai) reviews it. The agent is not CloseLoop's patcher and shares no
code with it. Each review runs as its own Guild session, and the session link is stored with the
job (`ReviewVerdict.sessionUrl` → `ExecutionReport.reviewSessionUrl`) as the audit trail.

## What the agent does

It gets one JSON object:

```json
{
  "finding": { "id", "title", "severity", "description", "root_cause", "desired_security_property",
               "offending_statement_sid", "protected_resource", "exploit": { "action", "resource" } },
  "constraints": ["..."],
  "checks": [{ "id", "kind": "negative|positive|regression", "action", "resource", "expect": "allow|deny" }],
  "policy_before": { "Version": "2012-10-17", "Statement": [] },
  "policy_after":  { "Version": "2012-10-17", "Statement": [] },
  "summary": ["..."],
  "rationale": "..."
}
```

It approves only when all of these hold for `policy_after`:

- it narrows access enough to deny the exploit and every negative check;
- it never widens a permission;
- it leaves unrelated statements unchanged;
- it still allows every positive and regression check;
- it respects every constraint.

The reply is only `{"decision":"approve"|"reject","reasons":[...]}`. The system prompt is in
[`scripts/guild-setup.mjs`](../scripts/guild-setup.mjs) (`SYSTEM_PROMPT`).

## Setup (idempotent)

Requirement: `GUILD_AI_API_KEY="<key_id>:<secret>"` in `.env`. This is an account key with write
access on agents, workspaces and sessions.

```bash
pnpm guild:setup
```

The script does the following, and a re-run makes no changes:

1. Creates workspace `closeloop` under the key's account, if it is missing.
2. Creates agent `closeloop-reviewer` (LLM template), if it is missing, and waits until it is `READY`.
3. Configures the agent (`configure-llm`, one-shot) and publishes it. The version summary carries a
   hash of the prompt, so a new version is cut only when the prompt changes.
4. Installs the agent in the workspace, with auto-update on.

At the end it prints the non-secret settings to add to `.env`:

```
GUILD_OWNER=manvendersingh21
GUILD_WORKSPACE=closeloop
GUILD_REVIEWER_AGENT=01a12287-c32c-726e-0000-084a55c6d4b0
```

Optional settings:

- `CLOSELOOP_REVIEW_TIMEOUT_MS`: default `90000`.
- `GUILD_API_URL`: default `https://api.guild.ai/v1`.

## How CloseLoop calls it

`src/lib/remediate/reviewer.ts` exports `reviewProposal(handoff, proposal, jobId)`, which uses
`src/lib/guild.ts`:

1. `POST /v1/workspaces/{owner}~{workspace}/sessions` with
   `{"session_type":"chat","agent_id":"<uuid>","initial_prompt":"<review JSON>"}`.
   An account key may only start `chat` sessions. `api_trigger` returns 403, and trigger keys can
   only be created in the web UI.
2. Polls `GET /v1/sessions/{id}` until `root_task.status` is `DONE`, `ERROR` or `INTERRUPTED`.
3. Reads the reply from `GET /v1/sessions/{id}/events?sort_by=-id&limit=5`, taking the newest
   `runtime_done` event's `content.text`. Only the newest events are fetched because larger pages
   are very slow (about 57s for `limit=20`).
4. Parses the JSON verdict. Code fences and surrounding prose are tolerated.

The function never throws. Missing config, an HTTP error, a timeout or an unparseable reply all
return `{decision:"unavailable", reasons:[why], sessionUrl}`. In that case the deterministic IAM
simulator gate still decides. A typical review takes 10–25s.

## Viewing sessions

Every verdict carries `sessionUrl` (`https://app.guild.ai/sessions/<id>`). Open it while signed
in as the account owner to see the exact input, the agent's reply and token usage. All reviews
also appear under the `closeloop` workspace in [app.guild.ai](https://app.guild.ai).

## Limitations

- **Model choice:** the API has no setting for which model the agent uses. It comes from the
  account's Models & providers settings (managed by default), which are set in the web UI.
- **Required tool:** `configure-llm` requires at least one tool. The only supported Guild tool is
  `guild_search_agent`, so the agent has it, and the prompt tells it never to call it.
