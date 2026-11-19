# Learning Studio

A page for teaching the system new artwork without pushing to GitHub each time.

    cd ~/novaforge-studio/studio && npm run learn      # then open http://localhost:8787 in the phone browser

(Opening `learn/index.html` directly also works; it then saves only inside the browser, and the Library tab
downloads zips.)

Flow: pick a category (Character 360, Emotions, Poses, Props, Landscapes) and a style (Ghibli, Webtoon),
give a name and the pictures, list the names of the views in picture order, press Find items, then Start learning.
Every item shows: what you gave | the vector | where they differ, plus every round it has been through.

- **Accurate** saves the vector, its colours and settings. With the save server running it is written to
  `characters/<id>/learned/<style>/<name>.svg` (characters) or `library/<category>/<style>/<group>/<name>.svg`.
- **Needs refinement** tries up to 7 more detailed settings and keeps the closest one.
- **Different** marks the current settings as rejected and tries up to 5 other approaches.

Approved vectors are used in videos: `npm run characters` (the render workflow runs it) bakes them into the studio.
What goes where, and the rules, are in `characters/README.md` ("Learned artwork").

What "learning" means here: the tracer's settings, per category and style. Approved settings become the starting
point next time, rejected ones are not tried again. There is no neural network, nothing leaves the browser, and the
the page only learns the tracer's settings from your verdicts.

## Reopening saved items (v26)
Everything you press **Accurate** on is kept in the repo folders (when `npm run learn` is running) and in the browser.
Open the **Library** tab and press **Reopen** on one item, or **Reopen all of this group**: the cards come back with the
saved vector, score and settings, and **Needs refinement / Different / Accurate** work again. Accurate overwrites the
same item. A different browser or phone sees the same library because it is read from the server's folders.
The saved original is now up to 900 px (was 360) so refining after a reopen has real detail to work with.

## Auto focus on the figure (v26)
Option **Focus on the figure** (default: Full) cuts neighbouring figures that overlap or touch the one being learned,
removes banner strips, slivers cut off at the sheet edge and caption bits, and keeps what belongs to the figure: pieces
inside its box and, for poses and emotions, effects close to it (hearts, sweat drops, "!"). *Loose bits only* keeps touching
neighbours; *Off* keeps everything. Very thin hair strands can be lost at Full: choose Loose bits only if that happens.
