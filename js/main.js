// QUEEN CITY CHESS — UI only.
//
// Rendering and interaction live here; chess rules live in engine.js and
// strategy lives in bot.js. Online play is intentionally absent in Phase 1,
// but "online" is already a first-class mode kind so the fleet rooms adapter
// can be added without bending local or bot play.

import {
  WHITE, BLACK,
  createInitialState, legalMoves, applyMove, resignGame,
  getStatus, getBoard, getMoveHistory,
} from './engine.js';
import { chooseMove } from './bot.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const boardEl = $('board');
const statusEl = $('status');
const modeLabelEl = $('modeLabel');
const moveListEl = $('moveList');
const moveCountEl = $('moveCount');
const emptyMovesEl = $('emptyMoves');
const resultEl = $('result');
const resultKickerEl = $('resultKicker');
const resultTextEl = $('resultText');
const celebrationEl = $('celebration');
const resignBtn = $('resignBtn');
const promotionEl = $('promotion');
const promotionChoicesEl = $('promotionChoices');

const MODE_DEFS = Object.freeze({
  pass: { kind: 'local', label: 'PASS & PLAY' },
  tourist: { kind: 'bot', label: 'THE TOURIST', bot: 'tourist' },
  club: { kind: 'bot', label: 'QUEEN CITY CLUB', bot: 'club' },
  // Later phase: add the rooms adapter and menu affordances; the turn, move,
  // and rendering paths already recognize this separate mode kind.
  online: { kind: 'online', label: 'ONLINE MATCH' },
});

const PIECES = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const COLOR_NAMES = { w: 'WHITE', b: 'BLACK' };
const DRAW_COPY = {
  stalemate: ['STALEMATE', 'No legal move and no check — honors even on Church Street.'],
  'insufficient-material': ['DRAW', 'Not enough material remains to deliver checkmate.'],
  'threefold-repetition': ['DRAW BY REPETITION', 'The same position appeared three times.'],
  'fifty-move': ['FIFTY-MOVE DRAW', 'Fifty moves each without a pawn move or capture.'],
};

let mode = 'pass';
let state = createInitialState();
let selectedSquare = null;
let selectedMoves = [];
let pendingPromotion = [];
let viewColor = WHITE;
let busy = false;
let botTimer = 0;
let resignTimer = 0;
let resignArmed = false;

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => startMatch(button.dataset.mode));
});
$('menuBtn').addEventListener('click', backToMenu);
$('rematchBtn').addEventListener('click', newGame);
resignBtn.addEventListener('click', onResign);
$('promotionCancel').addEventListener('click', closePromotion);

function startMatch(chosenMode) {
  const definition = MODE_DEFS[chosenMode];
  if (!definition || definition.kind === 'online') return;
  mode = chosenMode;
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  newGame();
}

function newGame() {
  clearTimeout(botTimer);
  disarmResign();
  state = createInitialState();
  selectedSquare = null;
  selectedMoves = [];
  pendingPromotion = [];
  viewColor = WHITE;
  busy = false;
  promotionEl.classList.add('hidden');
  celebrationEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  render();
}

