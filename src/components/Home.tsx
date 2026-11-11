"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Recent = { id: string; at: string; source: string; host: string; verdict: string; failure_reason: string | null; paid: string; refund_tx: string | null };
type Stats = {
  calls: number; passed: number; failed: number; refunds: number; refunded: string; covered_value: string;
  by_source: { agent: number; demo: number; scan: number };
  failure_reasons: { reason: string; n: number }[];
  recent: Recent[];
};
type Service = { host: string; name: string; category: string | null; callable: boolean; note: string | null; n: number; passes: number; pass_rate: number | null; median_latency_ms: number | null; top_failure: string | null };
type Check = { name: string; ok: boolean; expected: string; actual: string };
type Demo = {
  scenario: "pass" | "fail";
  steps: [{ ms: number; quote?: { target_price: string; premium: string; total: string; covered: boolean; terms: string } }, { ms: number; http: number }];
  outcome: {
    id: string; verdict: "pass" | "fail"; failure_reason?: string; checks: Check[]; latency_ms: number;
    price: { target: string; premium: string; total: string };
    result?: { body: string } | null;
    target_receipt?: { reference?: string } | null;
    refund?: { amount: string; tx: string | null; status: string } | null;
    certificate?: { signature: string; signer: string };
  };
};

const short = (s?: string | null, n = 10) => (s ? `${s.slice(0, n)}…${s.slice(-6)}` : "");
const REASONS: Record<string, string> = {
  timeout: "Too slow or no answer", http_error: "Error status", wrong_content_type: "Wrong format", schema_mismatch: "Wrong shape",
  too_small: "Response too small", overcharge: "Charged more than quoted", no_receipt: "No payment receipt", payment_failed: "Payment not accepted",
};
const CAPTIONS = [
  "",
  "Agent asks Warranty to buy a forecast for it…",
  "Warranty reads the service's price and answers 402 with a quote",
  "Agent pays Warranty: the service's price plus a premium",
  "Warranty pays the service out of its own pool",
  "Checking the response against the contract…",
];
// Fixed positions for the coin shower, so renders stay pure.
const RAIN = [6, 14, 23, 31, 40, 48, 57, 65, 73, 82, 90, 96].map((left, i) => ({ left, delay: (i % 5) * 0.12, r: `${(i % 2 ? 1 : -1) * (120 + i * 25)}deg` }));

/** Counts up to `value` whenever it changes. */
function useCountUp(value: number | undefined, decimals = 0) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value === undefined) return;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * eased;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // Background tabs pause animation frames, so always land on the real number.
    const settle = setTimeout(() => {
      setShown(value);
      from.current = value;
    }, 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value]);
  return value === undefined ? "–" : shown.toFixed(decimals);
}

