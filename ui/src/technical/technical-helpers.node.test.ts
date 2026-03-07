import { describe, expect, it } from "vitest";
import { cycleModelId, formatModelLabel, resolveAgentSessionKey } from "./technical-helpers.ts";

describe("technical helpers", () => {
  it("formats model labels with provider", () => {
    expect(formatModelLabel({ id: "gpt-5", name: "GPT-5", provider: "openai" })).toBe(
      "GPT-5 (openai)",
    );
  });

  it("cycles model ids in both directions", () => {
    const models = [
      { id: "a", name: "A", provider: "p" },
      { id: "b", name: "B", provider: "p" },
      { id: "c", name: "C", provider: "p" },
    ];
    expect(cycleModelId(models, "a", "next")).toBe("b");
    expect(cycleModelId(models, "a", "prev")).toBe("c");
    expect(cycleModelId(models, "unknown", "next")).toBe("b");
  });

  it("builds agent main session keys", () => {
    expect(resolveAgentSessionKey("dev")).toBe("agent:dev:main");
  });
});
