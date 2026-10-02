import { describe, expect, it } from "vitest";
import { advertisers, bidStatusEnum, bids, campaignClosings, campaignStatusEnum, campaigns, creators, genreEnum, platformEnum } from "./schema.js";

describe("schema", () => {
  it("exports a table object for every entity in the data model", () => {
    expect(advertisers).toBeDefined();
    expect(creators).toBeDefined();
    expect(campaigns).toBeDefined();
    expect(bids).toBeDefined();
    expect(campaignClosings).toBeDefined();
  });

  it("defines the genre enum with all 8 values from the brief", () => {
    expect(genreEnum.enumValues).toEqual([
      "fitness",
      "beauty",
      "gaming",
      "food",
      "travel",
      "tech",
      "fashion",
      "music",
    ]);
  });

  it("defines platform and status enums", () => {
    expect(platformEnum.enumValues).toEqual(["tiktok", "instagram"]);
    expect(campaignStatusEnum.enumValues).toEqual(["open", "closed"]);
    expect(bidStatusEnum.enumValues).toEqual(["active", "withdrawn", "won", "lost"]);
  });
});
