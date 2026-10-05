"use client";

import Link from "next/link";
import { Check, FlaskConical, LineChart, Lock, ShieldCheck, Zap } from "lucide-react";
import { SaferGambling } from "./ui";

/** What a signed-out visitor sees at /members: what the platform is, the three ways in, and join / sign in. */
export default function Landing() {
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <section className="space-y-4 pt-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">GoalBrew Members · Beta</p>
        <h1 className="font-display text-3xl font-bold text-ink [font-stretch:115%] sm:text-4xl">Football betting strategies, measured properly.</h1>
        <p className="mx-auto max-w-2xl text-sm text-ink-muted sm:text-base">
          See how the house strategies are really doing, follow them with a simulated bank, and track your own results bet by bet. Free to join; no card
          needed.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/members/join" className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink">
            Create free account
          </Link>
          <Link href="/login?next=/members" className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink">
            Sign in
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: LineChart, title: "Real results", text: "Every win and loss comes from the recorded alerts. Nothing is typed in or rounded up." },
          { icon: FlaskConical, title: "Risk-free simulation", text: "Follow strategies with a practice bank and see what your staking would have done." },
          { icon: ShieldCheck, title: "Built-in limits", text: "Stake caps, daily loss limits and stop losses, enforced on every bet." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-line bg-surface p-4">
            <Icon size={20} className="text-accent" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-sm text-ink-muted">{text}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Plan
          name="Free"
          price="£0, always"
          points={["Every house strategy's name", "Today's and this week's wins, losses and hit rate", "Simulation bank following any strategy", "Your simulated results"]}
          locked={["How each strategy works", "Which games qualify"]}
        />
        <Plan
          name="7-day Premium Trial"
          price="Free, start when you're ready"
          highlight
          points={["Choose 3 strategies", "Full detail for those 3", "Qualifying games and upcoming opportunities", "Advanced staking, risk controls and analytics"]}
          locked={["Live betting"]}
        />
        <Plan
          name="Member"
          price="Monthly subscription"
          points={["Every strategy in full", "All selections and opportunities", "Full history and analytics", "Create your own strategies", "Betfair automation, where available"]}
          icon={<Zap size={14} aria-hidden />}
        />
      </section>

      <SaferGambling />
    </div>
  );
}

function Plan({ name, price, points, locked = [], highlight = false, icon }: { name: string; price: string; points: string[]; locked?: string[]; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-accent bg-accent/5" : "border-line bg-surface"}`}>
      <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
        {icon}
        {name}
      </p>
      <p className="text-xs text-ink-muted">{price}</p>
      <ul className="mt-3 space-y-1.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-sm text-ink">
            <Check size={16} className="mt-0.5 shrink-0 text-hit" aria-hidden />
            {p}
          </li>
        ))}
        {locked.map((p) => (
          <li key={p} className="flex gap-2 text-sm text-ink-muted">
            <Lock size={14} className="mt-1 shrink-0" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
