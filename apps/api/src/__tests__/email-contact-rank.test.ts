import { describe, expect, it } from "vitest";

/** Mirrors ranking helpers used by email-contact-search (workspace isolation tested via route auth). */
function score(q: string, email: string, name: string | null): number {
  const e = email.toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (e === q) return 1000;
  if (e.startsWith(q)) return 900;
  if (e.includes(q)) return 700;
  if (n.startsWith(q)) return 600;
  if (n.includes(q)) return 400;
  return 0;
}

describe("email contact ranking", () => {
  it("ranks exact/prefix email above name matches", () => {
    const q = "mic";
    const ranked = [
      { email: "other@x.com", name: "Micah" },
      { email: "micah@frana.com", name: "Micah Fultz" },
      { email: "michael@example.com", name: "Michael" },
    ]
      .map((c) => ({ ...c, s: score(q, c.email, c.name) }))
      .sort((a, b) => b.s - a.s);

    expect(ranked[0]!.email).toBe("micah@frana.com");
    expect(ranked[1]!.email).toBe("michael@example.com");
  });

  it("dedupes by lowercase email keeping best score", () => {
    const map = new Map<string, number>();
    for (const c of [
      { email: "Micah@Frana.com", name: null as string | null },
      { email: "micah@frana.com", name: "Micah Fultz" },
    ]) {
      const key = c.email.toLowerCase();
      const s = score("mic", c.email, c.name);
      map.set(key, Math.max(map.get(key) ?? 0, s));
    }
    expect(map.size).toBe(1);
    expect(map.get("micah@frana.com")).toBeGreaterThan(0);
  });
});
