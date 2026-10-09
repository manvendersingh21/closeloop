import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="flex-1">
      <Dashboard />
      <footer className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-10 pt-2 text-sm text-[var(--muted)] md:px-8">
        <p>
          CloseLoop · Cyberdefense Hackathon #SFTechWeek · Built against the
          remediation-deployment gap in{" "}
          <em>Frontier AI&apos;s Impact on the Cybersecurity Landscape</em>{" "}
          (arXiv:2504.05408).
        </p>
      </footer>
    </main>
  );
}
