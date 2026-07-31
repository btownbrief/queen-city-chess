import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  WHITE,
  createInitialState,
  legalMoves,
  applyMove,
  getStatus,
  getBoard,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

function pieceAt(state, square) {
  return getBoard(state).flat().find((piece) => piece && piece.square === square) || null;
}

console.log('Queen City Chess engine tests');

test('initial state survives JSON round-trip and resumes', () => {
  let state = createInitialState();
  const original = state;
  const untouched = JSON.parse(JSON.stringify(state));
  state = applyMove(state, { from: 'e2', to: 'e4' });
  assert.deepEqual(original, untouched);
  assert.notEqual(state, original);
  state = applyMove(state, { from: 'e7', to: 'e5' });
  const resumed = JSON.parse(JSON.stringify(state));
  const next = applyMove(resumed, { from: 'g1', to: 'f3' });
  assert.equal(next.history.length, 3);
  assert.equal(pieceAt(next, 'f3').type, 'n');
  assert.equal(next.initialFen, state.initialFen);
});

test('castling is legal when the path and king are safe', () => {
  const state = createInitialState('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const kingMoves = legalMoves(state, 'e1');
  assert(kingMoves.some((move) => move.to === 'g1' && move.san === 'O-O'));
  assert(kingMoves.some((move) => move.to === 'c1' && move.san === 'O-O-O'));
  const castled = applyMove(state, { from: 'e1', to: 'g1' });
  assert.equal(pieceAt(castled, 'g1').type, 'k');
  assert.equal(pieceAt(castled, 'f1').type, 'r');
});

test('castling through an attacked square is illegal', () => {
  const state = createInitialState('r3kr1r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const kingMoves = legalMoves(state, 'e1');
  assert(!kingMoves.some((move) => move.to === 'g1'));
  assert(kingMoves.some((move) => move.to === 'c1'));
  assert.throws(
    () => applyMove(state, { from: 'e1', to: 'g1' }),
    /not legal/
  );
});

test('en passant removes the passed pawn', () => {
  const state = createInitialState('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const move = legalMoves(state, 'e5').find((candidate) => candidate.to === 'd6');
  assert(move);
  assert(move.flags.includes('e'));
  const captured = applyMove(state, move);
  assert.equal(pieceAt(captured, 'd6').type, 'p');
  assert.equal(pieceAt(captured, 'd6').color, WHITE);
  assert.equal(pieceAt(captured, 'd5'), null);
});

test('promotion creates the selected piece', () => {
  const state = createInitialState('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promoted = applyMove(state, { from: 'a7', to: 'a8', promotion: 'q' });
  assert.equal(pieceAt(promoted, 'a8').type, 'q');
  assert.equal(promoted.history.at(-1).promotion, 'q');
});

test('stalemate is detected and named as the draw reason', () => {
  const state = createInitialState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const status = getStatus(state);
  assert.equal(status.over, true);
  assert.equal(status.draw, true);
  assert.equal(status.stalemate, true);
  assert.equal(status.reason, 'stalemate');
  assert.deepEqual(legalMoves(state), []);
});

test('insufficient material and fifty-move draws are detected', () => {
  const material = getStatus(createInitialState('7k/8/8/8/8/8/8/K7 w - - 0 1'));
  assert.equal(material.insufficientMaterial, true);
  assert.equal(material.reason, 'insufficient-material');

  const fifty = getStatus(createInitialState('7k/8/8/8/8/8/6R1/K7 w - - 100 51'));
  assert.equal(fifty.fiftyMove, true);
  assert.equal(fifty.reason, 'fifty-move');
});

test('threefold repetition survives serialization', () => {
  let state = createInitialState();
  for (let cycle = 0; cycle < 2; cycle++) {
    state = applyMove(state, { from: 'g1', to: 'f3' });
    state = applyMove(state, { from: 'g8', to: 'f6' });
    state = applyMove(state, { from: 'f3', to: 'g1' });
    state = applyMove(state, { from: 'f6', to: 'g8' });
    state = JSON.parse(JSON.stringify(state));
  }
  const status = getStatus(state);
  assert.equal(status.threefoldRepetition, true);
  assert.equal(status.reason, 'threefold-repetition');
});

let clubLine = '';
let clubElapsed = 0;
test('Queen City Club finds mate in one under one second', () => {
  const state = createInitialState('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  const started = performance.now();
  const move = chooseMove(state, 'club');
  clubElapsed = performance.now() - started;
  const result = getStatus(applyMove(state, move));
  assert.equal(result.checkmate, true);
  assert.equal(result.winner, WHITE);
  assert(clubElapsed < 1000, `Club took ${clubElapsed.toFixed(1)}ms`);
  clubLine = move.san;
});

console.log(`Club move: ${clubLine} (${clubElapsed.toFixed(1)}ms)`);
console.log(`${passed}/9 tests passed`);
