# Story shots: photographer-style card photos (2026-10-18)

## Why
The card photos look real, but a post is one layout repeated: every prompt lists every prop, so every frame is "the
baby in the middle, all the props around". Facebook reach drops on repetitive albums. The owner's earlier manual posts
(red Chinese New Year set, Riley Jade, Neriah Belle) show the target: most frames zoomed in, one hero per frame (the
child or ONE prop), strong depth of field, varied angles, a story told through the props as much as the child.

Measured on the 6 latest posts (75 cards): 0 of 6 "macro hands/feet" shots came out as a macro (the model drew a big
face, because the prompt leads with the child's full look); props-only frames showed a two-tone wall/floor instead of
the seamless set; props-only frames always sat at cards 4, 6, 9, 11.

## Scope
Photos only. The workflow, database, worker, text stamping (name in the top band), captions and closing-card flow do
not change. The new prompts keep the top third of every frame clean, out-of-focus backdrop so the stamped name never
lands on the subject.

## Design
1. **One set, the camera moves in.** New shot lists per session (newborn, ~1 year, toddler 2-3, child 4-7), written as
   a photographer's session: a cover portrait, face close-ups from varied angles, detail macros (hands, feet, lashes,
   outfit texture), prop stories (the child with ONE prop, focus pulled to the prop or to the face), small hands with
   the prop, over-the-shoulder onto the prop, and prop still lifes (one prop, macro or floor-level perspective). No
   wide establishing shots: about 80% of frames are close-up or detail. Newborns stay asleep (a hand resting on the
   prop, the prop soft in the foreground of the sleeping face).
2. **Prompt shape** (Z-Image weighs the start most; positive-only, cfg 1): the frame and its hero first; the focus
   plane and depth ("sharp focus on ..., ... dissolved into creamy bokeh"); the child's look only when the face is in
   frame (hands-only frames name only skin tone and sleeve; still lifes name no child); the set with the hero prop in
   focus and the other props as soft blurred shapes; light and palette; "the top third of the frame is clean, softly
   blurred backdrop"; NO_TEXT. Still lifes use the same seamless backdrop as the baby frames.
3. **Planner.** The theme's props string is split into single props (commas, "and"); frames that feature a prop get
   one, rotated so every prop gets frames and neighbours differ. Frame categories follow a fixed mix pattern (no
   repeats of the same category back to back); neighbours never share an angle; the 1-2 still lifes sit at seeded
   positions (never first, never adjacent), so the rhythm changes post to post. Random age keeps one child per card.
   The stored shot text is the spec text (a "{prop}" placeholder stays in it), so shotSpec() lookups keep working.
4. **Theme guidelines.** AI theme suggestions ask for 3-5 props that can each carry a frame alone, at least one small
   enough for a baby's hands; still small and low (no tall props). Existing themes work unchanged.
5. **Packs.** Name Nest reuses the Unique Names shot lists today, so it gets the same photography with its own looks.

## What the spikes showed (Z-Image Turbo, 8 steps)
- Hands/feet macros work once the prompt leaves out the child's face, eyes and hats (outfit reduced to the garment).
- The head stays below the stamped name only when the placement is in the FIRST sentence ("…, in the bottom half of
  the frame. The upper half of the frame is empty, softly blurred <color> backdrop."); "top of the head below the
  middle", "wide headroom" or a high angle did not.
- A real focus pull needs "taken with a macro lens right next to <prop>: <prop> is tack sharp in the foreground, and
  the child … from behind is completely out of focus"; "far behind it, a soft shape" kept the child sharp.
- A big blurred object in the near foreground at the top made the stamp's calm-band picker move the name onto the
  face: no frame uses foreground blur above the subject.
- "Over the shoulder" with "his shoulder in the foreground" drew a second person; "the child's own head and own
  hand" keeps one child.

## Name weight (owner request, same day)
The name is stamped extra-bold: layout.json titleWeight 600 -> 800; Poppins ExtraBold added to the catalog; variable
fonts whose axis ends at 700 carry `wmax: 700` so the Settings preview's Google Fonts request stays valid (the worker
clamps to the axis itself).

## Proof before wiring
Sample posts rendered on the owner's ComfyUI straight to a local folder (never into posts), stamped with the current
text settings, shown as contact sheets next to the current output for the same themes. Tests: every frame names at
most one hero prop, close/detail share >= 70%, no neighbour shares an angle or hero, every prompt carries the top-clean
line and NO_TEXT, older stored shot texts still resolve or fall back safely.
