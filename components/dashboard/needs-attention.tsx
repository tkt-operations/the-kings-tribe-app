import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AttentionCard } from "@/lib/notifications/attention";

/**
 * "What still requires action" — live workflow state for the cards this user
 * may act on (never notification history, and it creates no records).
 * Renders nothing for users who cannot act on any of them.
 */
export function NeedsAttention({ cards }: { cards: AttentionCard[] }) {
  if (cards.length === 0) return null;
  const waiting = cards.filter((c) => c.count > 0);
  return (
    <section aria-labelledby="needs-attention-title" className="mb-8">
      <h2 id="needs-attention-title" className="mb-3 font-serif text-2xl">Needs attention</h2>
      {waiting.length === 0 ? (
        <p className="flex items-center gap-2 rounded-[var(--radius-card)] bg-white px-4 py-4 text-sm text-navy/70 ring-1 ring-navy/10">
          <CheckCircle2 className="size-5 text-kingdom-green" aria-hidden /> You&rsquo;re all caught up — nothing is waiting on you.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <li key={card.key} className="min-w-0">
              <Link
                href={card.href}
                className={cn(
                  "group flex h-full min-h-24 items-start justify-between gap-3 rounded-[var(--radius-card)] bg-white p-4 ring-1 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-gold/40",
                  card.emphasis ? "ring-energy-orange/50" : "ring-navy/10",
                  card.count === 0 && "opacity-70",
                )}
                aria-label={`${card.title}: ${card.count}${card.details.length ? ` (${card.details.join(", ")})` : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-navy">{card.title}</p>
                  <p className="mt-0.5 text-[13px] text-navy/60">{card.hint}</p>
                  {card.details.length ? (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {card.details.map((d) => (
                        <span key={d} className={cn("rounded-full px-2 py-0.5 text-xs font-bold", d.includes("Essential") ? "bg-energy-orange/15 text-navy" : "bg-navy/[0.06] text-navy/75")}>{d}</span>
                      ))}
                    </p>
                  ) : null}
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular font-serif text-3xl text-navy">{card.count}</span>
                  <ArrowRight className="size-4 text-navy/40 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
