"use client";

export function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      {/* Atmosphere — soft sky wash + layered shapes (not flat) */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 46%, var(--sky-bottom) 100%)",
        }}
      />
      <div
        aria-hidden
        className="animate-float-a absolute -left-16 top-16 h-44 w-44 rounded-full opacity-70 md:h-56 md:w-56"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, #fff 0%, rgba(255,255,255,0.55) 45%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="animate-float-b absolute -right-10 top-28 h-36 w-52 rounded-[40%] opacity-60 md:h-48 md:w-64"
        style={{
          background:
            "radial-gradient(circle at 60% 40%, rgba(255,255,255,0.95) 0%, rgba(158,201,230,0.45) 55%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className="animate-float-a absolute left-[18%] top-[42%] h-24 w-40 rounded-full opacity-50"
        style={{
          background:
            "radial-gradient(circle at 40% 40%, rgba(255,255,255,0.9), transparent 70%)",
          animationDelay: "1.2s",
        }}
      />

      {/* Abstract closed-loop visual plane (full-bleed bottom) */}
      <svg
        aria-hidden
        className="animate-horizon pointer-events-none absolute inset-x-0 bottom-0 h-[38%] w-[120%] -translate-x-[8%]"
        viewBox="0 0 1440 420"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="loopFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7eb6d8" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#0b6e8f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#08506a" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <path
          d="M0,140 C220,40 420,220 720,120 C1020,20 1220,180 1440,90 L1440,420 L0,420 Z"
          fill="url(#loopFill)"
        />
        <path
          d="M0,210 C280,110 480,260 760,180 C1040,100 1240,240 1440,170"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M180,250 C420,180 620,300 900,230 C1100,180 1280,260 1380,220"
          fill="none"
          stroke="#5ec4b6"
          strokeOpacity="0.65"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col items-center justify-center px-6 pb-28 pt-16 text-center">
        <p className="eyebrow animate-hero-rise">Verified autonomous remediation</p>
        <h1 className="brand animate-hero-rise-delay mt-4 text-[clamp(3.2rem,12vw,6.4rem)] leading-[0.95] text-[var(--ink)]">
          CloseLoop
        </h1>
        <p className="animate-hero-rise-delay mx-auto mt-5 max-w-xl text-base font-medium leading-relaxed text-[var(--muted)] md:text-lg">
          Find. Fix. Prove. Ship. — AI patches don&apos;t count until the
          exploit is closed.
        </p>
        <div className="animate-hero-rise-delay mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" className="btn-chunk btn-chunk-primary" onClick={onStart}>
            Start remediating
          </button>
          <a href="#workspace" className="btn-chunk btn-chunk-secondary">
            See the loop
          </a>
        </div>
      </div>
    </section>
  );
}
