import { describe, expect, it } from "vitest";
import { channelOf, currentChannel, currentSynthetic, isSyntheticRequest, withRequestScope } from "./requestScope.js";

describe("request scope", () => {
  it("accepts only the exact synthetic header value", () => {
    expect(isSyntheticRequest(new Headers({ "x-ireland-mcp-synthetic": "1" }))).toBe(true);
    expect(isSyntheticRequest(new Headers({ "x-ireland-mcp-synthetic": "true" }))).toBe(false);
    expect(isSyntheticRequest(new Headers())).toBe(false);
  });

  it("treats only the project website as the playground channel", () => {
    expect(channelOf(new Headers({ origin: "https://irishopendata.ie" }))).toBe("playground");
    for (const origin of ["https://claude.ai", "https://chatgpt.com", "vscode-webview://abc", "http://localhost:7071"]) {
      expect(channelOf(new Headers({ origin }))).toBe("client");
    }
    expect(channelOf(new Headers())).toBe("client");
  });

  it("carries the flag across awaits and nowhere else", async () => {
    expect(currentSynthetic()).toBe(false);
    const inside = await withRequestScope({ synthetic: true, channel: "playground" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [currentSynthetic(), currentChannel()];
    });
    expect(inside).toEqual([true, "playground"]);
    expect([currentSynthetic(), currentChannel()]).toEqual([false, "client"]);
  });
});