function backToMenu() {
  clearTimeout(botTimer);
  disarmResign();
  busy = false;
  closePromotion();
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

function isBotMode() {
  return MODE_DEFS[mode].kind === 'bot';
}

function isOnlineMode() {
  return MODE_DEFS[mode].kind === 'online';
}

function isBotsTurn() {
  const status = getStatus(state);
  return isBotMode() && !status.over && status.turn === BLACK;
}

function onSquareTap(square) {
  const status = getStatus(state);
  if (busy || status.over || isBotsTurn() || isOnlineMode()) return;

  const destinationMoves = selectedMoves.filter((move) => move.to === square);
  if (selectedSquare && destinationMoves.length) {
    if (destinationMoves.some((move) => move.promotion)) {
      openPromotion(destinationMoves);
    } else {
      commitMove(destinationMoves[0]);
    }
    return;
  }

  const piece = findPiece(square);
  if (piece && piece.color === status.turn) {
    if (selectedSquare === square) {
      selectedSquare = null;
      selectedMoves = [];
    } else {
      selectedSquare = square;
      selectedMoves = legalMoves(state, square);
    }
  } else {
    selectedSquare = null;
    selectedMoves = [];
  }
  renderBoard();
}

function openPromotion(moves) {
  pendingPromotion = moves;
  promotionChoicesEl.innerHTML = '';
  for (const type of ['q', 'r', 'b', 'n']) {
    const move = moves.find((candidate) => candidate.promotion === type);
    if (!move) continue;
    const button = document.createElement('button');
    button.className = 'promotion-choice';
    button.type = 'button';
    button.textContent = PIECES[move.color][type];
    button.setAttribute('aria-label', `Promote to ${PIECE_NAMES[type]}`);
    button.addEventListener('click', () => {
      closePromotion();
      commitMove(move);
    });
    promotionChoicesEl.appendChild(button);
  }
  promotionEl.classList.remove('hidden');
  promotionChoicesEl.querySelector('button')?.focus();
}

function closePromotion() {
  pendingPromotion = [];
  promotionEl.classList.add('hidden');
}

function commitMove(move) {
  const movingColor = move.color;
  state = applyMove(state, move);
  selectedSquare = null;
  selectedMoves = [];
  const status = getStatus(state);
  if (mode === 'pass' && !status.over) viewColor = status.turn;
  else if (mode === 'pass') viewColor = movingColor;
  render();
  if (!status.over && isBotsTurn()) scheduleBotMove();
}

function scheduleBotMove() {
  busy = true;
  render();
  botTimer = window.setTimeout(() => {
    const level = MODE_DEFS[mode].bot;
    const move = chooseMove(state, level);
    busy = false;
    commitMove(move);
  }, 240);
}

function render() {
  modeLabelEl.textContent = MODE_DEFS[mode].label;
  renderBoard();
  renderStatus();
  renderHistory();
  renderResult();
  resignBtn.disabled = getStatus(state).over;
}

function renderBoard() {
  const status = getStatus(state);
  const pieces = new Map(
    getBoard(state).flat().filter(Boolean).map((piece) => [piece.square, piece])
  );
  const files = viewColor === WHITE
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  const ranks = viewColor === WHITE
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];
  const last = status.lastMove;

  boardEl.innerHTML = '';
  for (const rank of ranks) {
    for (const file of files) {
      const square = `${file}${rank}`;
      const piece = pieces.get(square);
      const candidates = selectedMoves.filter((move) => move.to === square);
      const button = document.createElement('button');
      const fileIndex = file.charCodeAt(0) - 97;
      const isDark = (fileIndex + rank) % 2 === 1;
      button.type = 'button';
      button.className = `square ${isDark ? 'dark' : 'light'}`;
      button.dataset.square = square;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', squareLabel(square, piece, candidates.length > 0));
      if (selectedSquare === square) button.classList.add('selected');
      if (candidates.length) {
        button.classList.add('legal');
        if (piece || candidates.some((move) => move.captured)) button.classList.add('capture');
      }
      if (last && (last.from === square || last.to === square)) button.classList.add('last');
      if (piece && piece.type === 'k' && piece.color === status.checkedColor) {
        button.classList.add('check');
      }
      if (piece) {
        const span = document.createElement('span');
        span.className = `piece ${piece.color === WHITE ? 'white' : 'black'}${piece.type === 'q' ? ' queen' : ''}`;
        span.dataset.piece = piece.type;
        span.textContent = PIECES[piece.color][piece.type];
        button.appendChild(span);
      }
      button.addEventListener('click', () => onSquareTap(square));
      boardEl.appendChild(button);
    }
  }
}

