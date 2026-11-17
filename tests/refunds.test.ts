// The refund rules live in code, so they are tested without any model: the
// limit, the one-refund-per-order rule, and the person's decision.
import { beforeEach, describe, expect, it } from "vitest";
import {
  decideRefund,
  requestRefund,
  resetRefunds,
  setLimit,
} from "@/lib/copper/refunds/store";

beforeEach(() => resetRefunds());

describe("refund rules", () => {
  it("auto-approves at or under the limit and holds anything over it", () => {
    setLimit(79);
    expect(requestRefund("CS-1002", "x").outcome).toBe("auto_approved");
    expect(requestRefund("CS-1003", "x").outcome).toBe("needs_human_approval");
  });

  it("refunds an order only once, even when asked twice or after a rejection", () => {
    expect(requestRefund("CS-1001", "x").outcome).toBe("auto_approved");
    expect(requestRefund("cs-1001", "again").outcome).toBe("duplicate");

    const held = requestRefund("CS-1004", "x");
    if (held.outcome !== "needs_human_approval") throw new Error("not held");
    decideRefund(held.request.id, "rejected");
    expect(requestRefund("CS-1004", "please").outcome).toBe("duplicate");
  });

  it("sends every refund to a person when the limit is 0", () => {
    setLimit(0);
    expect(requestRefund("CS-1001", "x").outcome).toBe("needs_human_approval");
  });

  it("lets a person decide a held refund once", () => {
    setLimit(0);
    const held = requestRefund("CS-1001", "x");
    if (held.outcome !== "needs_human_approval") throw new Error("not held");
    expect(decideRefund(held.request.id, "approved").status).toBe("approved");
    expect(() => decideRefund(held.request.id, "rejected")).toThrow();
  });

  it("rejects unknown orders and bad limits", () => {
    expect(requestRefund("CS-9999", "x").outcome).toBe("not_found");
    expect(() => setLimit(-5)).toThrow();
    expect(() => setLimit(Number.NaN)).toThrow();
  });
});
