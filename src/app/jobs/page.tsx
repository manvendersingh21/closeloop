import type { Metadata } from "next";
import { JobsList } from "@/components/live/JobsList";
import { LiveShell } from "@/components/live/LiveShell";

export const metadata: Metadata = {
  title: "Live jobs — CloseLoop",
  description: "Live remediation jobs: patch, prove on Akash, ship or roll back.",
};

export default function JobsPage() {
  return (
    <LiveShell crumb="jobs">
      <JobsList />
    </LiveShell>
  );
}