function renderStatus() {
  const status = getStatus(state);
  statusEl.className = '';
  if (status.over) {
    statusEl.textContent = status.reason === 'checkmate' ? 'CHECKMATE IN THE QUEEN CITY' : 'GAME OVER';
    return;
  }
  if (busy && isBotsTurn()) {
    statusEl.textContent = mode === 'club' ? 'THE CLUB IS THINKING…' : 'THE TOURIST IS LOOKING AROUND…';
    statusEl.classList.add('thinking');
    return;
  }

  const color = COLOR_NAMES[status.turn];
  if (status.check) {
    statusEl.textContent = `CHECK — ${color} TO MOVE`;
    statusEl.classList.add('check');
  } else if (mode === 'pass') {
    statusEl.textContent = `${color} TO MOVE · BOARD FLIPPED`;
  } else if (status.turn === WHITE) {
    statusEl.textContent = 'YOUR MOVE · YOU ARE WHITE';
  } else {
    statusEl.textContent = `${MODE_DEFS[mode].label} TO MOVE`;
  }
}

function renderHistory() {
  const history = getMoveHistory(state);
  moveListEl.innerHTML = '';
  for (let i = 0; i < history.length; i += 2) {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'num';
    number.textContent = `${Math.floor(i / 2) + 1}.`;
    const white = document.createElement('span');
    white.textContent = history[i]?.san || '';
    const black = document.createElement('span');
    black.textContent = history[i + 1]?.san || '';
    item.append(number, white, black);
    moveListEl.appendChild(item);
  }
  const fullMoves = Math.ceil(history.length / 2);
  moveCountEl.textContent = `${fullMoves} ${fullMoves === 1 ? 'MOVE' : 'MOVES'}`;
  emptyMovesEl.classList.toggle('hidden', history.length > 0);
  moveListEl.classList.toggle('hidden', history.length === 0);
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderResult() {
  const status = getStatus(state);
  if (!status.over) {
    resultEl.classList.add('hidden');
    celebrationEl.classList.add('hidden');
    return;
  }

  resultEl.classList.remove('hidden');
  if (status.draw) {
    const [heading, copy] = DRAW_COPY[status.reason] || ['DRAW', 'Honors are even.'];
    resultKickerEl.textContent = heading;
    resultTextEl.textContent = copy;
  } else {
    const winner = COLOR_NAMES[status.winner];
    resultKickerEl.textContent = status.reason === 'checkmate' ? 'CHECKMATE!' : 'RESIGNED';
    if (mode === 'pass') {
      resultTextEl.textContent = `${winner} wins the board.`;
    } else if (status.winner === WHITE) {
      resultTextEl.textContent = status.reason === 'checkmate'
        ? 'You rule the Queen City board.'
        : `${MODE_DEFS[mode].label} resigned.`;
    } else {
      resultTextEl.textContent = status.reason === 'checkmate'
        ? `${MODE_DEFS[mode].label} takes the top table.`
        : 'You resigned. Fresh board?';
    }
  }
  celebrationEl.classList.toggle('hidden', status.reason !== 'checkmate');
}

function onResign() {
  const status = getStatus(state);
  if (status.over) return;
  if (!resignArmed) {
    resignArmed = true;
    resignBtn.classList.add('armed');
    resignBtn.textContent = 'SURE?';
    resignTimer = window.setTimeout(disarmResign, 2500);
    return;
  }
  clearTimeout(botTimer);
  busy = false;
  const resigning = isBotMode() ? WHITE : status.turn;
  state = resignGame(state, resigning);
  disarmResign();
  render();
}

function disarmResign() {
  clearTimeout(resignTimer);
  resignArmed = false;
  resignBtn.classList.remove('armed');
  resignBtn.textContent = 'RESIGN';
}

function findPiece(square) {
  return getBoard(state).flat().find((piece) => piece && piece.square === square) || null;
}

function squareLabel(square, piece, legal) {
  const occupant = piece
    ? `${piece.color === WHITE ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}`
    : 'empty';
  return `${square}, ${occupant}${legal ? ', legal destination' : ''}`;
}
