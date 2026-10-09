# Red Thread Parenting Style Prompt (Z-Image Turbo)

Signature style for the parenting page: clean black and white storybook line art, with **one bright red thread tied on the wrist** as the only color. The thread is the brand trademark and appears in every image.

Swap only the **[SCENE]** and **[THREAD]** parts. Everything else stays the same.

---

## Master Prompt

```
A clean black and white ink line illustration in a simple modern storybook style. Smooth confident outlines of even thickness, simple rounded shapes, minimal details, and soft flat grey tones. Light warm grey background with subtle paper texture. The entire image is monochrome grayscale except for one single thin bright red thread, the only color in the image.

The scene has depth: the main characters in the foreground with the boldest black outlines, simple furniture in the middle ground with thinner grey lines, and the background faded into pale grey.

[SCENE: characters, action, facial expressions and gestures]
[THREAD: pick one of the three thread lines below]
The feeling is [emotion].

Grayscale everything except the red thread. Not photorealistic, not 3D, no pencil sketch texture, no other colors, no text.
```

---

## Thread Lines (pick one per shot)

### A. Parent + child both visible
```
A clearly visible thin bright red thread is tied in a small bow around the parent's wrist and tied around the child's wrist, one continuous thread connecting both wrists, looping loosely around them, with a short end trailing gently onto the floor.
```

### B. Only the parent visible
```
A clearly visible thin bright red thread is tied in a small bow around the parent's wrist, with the other end stretching away across the floor and leading out of the frame, as if connected to someone not in the picture.
```

### C. Only the child visible
```
A clearly visible thin bright red thread is tied in a small bow around the child's wrist, with the other end stretching away across the floor and leading out of the frame, as if connected to someone not in the picture.
```

Replace "parent" with "mother", "father", "grandmother", etc. to match the scene.

---

## Brand Rules

- **Always present**: every image has the red thread, no exceptions.
- **Always on the wrist**: tied in a small bow. Never on fingers, neck, or body (the model handles the wrist most reliably).
- **Only color**: no red hair, red clothes, or other colored objects. Everything else stays grayscale.
- **Connects when together**: if parent and child are both visible, the thread links both wrists.
- **Trails out of frame when apart**: implies the missing person.
- **Match direction across cuts**: if the mother's thread trails out to the right, the child's thread in the next clip enters from the left.
- **Thread tells the story**:
  - Tight, short loop: closeness, hugs
  - Long and stretched: distance, OFW parent, child leaving home
  - Tangled: conflict, misunderstanding
  - Loose but still tied: hard times, the bond still holds

---

## Scene Examples

### 1. Hug (A: both visible)
```
A mother kneels and hugs her young son tightly, both with eyes closed and soft peaceful smiles. A small table with a potted plant beside them.
A clearly visible thin bright red thread is tied in a small bow around the mother's wrist and tied around the boy's wrist, one continuous thread connecting both wrists, looping loosely around them, with a short end trailing gently onto the floor.
The feeling is an unbreakable bond.
```

### 2. Newborn (A: both visible)
```
A young mother sits on a bed holding her newborn baby in her arms, looking down with a soft loving smile and closed curved eyes. The baby sleeps peacefully with a tiny smile.
A clearly visible thin bright red thread is tied in a small bow around the mother's wrist and tied around the baby's tiny wrist, one continuous thread connecting both wrists, with a short end trailing onto the blanket.
The feeling is a love that just began.
```

### 3. Waiting mother (B: parent only)
```
A mother sits alone by a window at night, holding a phone against her chest, looking outside with a gentle sad smile and tired eyes. A cup of tea on the table beside her.
A clearly visible thin bright red thread is tied in a small bow around the mother's wrist, with the other end stretching away across the floor and leading out of the frame, as if connected to someone not in the picture.
The feeling is missing someone you love.
```

### 4. OFW father (B: parent only)
```
A father sits on a narrow bed in a small plain room, looking at a small photo in his hands with teary eyes and a soft smile. A suitcase on the floor beside the bed.
A clearly visible thin bright red thread is tied in a small bow around the father's wrist, with the other end stretching away across the floor and leading out of the frame, as if connected to someone not in the picture.
The feeling is love across distance.
```

### 5. Child waiting (C: child only)
```
A little girl sits on the front step of a house hugging her knees, looking down the road with hopeful wide eyes. A small backpack beside her.
A clearly visible thin bright red thread is tied in a small bow around the girl's wrist, with the other end stretching away down the road and leading out of the frame, as if connected to someone not in the picture.
The feeling is waiting for a parent to come home.
```

### 6. Teenager leaving (A: both visible, stretched)
```
A teenage son with a backpack walks away toward a gate, glancing back over his shoulder with a small smile. His mother stands in the doorway, waving softly with proud teary eyes.
A clearly visible thin bright red thread is tied in a small bow around the mother's wrist and tied around the son's wrist, one long continuous thread stretching across the yard between them, still connected.
The feeling is letting go while still holding on.
```

### 7. Conflict (A: both visible, tangled)
```
A mother and her young daughter sit on opposite ends of a sofa, arms crossed, looking away from each other with small pouting frowns.
A clearly visible thin bright red thread is tied in a small bow around the mother's wrist and tied around the girl's wrist, the thread loosely tangled in a messy knot between them on the sofa, but still connected.
The feeling is a small fight that cannot break the bond.
```

### 8. Reunion (A: both visible)
```
A father kneels at an airport arrival area with arms wide open as his little son runs into his hug, both crying happy tears with big smiles. A suitcase in the foreground.
A clearly visible thin bright red thread is tied in a small bow around the father's wrist and tied around the boy's wrist, the thread pulled short and tight between them as they embrace.
The feeling is finally home.
```

---

## Settings

| Setting | Value |
|---|---|
| Steps | 8 to 9 |
| CFG | 1 |
| Sampler / Scheduler | res_multistep / simple |
| Negative prompt | Leave empty (ignored at CFG 1) |
| Reels size (9:16) | 1088 x 1920 |

---

## Quick Fixes

| Problem | Fix |
|---|---|
| Thread only on one wrist (in A) | Put the thread line first in the scene, before describing the action. |
| Thread too small / hard to see | Add "thick enough to be clearly visible on a phone screen" and keep the trailing end. |
| Thread floating randomly | Add "the thread rests on the floor" or "drapes over their arms". |
| Other red objects appear | Repeat "the red thread is the only color in the image" at the start and end. |
| Lines too sketchy | Add "vector-like clean ink lines" at the start. |
| Background too busy | Add "background very faint, almost blank". |
| Text appears | Keep "no text". Add captions in your video editor. |

---

## Off-Image Branding Ideas

- Profile picture / logo: a simple red thread forming a small bow or a heart loop.
- Thumbnails: a thin red line under the title text.
- Page name ideas: "Red Thread Stories", "Hiblang Pula", "Tali ng Puso".
- Caption sign-off: a short recurring line, e.g. "The thread never breaks."
