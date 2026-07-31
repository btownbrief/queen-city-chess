# Queen City Chess — agent instructions

Shared brain for any AI agent working in this repo. Read `README.md` first for
the architecture. Stephen is non-technical — explain consequential changes in
plain language.

## What this is

Burlington's phone-first chess game for Btown Games. Plain static site, **no
build step**: `index.html` + `style.css` + ES modules in `js/`. No repo-owned
backend, accounts, analytics, npm, or frameworks. `vendor/chess.js` is the
only game dependency; online play uses the fleet's shared rooms service.

## The one non-negotiable

Every chess rule lives in `js/engine.js`, which wraps chess.js behind pure
functions over a plain JSON-serializable state carrying FEN plus move history.
It never touches the DOM, timers, `Date`, or `Math.random`; `applyMove` returns
a new state. `js/bot.js` may only use the engine's public API, and `js/main.js`
is UI only. Online play syncs this exact state object.

## Online play (the rooms layer)

`js/rooms.js` is the fleet's vendored online-multiplayer client; the canonical
copy lives in `four-in-a-rowboat`. It talks to the shared Supabase rooms
backend (`btownbrief.github.io/supabase/rooms-2026-07-30.sql`): a room is a
4-letter code plus the entire engine state as opaque JSON and a version
number. After a move, the active phone pushes the new state with the version
it last saw; the other phone polls. All rules stay in `engine.js` —
`rooms.js` knows nothing about chess. Host sits in seat 0 (White); the joiner
is seat 1 (Black). If the backend SQL is not installed yet, clients get a
clean `not_ready` error and the UI says online play is not switched on.

`scripts/rooms-shim.mjs` is the vendored local stand-in for the backend, also
canonical in `four-in-a-rowboat`. `scripts/test-rooms.mjs` drives the real
client and chess engine as two simulated phones against that shim.

## Before you finish

Run `node scripts/test-engine.mjs` and `node scripts/test-rooms.mjs`, and
report their output. If UI changed, playtest at a phone-sized viewport or
clearly say why that was not possible.
