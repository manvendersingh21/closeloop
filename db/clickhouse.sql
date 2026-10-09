-- CloseLoop ClickHouse schema. Statements separated by ";\n\n".
CREATE DATABASE IF NOT EXISTS closeloop;

-- Raw exploit-handoff/v1 documents received from the discovery agent
CREATE TABLE IF NOT EXISTS closeloop.handoffs
(
    finding_id      String,
    received_at     DateTime64(3) DEFAULT now64(3),
    schema_version  LowCardinality(String),
    title           String,
    severity        LowCardinality(String),
    category        LowCardinality(String),
    cwe             LowCardinality(String),
    target_id       String,
    environment     LowCardinality(String),
    authorization   LowCardinality(String),
    confidence      Float32,
    payload         String  -- full JSON
)
ENGINE = MergeTree
ORDER BY (finding_id, received_at);

-- One row per state change; latest row per job_id wins
CREATE TABLE IF NOT EXISTS closeloop.jobs
(
    job_id          String,
    finding_id      String,
    status          LowCardinality(String), -- in_progress|verified|failed|rolled_back|rejected
    stage           LowCardinality(String) DEFAULT 'queued', -- queued|patching|simulating|applying|verifying|done
    attempt         UInt8 DEFAULT 1,
    policy_before   String DEFAULT '',  -- policy JSON, '' = null
    policy_after    String DEFAULT '',  -- policy JSON, '' = null
    summary         String DEFAULT '[]', -- JSON array of strings
    rationale       String DEFAULT '',
    exploit_before  LowCardinality(String) DEFAULT 'not_run', -- success|blocked|not_run
    exploit_after   LowCardinality(String) DEFAULT 'not_run', -- success|blocked|not_run
    pr_url          String DEFAULT '',
    error           String DEFAULT '',
    started_at      DateTime64(3),
    finished_at     Nullable(DateTime64(3)),
    updated_at      DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY job_id;

-- Every negative/positive/regression check, simulated or live
CREATE TABLE IF NOT EXISTS closeloop.verification_checks
(
    job_id          String,
    finding_id      String,
    ts              DateTime64(3) DEFAULT now64(3),
    check_id        String DEFAULT '',
    attempt         UInt8,
    phase           LowCardinality(String), -- baseline|simulate|live|rollback
    kind            LowCardinality(String), -- negative|positive|regression
    action          String,
    resource        String,
    expected        LowCardinality(String), -- allow|deny
    actual          LowCardinality(String),
    passed          Bool,
    latency_ms      UInt32 DEFAULT 0,
    detail          String DEFAULT ''
)
ENGINE = MergeTree
ORDER BY (job_id, ts);

-- Timeline for the UI
CREATE TABLE IF NOT EXISTS closeloop.events
(
    job_id          String,
    ts              DateTime64(3) DEFAULT now64(3),
    stage           LowCardinality(String),
    level           LowCardinality(String) DEFAULT 'info',
    message         String
)
ENGINE = MergeTree
ORDER BY (job_id, ts);

-- Idempotent migrations for tables created by older versions
ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS stage LowCardinality(String) DEFAULT 'queued';

ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS summary String DEFAULT '[]';

ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS exploit_before LowCardinality(String) DEFAULT 'not_run';

ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS exploit_after LowCardinality(String) DEFAULT 'not_run';

ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS error String DEFAULT '';

ALTER TABLE closeloop.jobs ADD COLUMN IF NOT EXISTS finished_at Nullable(DateTime64(3));

ALTER TABLE closeloop.verification_checks ADD COLUMN IF NOT EXISTS check_id String DEFAULT '';
