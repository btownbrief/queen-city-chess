# QUEEN CITY CHESS ♛

Full chess, Burlington style. Pass one phone across the table, play a
deliberately beatable Tourist, or face the deeper-searching Queen City Club.
Queen City Chess is part of [Btown Games](https://play.btownbrief.com/), the
browser arcade from the [BTown Brief](https://www.btownbrief.com).

**Play it live:** https://play.btownbrief.com/queen-city-chess/

## Modes

- **Pass & Play** — two players on one phone; the board flips after every move.
- **The Tourist** — likes captures and otherwise wanders into a random move.
- **Queen City Club** — depth 2–3 minimax with alpha–beta pruning, material
  values, and piece-square tables under a phone-friendly time budget.
- **Online Table** — White opens a table, shares a four-character code, and
  Black joins from a second phone.

## How it works

Plain static site: no build step, frameworks, npm, accounts, or repo-specific
backend. Online tables use Btown Games' shared rooms service.

| file | responsibility |
| --- | --- |
| `js/engine.js` | all chess rules behind pure functions over JSON state |
| `js/bot.js` | Tourist and Queen City Club strategy using only the engine API |
| `js/main.js` | board rendering, taps, promotion UI, move list, and game screens |
| `js/rooms.js` | shared, game-agnostic two-phone room client |
| `vendor/chess.js` | chess.js v1.4.0 ESM build, vendored locally |
| `scripts/test-engine.mjs` | Node checks for special moves, draws, sync state, and the Club |
| `scripts/test-rooms.mjs` | two simulated phones playing through the room client |

The engine state is the online-sync contract:

```js
{
  initialFen,
  fen,
  history,
  result
}
```

It carries the current FEN plus the full move history, so castling rights,
en passant, the fifty-move counter, and threefold repetition all resume after
`JSON.stringify` → `JSON.parse`. `applyMove` always returns a new state.

chess.js v1.4.0 is used under its
[MIT license](https://github.com/jhlywa/chess.js/blob/v1.4.0/LICENSE).
It owns move legality and chess result detection.

## Testing

```bash
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
```

The script covers legal and illegal castling, en passant, promotion,
stalemate, insufficient material, fifty-move and threefold draws, JSON resume,
and a mate-in-one the Queen City Club must find in under one second.

## App icon

`icon-180.png` is rendered from `icon.svg`. Every push to `main` deploys the
static files to GitHub Pages through `.github/workflows/deploy.yml`.
