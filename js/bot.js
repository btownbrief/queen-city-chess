// QUEEN CITY CHESS — Burlington's two computer opponents.
//
// This module knows strategy, not rules. Every position, move, and result
// comes through engine.js's public API.

import {
  WHITE, BLACK, legalMoves, applyMove, getStatus, getBoard,
} from './engine.js';

const MATE_SCORE = 1_000_000;
const CLUB_BUDGET_MS = 650;

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20_000 };

// White's view, a8 → h1. Black uses the vertically mirrored square.
const PST = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
      0,   0,   0,   5,   5,   0,   0,   0,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      5,  10,  10,  10,  10,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -10,   5,   5,   5,   5,   5,   0, -10,
      0,   0,   5,   5,   5,   5,   0,  -5,
     -5,   0,   5,   5,   5,   5,   0,  -5,
    -10,   0,   5,   5,   5,   5,   0, -10,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

/** Pick a legal move for "tourist" or "club". */
export function chooseMove(state, level = 'tourist') {
  const moves = legalMoves(state);
  if (!moves.length) throw new Error('No legal move — the game is over.');
  if (level === 'tourist') return touristMove(moves);
  if (level === 'club') return clubMove(state, moves);
  throw new Error(`Unknown Queen City Chess bot level: ${level}`);
}

function touristMove(moves) {
  const captures = moves.filter((move) => move.captured || move.flags.includes('e'));
  const pool = captures.length ? captures : moves;
  return pool[Math.floor(Math.random() * pool.length)];
}

let deadline = 0;
let timedOut = false;
let nodes = 0;

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now();
}

function clubMove(state, moves) {
  // Never spend a search budget overlooking mate in one.
  for (const move of orderedMoves(moves)) {
    if (getStatus(applyMove(state, move)).checkmate) return move;
  }

  const rootColor = moves[0].color;
  deadline = now() + CLUB_BUDGET_MS;
  let best = orderedMoves(moves)[0];

  // Depth two is the guaranteed answer. Depth three replaces it only when
  // the complete pass fits under the phone-friendly time budget.
  for (const depth of [2, 3]) {
    timedOut = false;
    nodes = 0;
    const candidate = rootSearch(state, depth, rootColor);
    if (timedOut) break;
    best = candidate;
  }
  return best;
}

function rootSearch(state, depth, rootColor) {
  let bestMove = orderedMoves(legalMoves(state))[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const move of orderedMoves(legalMoves(state))) {
    const score = minimax(applyMove(state, move), depth - 1, alpha, Infinity, rootColor, 1);
    if (timedOut) break;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return bestMove;
}

function minimax(state, depth, alpha, beta, rootColor, ply) {
  if ((++nodes & 127) === 0 && now() >= deadline) timedOut = true;
  if (timedOut) return 0;

  const status = getStatus(state);
  if (status.over) {
    if (status.winner === rootColor) return MATE_SCORE - ply;
    if (status.winner) return -MATE_SCORE + ply;
    return 0;
  }
  if (depth === 0) return evaluate(state, rootColor);

  const maximizing = status.turn === rootColor;
  if (maximizing) {
    let score = -Infinity;
    for (const move of orderedMoves(legalMoves(state))) {
      score = Math.max(score, minimax(applyMove(state, move), depth - 1, alpha, beta, rootColor, ply + 1));
      if (timedOut) return 0;
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return score;
  }

  let score = Infinity;
  for (const move of orderedMoves(legalMoves(state))) {
    score = Math.min(score, minimax(applyMove(state, move), depth - 1, alpha, beta, rootColor, ply + 1));
    if (timedOut) return 0;
    beta = Math.min(beta, score);
    if (alpha >= beta) break;
  }
  return score;
}

function evaluate(state, rootColor) {
  let score = 0;
  const board = getBoard(state);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const index = row * 8 + col;
      const tableIndex = piece.color === WHITE ? index : (7 - row) * 8 + col;
      const worth = VALUE[piece.type] + PST[piece.type][tableIndex];
      score += piece.color === rootColor ? worth : -worth;
    }
  }
  return score;
}

function orderedMoves(moves) {
  return [...moves].sort((a, b) => movePriority(b) - movePriority(a));
}

function movePriority(move) {
  let score = 0;
  if (move.san.endsWith('#')) score += 100_000;
  else if (move.san.endsWith('+')) score += 2_000;
  if (move.promotion) score += VALUE[move.promotion] + 1_000;
  if (move.captured) score += 10 * VALUE[move.captured] - VALUE[move.piece];
  // Quiet center moves get a small ordering nudge.
  const file = move.to.charCodeAt(0) - 97;
  score += 4 - Math.abs(3.5 - file);
  return score;
}
