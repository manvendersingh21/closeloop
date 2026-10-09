import type { PolicyDocument } from "@/contracts/internal";

/** CLOSELOOP_MOCK=1 → no AWS calls: the vulnerable FIND-001 policy and a local evaluator stand in. */
export function isMock(): boolean {
  return process.env.CLOSELOOP_MOCK === "1";
}

export const MAX_ATTEMPTS = 3;

/** The lab account this deployment may touch. Mock mode falls back to the example account. */
export function labAccountId(): string | undefined {
  return process.env.LAB_AWS_ACCOUNT_ID || (isMock() ? "111122223333" : undefined);
}

/** The vulnerable inline policy from contracts/examples/FIND-001.result.json ("before"). */
export const MOCK_POLICY: PolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "BroadS3Read",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: "arn:aws:s3:::*/*",
    },
    {
      Sid: "OrdersTable",
      Effect: "Allow",
      Action: ["dynamodb:Query"],
      Resource: "arn:aws:dynamodb:us-west-2:111122223333:table/closeloop-lab-orders",
    },
  ],
};
