"use client";

// The Refund Console: the person's side of the refund flow. Set the auto-refund
// limit, see the orders, and Approve or Reject the refunds the app held back
// for a person. It refreshes every few seconds so refunds asked for in the
// chat show up on their own.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/copper/catalog";
import {
  changeLimit,
  decide,
  getConsoleState,
  type ConsoleState,
} from "@/lib/copper/refunds/actions";
import type { RefundStatus } from "@/lib/copper/refunds/store";

const STATUS: Record<RefundStatus, string> = {
  auto_approved: "Refunded, automatically",
  pending: "Waiting for you",
  approved: "Refunded, approved by you",
  rejected: "Rejected by you",
};

export function RefundConsole() {
  const [data, setData] = useState<ConsoleState | null>(null);
  const [limit, setLimit] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let first = true;
    const load = async () => {
      const next = await getConsoleState();
      setData(next);
      if (first) {
        first = false;
        setLimit(String(next.limitUsd));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, []);

  async function saveLimit() {
    const usd = Number(limit);
    if (limit.trim() === "" || !Number.isFinite(usd) || usd < 0) {
      setError("Enter a number, 0 or more.");
      return;
    }
    setError("");
    setData(await changeLimit(usd));
  }

  async function choose(id: string, decision: "approved" | "rejected") {
    setData(await decide(id, decision));
  }

  const pending = data?.requests.filter((r) => r.status === "pending") ?? [];

  return (
    <div className="mt-6 space-y-8">
      <section className="bg-card rounded-xl border p-4">
        <h2 className="font-semibold">Auto-refund limit</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Refunds at or under this amount go through on their own. Bigger ones
          wait here for you. Set it to 0 and every refund waits.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveLimit();
          }}
        >
          <span className="text-lg font-semibold">$</span>
          <input
            aria-label="Auto-refund limit in dollars"
            inputMode="decimal"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="bg-background focus-visible:ring-ring h-10 w-28 rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <Button type="submit">Save limit</Button>
          {data && (
            <span
              data-testid="current-limit"
              className="text-muted-foreground text-sm"
            >
              Now: {formatUsd(data.limitUsd)}
            </span>
          )}
        </form>
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
      </section>

      <section>
        <h2 className="font-semibold">
          Waiting for your approval{pending.length > 0 && ` (${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            Nothing is waiting. Refunds over the limit will stop here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((r) => (
              <li
                key={r.id}
                data-testid="pending-refund"
                className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-4"
              >
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {r.orderId} · {r.item} · {formatUsd(r.amountUsd)}
                  </p>
                  <p className="text-muted-foreground">
                    {r.customer}. Reason: {r.reason}
                  </p>
                </div>
                <Button onClick={() => void choose(r.id, "approved")}>
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void choose(r.id, "rejected")}
                >
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold">
          {data?.orders[0]?.customer ?? "Customer"}&apos;s orders
        </h2>
        <ul className="mt-2 divide-y rounded-xl border">
          {data?.orders.map((o) => {
            const refund = data.requests.find((r) => r.orderId === o.id);
            return (
              <li
                key={o.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="text-muted-foreground font-mono">{o.id}</span>
                <span className="flex-1 font-medium">{o.item}</span>
                <Badge
                  variant={
                    refund?.status === "rejected" ? "destructive" : "secondary"
                  }
                >
                  {refund ? STATUS[refund.status] : "Paid"}
                </Badge>
                <span className="w-16 text-right font-mono">
                  {formatUsd(o.amountUsd)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
