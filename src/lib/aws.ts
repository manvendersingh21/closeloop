// Shared AWS clients (A2 owns; A1 uses for GetRolePolicy + SimulateCustomPolicy).
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";

const iam = new Map<string, IAMClient>();
const sts = new Map<string, STSClient>();

export function iamClient(region: string): IAMClient {
  let c = iam.get(region);
  if (!c) iam.set(region, (c = new IAMClient({ region })));
  return c;
}

export function stsClient(region: string): STSClient {
  let c = sts.get(region);
  if (!c) sts.set(region, (c = new STSClient({ region })));
  return c;
}
