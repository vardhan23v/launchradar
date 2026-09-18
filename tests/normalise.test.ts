import { describe, expect, it } from "vitest";
import { normalise } from "../src/lib/serpapi/normalise";

const googleFixture = {
  search_metadata: { id: "sim_1" },
  organic_results: [
    { position: 1, title: "Noise in the room", link: "https://a.com/x", snippet: "Real pain from users." },
  ],
  related_searches: [{ query: "silent study app india" }],
  // no related_questions, no discussions_and_forums, no ads
};

describe("normalise", () => {
  it("every block is optional — missing related_questions does not throw", () => {
    const rows = normalise("google", googleFixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].blockType).toBe("organic");
    expect(rows[1].blockType).toBe("related_search");
  });

  it("extracts related_questions with question + snippet", () => {
    const rows = normalise("google", {
      related_questions: [
        { question: "Is X free?", link: "https://b.com", snippet: "Users report it is not." },
      ],
    });
    expect(rows[0].blockType).toBe("related_question");
    expect(rows[0].title).toBe("Is X free?");
    expect(rows[0].snippet).toContain("Users report it is not.");
  });

  it("normalises reviews with rating metadata", () => {
    const rows = normalise("google_play_product", {
      reviews: [{ title: "Great", snippet: "Works well", rating: 4.5 }],
    });
    expect(rows[0].blockType).toBe("review");
    expect(rows[0].meta.rating).toBe(4.5);
  });

  it("extracts trend points and rising queries", () => {
    const rows = normalise("google_trends", {
      interest_over_time: {
        timeline_data: [
          { formattedTime: "2025-09", value: [38] },
          { formattedTime: "2025-12", value: [52] },
        ],
      },
      rising_related_queries: [{ query: "ai tutor for board exams" }],
    });
    const points = rows.filter((r) => r.blockType === "trend_point");
    expect(points).toHaveLength(2);
    expect(points[0].text).toBe("38");
    expect(rows.some((r) => r.blockType === "rising_query")).toBe(true);
  });

  it("handles a completely unknown response shape without throwing", () => {
    expect(() => normalise("google", { whatever: [{ nested: true }] })).not.toThrow();
    expect(normalise("google_maps", {})).toEqual([]);
  });
});