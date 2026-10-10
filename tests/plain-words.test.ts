import { describe, expect, it } from "vitest";
import { filipinoWord, jargonWord, plainWordsProblem } from "@/lib/ai/plain-words";

describe("filipinoWord (global audience: no Tagalog / Filipino words)", () => {
  it("finds Tagalog and Taglish words as whole words, any case, with a plural or possessive", () => {
    for (const [s, w] of [
      ["Your anak needs you tonight.", "anak"], ["Lola said never bathe a sick child.", "Lola"], ["Grandma's house, not lola's house.", "lola's"],
      ["The jeepney is waiting.", "jeepney"], ["Merienda time, mama.", "Merienda"], ["Visit the palengke together.", "palengke"],
      ["It's just kulob.", "kulob"], ["Usog is an old belief.", "Usog"], ["Hamog at night.", "Hamog"], ["Nanay knows.", "Nanay"],
      ["Tatay is home.", "Tatay"], ["Kuya shares his toy.", "Kuya"], ["The bunso cries.", "bunso"], ["Say opo to Grandma.", "opo"],
      ["Salamat, little one.", "Salamat"], ["Mahal kita.", "Mahal"], ["Ingat on the way.", "Ingat"], ["The OFW parent calls.", "OFW"],
      ["It's okay naman.", "naman"], ["Talaga, it works.", "Talaga"], ["It works, diba?", "diba"], ["Kasi he's tired.", "Kasi"],
      ["Just one lang.", "lang"], ["Hi mga mommies.", "mga"], ["He's not pasaway.", "pasaway"], ["The lolo smiles.", "lolo"],
      ["The sala at dusk.", "sala"], ["The jeep is late.", "jeep"], ["Old pamahiin say so.", "pamahiin"],
    ] as const) expect(filipinoWord(s), s).toBe(w);
  });

  it("never flags English words that merely contain them, or the English 'ate' / 'po'", () => {
    for (const s of ["She ate her peas.", "Salad first, then the slide.", "Language grows with every word.", "A salami sandwich.",
      "Lolly the bunny.", "Use a calming voice.", "The jeepers creepers song.", "Po-faced? Never.", "Grandma said it, and she meant well.",
      "Your toddler is mad, not mean.", "Ate", ""]) {
      expect(filipinoWord(s), s).toBeNull();
    }
  });
});

describe("jargonWord (plain lessons: no clinical / academic terms)", () => {
  it("finds technique, therapy, study and brain words, any case", () => {
    for (const [s, w] of [
      ["Psychologists call it affect labeling.", "affect labeling"], ["That's affect labelling.", "affect labelling"],
      ["Parent-Child Interaction Therapy says so.", "Parent-Child Interaction Therapy"], ["It comes from PCIT.", "PCIT"],
      ["Try serve and return.", "serve and return"], ["Serve-and-return play.", "Serve-and-return"], ["This is co-regulation.", "co-regulation"],
      ["It builds executive function.", "executive function"], ["The amygdala takes over.", "amygdala"], ["Cortisol rises.", "Cortisol"],
      ["A dopamine hit.", "dopamine"], ["Attachment theory says so.", "Attachment theory"], ["Her prefrontal cortex is young.", "prefrontal cortex"],
      ["He's dysregulated.", "dysregulated"], ["Her nervous system is on alert.", "nervous system"], ["A Harvard study shows it.", "Harvard"],
      ["Use labeled praise.", "labeled praise"], ["The Division of Responsibility.", "Division of Responsibility"], ["Co-viewing helps.", "Co-viewing"],
      ["Fight-or-flight mode.", "Fight-or-flight"], ["Neural pathways grow.", "Neural pathways"], ["Emotional regulation takes years.", "Emotional regulation"],
    ] as const) expect(jargonWord(s), s).toBe(w);
  });

  it("leaves plain words and the page's own catchy names alone", () => {
    for (const s of ["Child experts say naming the feeling helps kids calm down.", "Try the Two-Choice Rule.", "The Sportscaster: say what you see.",
      "Talk back and forth with your baby.", "Watch the show with her.", "Praise what she did: you stacked three blocks!", "Special Time, five minutes a day."]) {
      expect(jargonWord(s), s).toBeNull();
    }
  });
});

describe("plainWordsProblem", () => {
  it("says what is wrong, Filipino words first; null when the text is simple global English", () => {
    expect(plainWordsProblem("Your anak is tired.")).toBe('uses a Filipino / Tagalog word ("anak"): write simple English anyone understands');
    expect(plainWordsProblem("That's affect labeling.")).toBe('uses expert jargon ("affect labeling"): say it in plain everyday words');
    expect(plainWordsProblem("Name the feeling. She calms down faster.")).toBeNull();
  });
});
