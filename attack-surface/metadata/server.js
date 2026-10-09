// metadata — simulates a cloud instance-metadata service (the AWS
// 169.254.169.254-style IMDS pattern). INTERNAL-ONLY: the Akash SDL exposes
// this port only to the "storefront" service, never to the public internet.
// That's the whole point — it should be unreachable except by pivoting
// through storefront's SSRF bug.
//
// Vulnerability (CWE-269, insufficient privilege restriction / excessive
// permissions): any caller that CAN reach this service gets full
// "credentials" with no further authentication. In a real cloud this is
// exactly the Capital One-breach pattern: SSRF -> IMDS -> stolen creds.
//
// Authorized security-research honeypot. Nothing here is a real credential.

import express from "express";

const app = express();
const PORT = process.env.PORT || 4001;

// Shared secret with internal-api — set identically on both services via
// the IAM_TOKEN env var in deploy.yaml. A static, long-lived credential
// baked into deployment config is itself a very real misconfiguration.
const IAM_TOKEN = process.env.IAM_TOKEN || "unset-dev-token";
const ROLE_NAME = "deploy-role";

app.get("/latest/meta-data/iam/security-credentials/", (req, res) => {
  res.type("text/plain").send(ROLE_NAME);
});

app.get(`/latest/meta-data/iam/security-credentials/${ROLE_NAME}`, (req, res) => {
  res.json({
    Code: "Success",
    LastUpdated: new Date().toISOString(),
    Type: "AWS-HMAC",
    AccessKeyId: "AKIAFAKEDEPLOY0001",
    SecretAccessKey: "fake/secret/not-real/" + IAM_TOKEN.slice(0, 8),
    Token: IAM_TOKEN,
    Expiration: "2099-01-01T00:00:00Z",
  });
});

app.listen(PORT, () => {
  console.log(`metadata (fake IMDS) listening on :${PORT} — internal only`);
});
