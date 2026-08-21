import { describe, expect, it } from "vitest";

import { paginateTakePlusOne } from "../interfaces/http/routes/inbox-read.route.js";

describe("paginateTakePlusOne", () => {
  it("hasMore false when rows <= pageSize", () => {
    expect(paginateTakePlusOne([1, 2, 3], 30)).toEqual({
      items: [1, 2, 3],
      hasMore: false,
    });
    expect(paginateTakePlusOne([1, 2, 3], 3)).toEqual({
      items: [1, 2, 3],
      hasMore: false,
    });
  });

  it("hasMore true and trims extra row when rows = pageSize + 1", () => {
    const rows = Array.from({ length: 31 }, (_, i) => i + 1);
    expect(paginateTakePlusOne(rows, 30)).toEqual({
      items: rows.slice(0, 30),
      hasMore: true,
    });
  });
});
