import { describe, expect, it } from "vitest";
import { decodeXml } from "./xml.js";

describe("decodeXml", () => {
  it("decodes the predefined entities in one pass", () => {
    expect(decodeXml("St. Stephen&apos;s &amp; &quot;Green&quot; &#39;x&#39; &lt;b&gt;")).toBe(`St. Stephen's & "Green" 'x' <b>`);
  });

  it("does not double-unescape an escaped ampersand", () => {
    expect(decodeXml("&amp;apos; &amp;amp;")).toBe("&apos; &amp;");
  });
});
