import { describe, it, expect } from "vitest";
import { richTextToPlainText, isBlankRichText } from "@workspace/api-types";

/* The helpers live in the shared types package so the dashboard, the phone and
   the server read a formatted action step the same way. Tested here because
   that package has no test runner of its own. */

describe("richTextToPlainText", () => {
  it("passes plain text through untouched", () => {
    expect(richTextToPlainText("Cold call\nmore widely")).toBe("Cold call\nmore widely");
  });

  it("puts each paragraph on its own line and drops bold and italics", () => {
    expect(richTextToPlainText("<p><strong>Cold call</strong> more <em>widely</em></p><p>Then wait</p>"))
      .toBe("Cold call more widely\nThen wait");
  });

  it("keeps bullets as bullet lines", () => {
    expect(richTextToPlainText("<ul><li><p>One</p></li><li><p>Two</p></li></ul>")).toBe("• One\n• Two");
  });

  it("joins everything onto one line when asked", () => {
    expect(richTextToPlainText("<p>Intro</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>", { singleLine: true }))
      .toBe("Intro • One • Two");
    expect(richTextToPlainText("Plain\n\nwith gaps", { singleLine: true })).toBe("Plain with gaps");
  });

  it("decodes what the editor escapes, once", () => {
    expect(richTextToPlainText("<p>3 &lt; 5 &amp;&amp; Q&amp;A&nbsp;time</p>")).toBe("3 < 5 && Q&A time");
    /* Somebody who typed "&lt;" literally gets "&lt;" back, not "<". */
    expect(richTextToPlainText("<p>&amp;lt;</p>")).toBe("&lt;");
  });

  it("does not turn escaped text back into tags", () => {
    expect(richTextToPlainText("<p>&lt;b&gt;not bold&lt;/b&gt;</p>")).toBe("<b>not bold</b>");
  });

  it("drops the empty bullet an abandoned list leaves behind", () => {
    expect(richTextToPlainText("<p>Step</p><ul><li><p></p></li></ul>")).toBe("Step");
  });

  it("gives nothing for nothing", () => {
    expect(richTextToPlainText("")).toBe("");
    expect(richTextToPlainText(null)).toBe("");
    expect(richTextToPlainText(undefined)).toBe("");
  });
});

describe("isBlankRichText", () => {
  it("treats every spelling of an empty editor as blank", () => {
    for (const blank of ["", "   ", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<ul><li><p></p></li></ul>"]) {
      expect(isBlankRichText(blank)).toBe(true);
    }
    expect(isBlankRichText(null)).toBe(true);
    expect(isBlankRichText(undefined)).toBe(true);
  });

  it("does not mistake real words for blank", () => {
    expect(isBlankRichText("<p>0</p>")).toBe(false);
    expect(isBlankRichText("Plain words")).toBe(false);
    expect(isBlankRichText("<ul><li><p>Step</p></li></ul>")).toBe(false);
  });
});
