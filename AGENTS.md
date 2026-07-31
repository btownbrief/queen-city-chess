# Queen City Chess — agent instructions

Shared brain for any AI agent working in this repo. Read `README.md` first for
the architecture. Stephen is non-technical — explain consequential changes in
plain language.

## What this is

Burlington's phone-first chess game for Btown Games. Plain static site, **no
build step**: `index.html` + `style.css` + ES modules in `js/`. No backend,
accounts, analytics, npm, or frameworks. `vendor/chess.js` is the only
dependency.

## The one non-negotiable

Every chess rule lives in `js/engine.js`, which wraps chess.js behind pure
functions over a plain JSON-serializable state carrying FEN plus move history.
It never touches the DOM, timers, `Date`, or `Math.random`; `applyMove` returns
a new state. `js/bot.js` may only use the engine's public API, and `js/main.js`
is UI only. A later online phase will sync this exact state object.

## Before you finish

Run `node scripts/test-engine.mjs` and report its output. If UI changed,
playtest at a phone-sized viewport or clearly say why that was not possible.