/** Fades children in the first time they scroll into view. */
function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export default function Home({ origin, network, wallet }: { origin: string; network: string; wallet: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [running, setRunning] = useState<"pass" | "fail" | null>(null);
  const [phase, setPhase] = useState(0);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, sc] = await Promise.all([fetch("/api/stats").then((r) => r.json()), fetch("/api/scores").then((r) => r.json())]);
      setStats(s);
      setServices(sc.services ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function run(scenario: "pass" | "fail") {
    setRunning(scenario);
    setDemo(null);
    setError(null);
    setPhase(1);
    const tick = setInterval(() => setPhase((p) => (p < 5 ? p + 1 : p)), 1350);
    const started = Date.now();
    try {
      const res = await fetch(`/api/demo/run?scenario=${scenario}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.outcome?.verdict) throw new Error(json.message ?? "The demo call did not complete. Try again.");
      // Let the stage finish telling the story before the verdict lands.
      const wait = Math.max(0, 5 * 1350 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      setDemo(json);
      setPhase(6);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase(0);
    } finally {
      clearInterval(tick);
      setRunning(null);
    }
  }

  const snippet = `npx mppx ${origin}/api/call --network testnet -J '{
  "url": "${origin}/api/flaky?mode=garbage",
  "contract": { "status": 200, "content_type": "application/json" }
}'`;

  const calls = useCountUp(stats?.calls);
  const passed = useCountUp(stats?.passed);
  const refunds = useCountUp(stats?.refunds);
  const refunded = useCountUp(stats ? Number(stats.refunded) : undefined, 3);
  const verdict = demo?.outcome.verdict;

  return (
    <>
      <div className="backdrop" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="orb orb-c" />
      </div>

      <main className="mx-auto max-w-5xl px-5 pb-24 pt-8 sm:px-8">
        <header className="rise flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/40">W</span> Warranty
          </div>
          <nav className="flex items-center gap-4 text-zinc-400">
            <a className="transition hover:text-white" href="/llms.txt">llms.txt</a>
            <a className="transition hover:text-white" href="/openapi.json">openapi.json</a>
            <a className="hidden transition hover:text-white sm:inline" href="https://github.com/neuralnomad26/warranty" target="_blank" rel="noreferrer">GitHub</a>
            <a href="#demo" className="btn rounded-full bg-white/10 px-4 py-1.5 font-medium text-white ring-1 ring-white/15">Run the demo</a>
          </nav>
        </header>

        {/* ------------------------------------------------------------ hero */}
        <section className="grid items-center gap-10 pt-14 md:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-emerald-300" style={{ animationDelay: "80ms" }}>
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> A refund layer for the Machine Payments Protocol
            </p>
            <h1 className="rise mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" style={{ animationDelay: "160ms" }}>
              Agent payments are final.
              <br />
              <span className="shine">Warranty makes them safe to make.</span>
            </h1>
            <p className="rise mt-6 max-w-xl text-lg text-zinc-400" style={{ animationDelay: "260ms" }}>
              When an agent pays an MPP service in stablecoins, the money is gone, even if the service answers with an error, the wrong
              format, or nothing. Route the call through Warranty: it pays for you, checks the result against your contract, and refunds
              you automatically when a covered service fails.
            </p>
            <div className="rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: "360ms" }}>
              <a href="#demo" className="btn rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-zinc-950 shadow-lg shadow-emerald-500/30">Watch a refund happen ↓</a>
              <a href="#use" className="btn rounded-xl border border-zinc-700 bg-zinc-900/60 px-5 py-3 font-semibold text-zinc-100">Use it from your agent</a>
            </div>
          </div>

          <div className="rise relative mx-auto grid h-64 w-64 place-items-center" style={{ animationDelay: "300ms" }} aria-hidden>
            <span className="pulse-ring" />
            <span className="pulse-ring" />
            <span className="pulse-ring" />
            <svg viewBox="0 0 208 228" className="float relative h-48 w-44 drop-shadow-[0_20px_40px_rgba(16,185,129,0.55)]">
              <defs>
                <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#6ee7b7" />
                  <stop offset="1" stopColor="#10b981" />
                </linearGradient>
              </defs>
              <path d="M104 0 L208 36 V112 C208 170 164 206 104 228 C44 206 0 170 0 112 V36 Z" fill="url(#sh)" />
              <path d="M104 22 L186 51 V112 C186 158 151 187 104 205 C57 187 22 158 22 112 V51 Z" fill="#07130f" />
              <path className="draw" d="M62 114 L92 144 L148 84" fill="none" stroke="#6ee7b7" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </section>

        {/* -------------------------------------------------------- counters */}
        <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Calls checked", calls, ""],
            ["Passed", passed, ""],
            ["Refunds paid", refunds, ""],
            ["Refunded", refunded, "$"],
          ].map(([label, value, prefix], i) => (
            <div key={label} className="card rise rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur" style={{ animationDelay: `${420 + i * 80}ms` }}>
              <div className="text-3xl font-bold tabular-nums">
                {value === "–" ? "–" : `${prefix}${value}`}
              </div>
              <div className="mt-1 text-sm text-zinc-400">{label}</div>
            </div>
          ))}
        </section>
        {stats && (
          <p className="mt-2 text-xs text-zinc-500">
            {network}. Of {stats.calls} calls: {stats.by_source.agent} from outside agents, {stats.by_source.demo} from the demo buttons below,{" "}
            {stats.by_source.scan} from the scanner. Amounts are test money.
          </p>
        )}

        {/* ---------------------------------------------------------- ticker */}
        {stats && stats.recent.length > 0 && (
          <div className="fade-x mt-8 overflow-hidden rounded-full border border-zinc-800 bg-zinc-950/60 py-2 text-sm">
            <div className="ticker">
              {[...stats.recent, ...stats.recent, ...stats.recent, ...stats.recent].map((r, i) => (
                <span key={i} className="mx-5 inline-flex items-center gap-2 whitespace-nowrap text-zinc-400">
                  <span className={`font-bold ${r.verdict === "pass" ? "text-emerald-400" : "text-rose-400"}`}>{r.verdict === "pass" ? "✓ PASS" : "✗ FAIL"}</span>
                  {r.host} · ${r.paid}
                  {r.refund_tx && <span className="text-emerald-300">→ refunded</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------ demo */}
        <Reveal>
          <section id="demo" className="mt-16 scroll-mt-6 overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 p-6 backdrop-blur sm:p-8">
            <h2 className="text-2xl font-bold sm:text-3xl">Watch it happen</h2>
            <p className="mt-2 max-w-2xl text-zinc-400">
              These buttons run a real agent with a funded test wallet against <code className="text-zinc-200">Flaky Weather</code>, a paid
              service built to break on request. Real payments move on Tempo testnet each time.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button disabled={!!running} onClick={() => run("pass")} className="btn rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-zinc-950 shadow-lg shadow-emerald-500/30 disabled:opacity-50">
                {running === "pass" ? "Running…" : "☀️ Buy from a service that works"}
              </button>
              <button disabled={!!running} onClick={() => run("fail")} className="btn rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white shadow-lg shadow-rose-500/30 disabled:opacity-50">
                {running === "fail" ? "Running…" : "💥 Buy from a service that breaks"}
              </button>
            </div>

            <Stage phase={phase} verdict={verdict} scenario={running ?? demo?.scenario ?? null} />

            {error && <p className="pop mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

            {demo && (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="pop relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                  {demo.outcome.refund?.tx &&
                    RAIN.map((c, i) => (
                      <span key={i} className="rain" style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, ["--r" as string]: c.r }}>🪙</span>
                    ))}
                  <div className="text-xs uppercase tracking-wider text-zinc-500">The money</div>
                  <dl className="mt-3 space-y-2 text-sm">
                    <Row k="Service price" v={`$${demo.outcome.price.target}`} />
                    <Row k="Warranty premium" v={`$${demo.outcome.price.premium}`} />
                    <Row k="Agent paid" v={`$${demo.outcome.price.total}`} strong />
                    {demo.outcome.target_receipt?.reference && <Row k="Service's receipt" v={short(demo.outcome.target_receipt.reference)} mono />}
                    {demo.outcome.refund?.tx && <Row k="Refund sent" v={`$${demo.outcome.refund.amount}`} strong good />}
                    {demo.outcome.refund?.tx && <Row k="Refund transaction" v={short(demo.outcome.refund.tx)} mono />}
                    {demo.outcome.refund && !demo.outcome.refund.tx && <Row k="Refund" v={demo.outcome.refund.status.replace(/_/g, " ")} />}
                  </dl>
                  <p className="mt-4 text-xs text-zinc-500">
                    Took {((demo.steps[0].ms + demo.steps[1].ms) / 1000).toFixed(1)}s end to end. {demo.steps[0].quote?.terms}
                  </p>
                </div>

                <div className={`pop relative rounded-2xl border p-5 ${verdict === "pass" ? "glow-good border-emerald-700 bg-emerald-500/5" : "glow-bad border-rose-700 bg-rose-500/5"}`} style={{ animationDelay: "120ms" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs uppercase tracking-wider text-zinc-500">The verdict</div>
                    <span className={`stamp rounded-lg border-2 px-3 py-1 text-sm font-black tracking-widest ${verdict === "pass" ? "border-emerald-400 text-emerald-300" : "border-rose-400 text-rose-300"}`}>
                      {verdict === "pass" ? "PASS" : demo.outcome.refund?.tx ? "REFUNDED" : "FAIL"}
                    </span>
                  </div>
                  {verdict === "fail" && (
                    <p className="mt-2 text-sm font-medium text-rose-200">{REASONS[demo.outcome.failure_reason ?? ""] ?? demo.outcome.failure_reason}</p>
                  )}
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {demo.outcome.checks.map((c, i) => (
                      <li key={c.name} className="check-row flex gap-2" style={{ animationDelay: `${250 + i * 110}ms` }}>
                        <span className={c.ok ? "text-emerald-400" : "text-rose-400"}>{c.ok ? "✓" : "✗"}</span>
                        <span className="text-zinc-300">{c.name.replace(/_/g, " ")}</span>
                        <span className="truncate text-zinc-500">{c.ok ? c.expected : `expected ${c.expected}, got ${c.actual}`}</span>
                      </li>
                    ))}
                  </ul>
                  <a href={`/api/certificate/${demo.outcome.id}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-emerald-300 underline underline-offset-4 transition hover:text-emerald-200">
                    🔏 View the signed certificate
                  </a>
                </div>
              </div>
            )}
          </section>
        </Reveal>

        {/* ---------------------------------------------------- how it works */}
        <section className="mt-16">
          <Reveal><h2 className="text-2xl font-bold sm:text-3xl">How it works</h2></Reveal>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              ["🧾", "Quote", "Your agent sends the URL it wants to buy from and a contract. Warranty reads the service's price and answers 402 with that price plus a premium."],
              ["💸", "Pay once", "Your agent pays Warranty. Warranty pays the service from its own pool and collects the service's receipt."],
              ["🔍", "Check", "Status, format, JSON shape, size, speed, receipt and price are checked against your contract."],
              ["🛡️", "Result or refund", "Pass: you get the result and a signed certificate. Fail: the full amount goes back to your wallet, with the reason."],
            ].map(([icon, t, d], i) => (
              <Reveal key={t} delay={i * 90}>
                <div className="card h-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400/10 text-lg">{icon}</span>
                    <span className="font-mono text-xs text-emerald-400">0{i + 1}</span>
                  </div>
                  <div className="mt-3 font-semibold">{t}</div>
                  <p className="mt-2 text-sm text-zinc-400">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mt-5 max-w-3xl rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-zinc-300">
              <b className="text-emerald-300">The price is a signal.</b> The premium follows each service&apos;s track record: the more often it
              has failed, the more it costs to cover. An agent can read how reliable a service is from the 402, before spending anything.
            </p>
          </Reveal>
        </section>

        {/* ------------------------------------------------------ scoreboard */}
        <Reveal>
          <section className="mt-16">
            <h2 className="text-2xl font-bold sm:text-3xl">Reliability scoreboard</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Pass rate over the last 7 days of calls through Warranty. Always read it with the number of calls. No hidden formula.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/50 backdrop-blur">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-zinc-900/80 text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Service</th><th className="px-4 py-3">Pass rate</th><th className="px-4 py-3">Calls</th>
                    <th className="px-4 py-3">Median time</th><th className="px-4 py-3">Most common failure</th>
                  </tr>
                </thead>
                <tbody>
                  {services.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-zinc-500">No calls recorded yet. Run the demo above.</td></tr>
                  )}
                  {services.map((s) => (
                    <tr key={s.host} className="border-t border-zinc-800 transition hover:bg-white/[0.03]">
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-zinc-500">{s.host}{s.category ? ` · ${s.category}` : ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        {s.pass_rate === null ? <span className="text-zinc-500">{s.callable ? "not scanned yet" : "not scanned"}</span> : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-zinc-800">
                              <div className={`bar h-full rounded-full ${s.pass_rate >= 0.9 ? "bg-emerald-400" : s.pass_rate >= 0.5 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${s.pass_rate * 100}%` }} />
                            </div>
                            <span className="tabular-nums">{Math.round(s.pass_rate * 100)}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{s.n}</td>
                      <td className="px-4 py-3 tabular-nums">{s.median_latency_ms ? `${(s.median_latency_ms / 1000).toFixed(1)}s` : "–"}</td>
                      <td className="px-4 py-3 text-zinc-400">{s.top_failure ? REASONS[s.top_failure] ?? s.top_failure : s.note ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </Reveal>

        {/* ------------------------------------------------- use it / limits */}
        <section id="use" className="mt-16 grid scroll-mt-6 gap-6 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-2xl font-bold sm:text-3xl">Use it from your agent</h2>
            <p className="mt-2 text-sm text-zinc-400">One request. No sign-up and no API key: the payment is the authentication.</p>
            <div className="group relative mt-4">
              <pre className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">{snippet}</pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(snippet);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="btn absolute right-3 top-3 rounded-lg bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/15"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              Agents can read the full guide at <a className="text-emerald-300 underline underline-offset-4" href="/llms.txt">/llms.txt</a>.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="text-2xl font-bold sm:text-3xl">Honest limits</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-400">
              <li><b className="text-zinc-200">It checks form, not truth.</b> Status, format, shape, size, speed, price and receipt can be checked automatically. Whether the data is correct cannot.</li>
              <li><b className="text-zinc-200">Test money.</b> The pool and every refund are on {network} until this moves to mainnet.</li>
              <li><b className="text-zinc-200">New services are checked, not covered.</b> A service needs a track record before failures are refunded. Otherwise anyone could run a broken service and collect refunds on it.</li>
              <li><b className="text-zinc-200">Small numbers.</b> Scores come from few calls so far. Read the call count next to every percentage.</li>
            </ul>
          </Reveal>
        </section>

        {/* ---------------------------------------------------- latest calls */}
        {stats && stats.recent.length > 0 && (
          <Reveal>
            <section className="mt-16">
              <h2 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl">
                Latest calls <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" />
              </h2>
              <ul className="mt-4 divide-y divide-zinc-800 rounded-2xl border border-zinc-800 bg-zinc-950/50 text-sm backdrop-blur">
                {stats.recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-white/[0.03]">
                    <span className={`w-12 font-bold ${r.verdict === "pass" ? "text-emerald-400" : "text-rose-400"}`}>{r.verdict.toUpperCase()}</span>
                    <span className="text-zinc-300">{r.host}</span>
                    <span className="text-zinc-500">${r.paid} · {r.source}</span>
                    {r.failure_reason && <span className="text-zinc-400">{REASONS[r.failure_reason] ?? r.failure_reason}</span>}
                    {r.refund_tx && <span className="font-mono text-xs text-emerald-300">refunded {short(r.refund_tx, 8)}</span>}
                    <a className="ml-auto text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300" href={`/api/certificate/${r.id}`} target="_blank" rel="noreferrer">certificate</a>
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
        )}

        <footer className="mt-16 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          Warranty wallet (signs certificates, pays refunds): <span className="font-mono">{wallet}</span>. Built on MPP with mppx, deployed with Stripe Projects.
        </footer>
      </main>
    </>
  );
}

/** The animated story of one call: tokens fly between the agent, Warranty and the service. */
function Stage({ phase, verdict, scenario }: { phase: number; verdict?: "pass" | "fail"; scenario: "pass" | "fail" | null }) {
  if (phase === 0) return null;
  const A = "12%", W = "50%", S = "88%";
  const done = phase === 6;
  const failed = done && verdict === "fail";

  // One travelling token per phase. `key` restarts the animation each time.
  let token: { from: string; to: string; label: string; cls: string } | null = null;
  if (phase === 1) token = { from: A, to: W, label: "POST /api/call", cls: "bg-zinc-700 text-zinc-100" };
  if (phase === 2) token = { from: W, to: A, label: "402 · quote", cls: "bg-amber-400 text-zinc-950" };
  if (phase === 3) token = { from: A, to: W, label: "🪙 pay", cls: "coin bg-emerald-400 text-zinc-950" };
  if (phase === 4) token = { from: W, to: S, label: "🪙 pay", cls: "coin bg-emerald-400 text-zinc-950" };
  if (phase === 5) token = { from: S, to: W, label: scenario === "fail" ? "📄 <html>oops" : "📄 {json}", cls: scenario === "fail" ? "bg-rose-500 text-white" : "bg-sky-400 text-zinc-950" };
  if (done) token = failed ? { from: W, to: A, label: "🪙 refund", cls: "coin bg-emerald-400 text-zinc-950" } : { from: W, to: A, label: "✓ result + certificate", cls: "bg-emerald-400 text-zinc-950" };

  const on = (n: "a" | "w" | "s") =>
    (n === "a" && [1, 3].includes(phase)) || (n === "w" && [2, 4].includes(phase)) || (n === "s" && phase === 5) || (done && n !== "s");
  const caption = done
    ? failed
      ? "The service broke. Warranty sent the agent's money back. No human involved."
      : "Everything checked out. The agent gets its result and a signed certificate."
    : CAPTIONS[phase];

  return (
    <div className="mt-7">
      <div className="stage rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-10 sm:px-6">
        <div className="wire" style={{ left: "18%", width: "26%" }} />
        <div className="wire" style={{ left: "56%", width: "26%" }} />
        {token && (
          <span key={`${phase}-${token.label}`} className={`token rounded-full px-3 py-1 text-xs font-bold shadow-lg ${token.cls}`} style={{ ["--from" as string]: token.from, ["--to" as string]: token.to }}>
            {token.label}
          </span>
        )}
        <div className="relative z-10 grid grid-cols-3 items-center gap-2 text-center">
          <Node emoji="🤖" title="Agent" sub="has a wallet" on={on("a")} />
          <Node emoji="🛡️" title="Warranty" sub="pays, checks, refunds" on={on("w")} busy={phase === 5} />
          <Node emoji={failed || (phase >= 5 && scenario === "fail") ? "⛈️" : "🌦️"} title="Flaky Weather" sub="paid MPP service" on={on("s")} bad={phase >= 5 && scenario === "fail"} />
        </div>
      </div>
      <p key={caption} className="rise mt-3 text-center text-sm font-medium text-zinc-300">{caption}</p>
      <ol className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <li key={i} className={`h-1.5 rounded-full transition-all duration-500 ${phase >= i ? (failed ? "w-8 bg-rose-400" : "w-8 bg-emerald-400") : "w-3 bg-zinc-700"}`} />
        ))}
      </ol>
    </div>
  );
}

function Node({ emoji, title, sub, on, bad, busy }: { emoji: string; title: string; sub: string; on?: boolean; bad?: boolean; busy?: boolean }) {
  return (
    <div className={`node mx-auto w-full max-w-[150px] rounded-2xl border border-zinc-700 bg-zinc-900 px-2 py-4 ${on ? "on" : ""} ${bad ? "bad" : ""}`}>
      <div className={`text-3xl sm:text-4xl ${busy ? "bob" : ""}`}>{emoji}</div>
      <div className="mt-1 text-sm font-semibold">{title}</div>
      <div className="hidden text-xs text-zinc-500 sm:block">{sub}</div>
    </div>
  );
}

function Row({ k, v, strong, mono, good }: { k: string; v: string; strong?: boolean; mono?: boolean; good?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-400">{k}</dt>
      <dd className={`${strong ? "font-bold" : ""} ${mono ? "font-mono text-xs" : ""} ${good ? "text-emerald-300" : "text-zinc-100"}`}>{v}</dd>
    </div>
  );
}
