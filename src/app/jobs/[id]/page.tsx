import { Suspense } from "react";
import type { Metadata } from "next";
import { DetailSkeleton, JobDetail } from "@/components/live/JobDetail";
import { LiveShell } from "@/components/live/LiveShell";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = {
  title: "Live job — CloseLoop",
  description: "Patch, prove on the live Akash lab, ship or roll back.",
};

// `params` is runtime data: read it inside Suspense so the shell can prerender.
async function JobFromParams({ params }: { params: Params }) {
  const { id } = await params;
  return <JobDetail jobId={decodeURIComponent(id)} />;
}

export default function JobPage({ params }: { params: Params }) {
  return (
    <LiveShell crumb="job">
      <Suspense fallback={<DetailSkeleton />}>
        <JobFromParams params={params} />
      </Suspense>
    </LiveShell>
  );
}
