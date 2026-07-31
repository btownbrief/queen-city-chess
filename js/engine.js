// QUEEN CITY CHESS — pure chess rules over a plain JSON state object.
//
// This module is the game's multiplayer contract. State always carries the
// starting FEN, current FEN, and every move needed to reconstruct the game:
//   { initialFen, fen, history, result }
// It survives JSON.stringify → JSON.parse → resume, including repetition
// history. No DOM, timers, Date, or Math.random belong here.

import { Chess, DEFAULT_POSITION } from '../vendor/chess.js';

export const WHITE = 'w';
export const BLACK = 'b';
export const START_FEN = DEFAULT_POSITION;

/** Start the normal game, or a legal position supplied as FEN. */
export function createInitialState(fen = START_FEN) {
  const game = new Chess(fen);
  return {
    initialFen: game.fen(),
    fen: game.fen(),
    history: [],
    result: null,
  };
}

/**
 * Every legal move for the side to move. Pass a square such as "e2" to
 * narrow the list to one piece. Returned moves are plain JSON objects.
 */
export function legalMoves(state, square) {
  if (state.result) return [];
  const game = gameFromState(state);
  if (game.isGameOver()) return [];
  return game.moves({ verbose: true, ...(square ? { square } : {}) }).map(normalizeMove);
}

/**
 * Play { from, to, promotion? } (or SAN) and return a NEW state.
 * The input state and its history array are never mutated.
 */
export function applyMove(state, move) {
  if (state.result) throw new Error('The game is already over.');
  const game = gameFromState(state);
  if (game.isGameOver()) throw new Error('The game is already over.');

  let played;
  try {
    played = game.move(move);
  } catch {
    throw new Error('That move is not legal in this position.');
  }
  if (!played) throw new Error('That move is not legal in this position.');

  return {
    initialFen: state.initialFen,
    fen: game.fen(),
    history: [...state.history, normalizeMove(played)],
    result: null,
  };
}

/** Resignation is stored in the same serializable state used by online play. */
export function resignGame(state, color) {
  if (getStatus(state).over) throw new Error('The game is already over.');
  const game = gameFromState(state);
  const resigning = color || game.turn();
  if (resigning !== WHITE && resigning !== BLACK) {
    throw new Error('The resigning color must be "w" or "b".');
  }
  return {
    ...state,
    history: state.history.map((move) => ({ ...move })),
    result: { type: 'resignation', winner: opposite(resigning) },
  };
}

/**
 * A complete, UI-friendly status. Draw reasons are kept separate so the
 * result copy can say stalemate, repetition, fifty moves, or material.
 */
export function getStatus(state) {
  const game = gameFromState(state);
  const resigned = state.result && state.result.type === 'resignation';
  const checkmate = !resigned && game.isCheckmate();
  const stalemate = !resigned && !checkmate && game.isStalemate();
  const insufficientMaterial = !resigned && !checkmate && game.isInsufficientMaterial();
  const threefoldRepetition = !resigned && !checkmate && game.isThreefoldRepetition();
  const fiftyMove = !resigned && !checkmate && game.isDrawByFiftyMoves();
  const draw = stalemate || insufficientMaterial || threefoldRepetition || fiftyMove;
  const over = Boolean(resigned || checkmate || draw);
  let winner = null;
  let reason = null;

  if (resigned) {
    winner = state.result.winner;
    reason = 'resignation';
  } else if (checkmate) {
    winner = opposite(game.turn());
    reason = 'checkmate';
  } else if (stalemate) {
    reason = 'stalemate';
  } else if (insufficientMaterial) {
    reason = 'insufficient-material';
  } else if (threefoldRepetition) {
    reason = 'threefold-repetition';
  } else if (fiftyMove) {
    reason = 'fifty-move';
  }

  return {
    over,
    turn: over ? null : game.turn(),
    winner,
    draw,
    reason,
    check: !resigned && game.isCheck(),
    checkedColor: !resigned && game.isCheck() ? game.turn() : null,
    checkmate,
    stalemate,
    insufficientMaterial,
    threefoldRepetition,
    fiftyMove,
    lastMove: state.history.length ? { ...state.history[state.history.length - 1] } : null,
  };
}

/** Board rows run from rank 8 to rank 1, matching chess.js and the screen. */
export function getBoard(state) {
  return gameFromState(state).board().map((row) =>
    row.map((piece) => (piece ? {
      square: piece.square,
      type: piece.type,
      color: piece.color,
    } : null))
  );
}

/** A defensive copy keeps callers from mutating the synced state by accident. */
export function getMoveHistory(state) {
  gameFromState(state); // validate the full history and current FEN first
  return state.history.map((move) => ({ ...move }));
}

function gameFromState(state) {
  assertState(state);
  let game;
  try {
    game = new Chess(state.initialFen);
    for (const recorded of state.history) {
      const replayed = game.move({
        from: recorded.from,
        to: recorded.to,
        ...(recorded.promotion ? { promotion: recorded.promotion } : {}),
      });
      if (!replayed) throw new Error('illegal history');
    }
  } catch {
    throw new Error('Invalid Queen City Chess state.');
  }
  if (game.fen() !== state.fen) {
    throw new Error('Invalid Queen City Chess state: FEN does not match its move history.');
  }
  return game;
}

function assertState(state) {
  if (!state || typeof state !== 'object' ||
      typeof state.initialFen !== 'string' ||
      typeof state.fen !== 'string' ||
      !Array.isArray(state.history)) {
    throw new Error('Invalid Queen City Chess state.');
  }
  if (state.result !== null && state.result !== undefined) {
    if (state.result.type !== 'resignation' ||
        (state.result.winner !== WHITE && state.result.winner !== BLACK)) {
      throw new Error('Invalid Queen City Chess result.');
    }
  }
}

function normalizeMove(move) {
  return {
    from: move.from,
    to: move.to,
    color: move.color,
    piece: move.piece,
    ...(move.captured ? { captured: move.captured } : {}),
    ...(move.promotion ? { promotion: move.promotion } : {}),
    san: move.san,
    lan: move.lan,
    flags: move.flags,
  };
}

function opposite(color) {
  return color === WHITE ? BLACK : WHITE;
}
