// Online-rooms wiring test: drives the real vendored client (js/rooms.js)
// against the local shim (scripts/rooms-shim.mjs) as two simulated phones,
// then plays chess through the real engine. No network or Supabase required.
//
//   node scripts/test-rooms.mjs

import { createRooms } from './rooms-shim.mjs';
import {
  WHITE, BLACK,
  createInitialState, legalMoves, applyMove, resignGame, getStatus,
} from '../js/engine.js';

const GAME = 'queen-city-chess';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (key) => (stores.get(current).has(key) ? stores.get(current).get(key) : null),
  setItem: (key, value) => stores.get(current).set(key, String(value)),
  removeItem: (key) => stores.get(current).delete(key),
};
function device(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  current = name;
}
device('A');
device('B');

let passed = 0;
function t(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (err) {
    t(err && err.code === code, `${label} (got ${err && err.code})`);
  }
}

// Route the real client's fetch calls directly into the vendored shim's RPC
// table. This is the same referee used by startShim(), without requiring a
// loopback port (some CI and agent sandboxes forbid local listeners).
const shim = createRooms();
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('http://not-ready.test/')) {
    return new Response('{}', { status: 404 });
  }
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if (!match || options.method !== 'POST' || !shim.rpcs[match[1]]) {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const result = shim.rpcs[match[1]](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), {
      status: err.rpc ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
const { OnlineMatch, savedSession, clearSession } = await import('../js/rooms.js');

/* ------------------------------------------------------------ the tests */

device('A');
const host = await OnlineMatch.create({
  game: GAME,
  name: 'White Phone',
  state: createInitialState(),
  seats: 2,
});
t(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting', 'host creates room as seat 0 (White)');
t(savedSession(GAME)?.roomId === host.roomId, 'host session saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }), 'not_found', 'bad code rejected');
await expectCode(OnlineMatch.join({ game: 'four-in-a-rowboat', code: host.code, name: 'X' }), 'wrong_game', 'wrong game rejected');
await expectCode(OnlineMatch.join({ game: null, code: host.code, name: 'X' }), 'bad_game', 'null game rejected (SQL parity)');
const guest = await OnlineMatch.join({
  game: GAME,
  code: ` ${host.code.toLowerCase()} `,
  name: 'Black Phone',
});
t(guest.seat === 1 && guest.status === 'playing', 'guest joins as seat 1 (Black), game starts');
t(guest.opponents().length === 1 && guest.opponents()[0].name === 'White Phone', 'guest sees host name');

device('A');
await host._fetch();
t(host.status === 'playing' && host.opponents()[0].name === 'Black Phone', 'host poll sees game start');

// Referee: push, sync, and reject a stale version.
const afterE4 = applyMove(host.state, { from: 'e2', to: 'e4' });
await host.push(afterE4);
t(host.version === 1, 'host pushes White move, version 1');

device('B');
await guest._fetch();
t(guest.state.fen === afterE4.fen && getStatus(guest.state).turn === BLACK, 'guest poll receives White move');
await guest.push(applyMove(guest.state, { from: 'e7', to: 'e5' }));
t(guest.version === 2, 'guest pushes Black reply, version 2');

device('A');
const staleState = applyMove(afterE4, { from: 'c7', to: 'c5' });
await expectCode(host.push(staleState), 'version_conflict', 'stale push rejected');
t(host.version === 2 && host.state.history.at(-1).san === 'e5', 'conflict refetches the true position');

// Full engine exercise: two simulated phones choose deterministic random
// legal chess moves until chess.js reports a result, or stop cleanly at the
// 400-ply cap after proving both phones are synchronized.
device('A');
await host._fetch();
device('B');
await guest._fetch();
const phones = {
  [WHITE]: { match: host, device: 'A' },
  [BLACK]: { match: guest, device: 'B' },
};
let seed = 0x51c0ffee;
function randomIndex(length) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % length;
}

let plies = 0;
while (!getStatus(host.state).over && plies < 400) {
  const turn = getStatus(host.state).turn;
  const mover = phones[turn];
  device(mover.device);
  await mover.match._fetch();
  const moves = legalMoves(mover.match.state);
  if (!moves.length) throw new Error(`Engine returned no legal move before game over at ply ${plies + 1}.`);
  const next = applyMove(mover.match.state, moves[randomIndex(moves.length)]);
  await mover.match.push(next, { over: getStatus(next).over });

  device('A');
  await host._fetch();
  device('B');
  await guest._fetch();
  plies++;
}

const randomStatus = getStatus(host.state);
const randomOutcome = randomStatus.over ? randomStatus.reason : 'cap';
t(randomStatus.over || plies === 400, `random game reaches an engine result or the 400-ply cap (${plies} plies, ${randomOutcome})`);
t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'both phones have JSON-identical chess state');
t(host.status === (randomStatus.over ? 'over' : 'playing'), 'room status matches engine result');

// If the legal random sequence reaches the cap, use chess's serialized
// resignation result to close this room before exercising rematch behavior.
if (!randomStatus.over) {
  const resigningColor = randomStatus.turn;
  const resigningPhone = phones[resigningColor];
  device(resigningPhone.device);
  await resigningPhone.match._fetch();
  const resigned = resignGame(resigningPhone.match.state, resigningColor);
  await resigningPhone.match.push(resigned, { over: true });
  device('A');
  await host._fetch();
  device('B');
  await guest._fetch();
  t(getStatus(host.state).reason === 'resignation', 'online resignation is serialized and synced');
  t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'resignation end states are identical');
}

device('B');
await guest.push(createInitialState(), {});
t(guest.status === 'playing' && guest.version === host.version + 1, 'either phone can start a rematch');

// Chess resignation is a finished engine state, not the room-abandon action.
device('A');
await host._fetch();
const whiteResigns = resignGame(host.state, WHITE);
await host.push(whiteResigns, { over: true });
device('B');
await guest._fetch();
t(getStatus(guest.state).reason === 'resignation', 'resignation marker reaches the other phone');
t(getStatus(guest.state).winner === BLACK && guest.status === 'over', 'remote resignation awards the correct seat');
t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'resignation states are JSON-identical');

