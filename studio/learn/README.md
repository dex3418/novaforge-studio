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

What "learning" means here: the tracer's settings, per category and style. Approved settings become the starting
point next time, rejected ones are not tried again. There is no neural network, nothing leaves the browser, and the
saved vectors are NOT yet read by the renderer (`characters/*/learned/` is separate from `character.json`).
