import { describe, expect, it } from "vitest";
import { validHighlights } from "./highlights";

describe("validHighlights", () => {
  const cats = ["cyclists", "cars", "pedestrians"] as const;

  it("null is the whole video", () => {
    expect(validHighlights(null, cats)).toBeNull();
    expect(validHighlights(undefined, cats)).toBeNull();
  });

  it("keeps the cut categories that are in the video, in category order", () => {
    expect(validHighlights({ before_s: 2.5, after_s: 3, categories: ["pedestrians", "mopeds", "cyclists"] }, cats)).toEqual({
      before_s: 2.5,
      after_s: 3,
      categories: ["cyclists", "pedestrians"],
    });
  });

  it("all the video categories (or none given) = null", () => {
    expect(validHighlights({ before_s: 2, after_s: 2, categories: [...cats] }, cats)?.categories).toBeNull();
    expect(validHighlights({ before_s: 2, after_s: 2 }, cats)?.categories).toBeNull();
  });

  it("refuses seconds out of range and an empty cut list", () => {
    expect(validHighlights({ before_s: 0, after_s: 2 }, cats)).toBeUndefined();
    expect(validHighlights({ before_s: 2, after_s: 31 }, cats)).toBeUndefined();
    expect(validHighlights({ before_s: "2", after_s: 2 }, cats)).toBeUndefined();
    expect(validHighlights({ before_s: 2, after_s: 2, categories: ["mopeds"] }, cats)).toBeUndefined();
    expect(validHighlights("x", cats)).toBeUndefined();
  });
});