await guest.push(createInitialState(), {});
t(guest.status === 'playing', 'a fresh board restarts the finished room');

device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(resumed.roomId === host.roomId && resumed.seat === 0 && resumed.status === 'playing', 'resume reattaches to the room');

// An out-of-order poll response must never roll state backwards.
device('B');
{
  const before = { state: guest.state, version: guest.version };
  await guest._fetch();
  guest.state = before.state;
  guest.version = before.version + 1000;
  const response = await guest._fetch();
  t(guest.version === before.version + 1000, 'stale poll response is ignored');
  guest.version = response.version;
  guest.state = response.state;
  guest.status = response.status;
}

device('A');
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest._fetch();
t(guest.status === 'over' && guest.opponents()[0].left === true, 'guest sees host abandon the table');
await expectCode(guest.push(createInitialState(), {}), 'opponent_left', 'push into an abandoned room barred');

device('A');
const secondHost = await OnlineMatch.create({
  game: GAME,
  name: 'A',
  state: createInitialState(),
});
device('B');
await OnlineMatch.join({ game: GAME, code: secondHost.code, name: 'B' });
device('C');
await expectCode(OnlineMatch.join({ game: GAME, code: secondHost.code, name: 'C' }), 'room_started', 'third phone turned away');

// A backend without the shared SQL installed returns the friendly not_ready.
globalThis.BTOWN_ROOMS_URL = 'http://not-ready.test';
const freshClient = await import('../js/rooms.js?not-ready');
await expectCode(
  freshClient.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
  'not_ready',
  'missing backend reads as not_ready',
);

clearSession(GAME);
console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);
