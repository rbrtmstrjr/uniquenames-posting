import { describe, expect, it } from "vitest";
import {
  CTA_MAX_LINES, CTA_MESSAGES_DEFAULT, CTA_MESSAGE_MAX, CTA_MESSAGES_MAX, ctaLines, ctaMessagesOf, parseCtaMessages, pickCtaMessage,
  resolveCta, validateCtaMessage, validateCtaMessages,
} from "@/lib/cta/messages";

describe("closing card messages", () => {
  it("the default list has about 8 varied lines, each valid, some gender-aware", () => {
    const list = parseCtaMessages(CTA_MESSAGES_DEFAULT);
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list).toContain("Follow for more / baby name ideas.");
    expect(list.some((m) => m.includes("{gender}"))).toBe(true);
    for (const m of list) expect(validateCtaMessage(m), m).toBeNull();
    expect(new Set(list.map((m) => m.toLowerCase())).size).toBe(list.length);
  });

  it("parses one message per line: trimmed, single spaces, blank lines and repeats dropped", () => {
    expect(parseCtaMessages("  Follow   for more / ideas \r\n\n\nfollow for more / ideas\nSecond one ")).toEqual(["Follow for more / ideas", "Second one"]);
    expect(parseCtaMessages("")).toEqual([]);
  });

  it("{gender} becomes boy or girl (any case), and the line breaks are tidied", () => {
    expect(resolveCta("More {gender} names tomorrow. /Follow so you don't miss them.", "girl")).toBe("More girl names tomorrow. / Follow so you don't miss them.");
    expect(resolveCta("{GENDER} names //  every day", "boy")).toBe("boy names / every day");
  });

  it("splits a message into its lines at /", () => {
    expect(ctaLines("Follow for more / baby name ideas.")).toEqual(["Follow for more", "baby name ideas."]);
    expect(ctaLines(" one line ")).toEqual(["one line"]);
    expect(ctaLines("a / / b")).toEqual(["a", "b"]);
  });

  it("validates a message: not empty, at most 3 lines and the max length, only the {gender} token", () => {
    expect(validateCtaMessage("Follow for more / baby name ideas.")).toBeNull();
    expect(validateCtaMessage("  ")).toMatch(/Type/);
    expect(validateCtaMessage(" / ")).toMatch(/Type/);
    expect(validateCtaMessage("a / b / c / d")).toMatch(new RegExp(`${CTA_MAX_LINES} lines`));
    expect(validateCtaMessage("x".repeat(CTA_MESSAGE_MAX + 1))).toMatch(/at most/);
    expect(validateCtaMessage("Follow {name} for more")).toMatch(/\{gender\}/);
  });

  it("validates the list: at least one message, at most the max, each one valid (the bad one is named)", () => {
    expect(validateCtaMessages(CTA_MESSAGES_DEFAULT)).toBeNull();
    expect(validateCtaMessages(" \n ")).toMatch(/at least one/);
    expect(validateCtaMessages(Array.from({ length: CTA_MESSAGES_MAX + 1 }, (_, i) => `Follow ${i}`).join("\n"))).toMatch(/at most/);
    expect(validateCtaMessages("Good one\na / b / c / d")).toMatch(/a \/ b \/ c \/ d/);
  });

  it("the settings value: the saved list, or the defaults when it is missing or empty", () => {
    expect(ctaMessagesOf({ cta_messages: "One\nTwo" })).toEqual(["One", "Two"]);
    expect(ctaMessagesOf({})).toEqual(parseCtaMessages(CTA_MESSAGES_DEFAULT));
    expect(ctaMessagesOf({ cta_messages: "  " })).toEqual(parseCtaMessages(CTA_MESSAGES_DEFAULT));
  });
});

describe("pickCtaMessage (least recently used, never the previous post's)", () => {
  const list = ["A one", "B {gender} two", "C three"];

  it("never-used messages first, in list order", () => {
    expect(pickCtaMessage(list, [], "boy")).toBe("A one");
    expect(pickCtaMessage(list, ["A one"], "boy")).toBe("B boy two");
  });

  it("then the one used longest ago; a gender-resolved text counts as its template", () => {
    // newest first: C (previous post), B as girl, A
    expect(pickCtaMessage(list, ["C three", "B girl two", "A one"], "girl")).toBe("A one");
    expect(pickCtaMessage(list, ["A one", "C three", "b BOY two"], "girl")).toBe("B girl two");
  });

  it("never repeats the previous post's message while another one exists", () => {
    expect(pickCtaMessage(["Only A", "Only B"], ["Only A"], "boy")).toBe("Only B");
    // a single message has to repeat
    expect(pickCtaMessage(["Only A"], ["Only A"], "boy")).toBe("Only A");
  });

  it("hand-edited texts that match no template are ignored; an empty list uses the defaults", () => {
    expect(pickCtaMessage(list, ["something the owner typed", "A one"], "boy")).toBe("B boy two");
    expect(pickCtaMessage([], [], "girl")).toBe(resolveCta(parseCtaMessages(CTA_MESSAGES_DEFAULT)[0], "girl"));
  });

  it("rotates through the whole list before any repeats", () => {
    const recent: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < list.length * 2; i++) {
      const m = pickCtaMessage(list, recent, "boy");
      seen.push(m);
      recent.unshift(m);
    }
    expect(seen).toEqual(["A one", "B boy two", "C three", "A one", "B boy two", "C three"]);
  });
});
