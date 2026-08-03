// QUEEN CITY CHESS — UI only.
//
// Rendering and interaction live here; chess rules live in engine.js and
// strategy lives in bot.js. Online play ferries that same engine state
// between two phones without adding rules here.

import {
  WHITE, BLACK,
  createInitialState, legalMoves, applyMove, resignGame,
  getStatus, getBoard, getMoveHistory,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';
import {
  lbEnabled, fetchTop, submitScore, renamePlayer, monthLabel,
  getName as lbGetName, playerId as lbPlayerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const boardEl = $('board');
const statusEl = $('status');
const botQuipEl = $('botQuip');
const modeLabelEl = $('modeLabel');
const moveListEl = $('moveList');
const moveCountEl = $('moveCount');
const emptyMovesEl = $('emptyMoves');
const blackCapturesEl = $('blackCaptures');
const whiteCapturesEl = $('whiteCaptures');
const moveCalloutEl = $('moveCallout');
const resultEl = $('result');
const resultKickerEl = $('resultKicker');
const resultTextEl = $('resultText');
const celebrationEl = $('celebration');
const resignBtn = $('resignBtn');
const promotionEl = $('promotion');
const promotionChoicesEl = $('promotionChoices');
const menuBtn = $('menuBtn');
const rematchBtn = $('rematchBtn');
const muteBtn = $('mute');
const onlinePanel = $('onlinePanel');
const opTitle = $('opTitle');
const opName = $('opName');
const opCodeWrap = $('opCodeWrap');
const opCode = $('opCode');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const rejoinBtn = $('rejoinBtn');

const MODE_DEFS = Object.freeze({
  pass: { kind: 'local', label: 'PASS & PLAY' },
  tourist: { kind: 'bot', label: 'THE TOURIST', bot: 'tourist' },
  club: { kind: 'bot', label: 'QUEEN CITY CLUB', bot: 'club' },
  online: { kind: 'online', label: 'ONLINE TABLE' },
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
const BOT_RESULT_LINES = {
  tourist: {
    win: {
      close: [
        'The Tourist: “That was closer than the map suggested.”',
        'The Tourist: “One wrong turn. Nicely played.”',
      ],
      clear: [
        'The Tourist: “You knew every shortcut.”',
        'The Tourist: “I came for the view. You came to win.”',
      ],
    },
    loss: {
      close: [
        'The Tourist: “Found the winning route by accident!”',
        'The Tourist: “That one belongs on a postcard.”',
      ],
      clear: [
        'The Tourist: “Beginner’s luck loves Burlington.”',
        'The Tourist: “I followed the little horse. It worked!”',
      ],
    },
  },
  club: {
    win: {
      close: [
        'The Club: “Excellent finish. Your chair is waiting.”',
        'The Club: “A proper top-table battle.”',
      ],
      clear: [
        'The Club: “Decisive. The board is yours.”',
        'The Club: “A commanding Queen City performance.”',
      ],
    },
    loss: {
      close: [
        'The Club: “A narrow edge. Another game?”',
        'The Club: “Well fought. The last detail decided it.”',
      ],
      clear: [
        'The Club: “The top table holds—for now.”',
        'The Club: “Study the position, then come right back.”',
      ],
    },
  },
};
const CAPTURE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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
let online = null; // { match, myPlayer } while seated at an online table
let effectGeneration = 0;
let calloutTimer = 0;
let quipTimer = 0;
let celebrationTimer = 0;
let gameSerial = 0;
let resultLineGame = -1;
let resultLine = '';
let resultLineSequence = 0;
let restoredAt = -Infinity;
const usedResultLines = new Set();

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => startMatch(button.dataset.mode));
});
menuBtn.addEventListener('click', backToMenu);
rematchBtn.addEventListener('click', rematch);
resignBtn.addEventListener('click', onResign);
$('promotionCancel').addEventListener('click', closePromotion);
muteBtn.addEventListener('click', () => {
  sound.toggleMuted();
  renderMute();
});
document.addEventListener('pointerdown', () => sound.unlock(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) restoredAt = performance.now();
});
renderMute();

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
  resetEffects();
  gameSerial++;
  state = createInitialState();
  selectedSquare = null;
  selectedMoves = [];
  pendingPromotion = [];
  viewColor = WHITE;
  busy = false;
  promotionEl.classList.add('hidden');
  celebrationEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  resetLbPanel();
  render();
}

function backToMenu() {
  if (online) {
    // Leaving abandons the room for both players; resignation is the
    // separate in-game action, so require a deliberate second tap here.
    if (menuBtn.dataset.armed !== '1') {
      menuBtn.dataset.armed = '1';
      menuBtn.textContent = 'LEAVE TABLE?';
      window.setTimeout(() => {
        menuBtn.dataset.armed = '';
        menuBtn.textContent = '← MENU';
      }, 2500);
      return;
    }
    online.match.leave();
    online = null;
    menuBtn.dataset.armed = '';
    menuBtn.textContent = '← MENU';
  }
  clearTimeout(botTimer);
  disarmResign();
  resetEffects();
  busy = false;
  closePromotion();
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function rematch() {
  if (online) onlineRematch();
  else newGame();
}

function isBotMode() {
  return MODE_DEFS[mode].kind === 'bot';
}

function isBotsTurn() {
  const status = getStatus(state);
  return isBotMode() && !status.over && status.turn === BLACK;
}

function onSquareTap(square) {
  const status = getStatus(state);
  if (busy || status.over || isBotsTurn()) return;
  if (online && (status.turn !== online.myPlayer || online.match.status !== 'playing')) return;

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
  const previousState = state;
  const visual = prepareMoveVisual(move);
  const movingColor = move.color;
  state = applyMove(state, move);
  selectedSquare = null;
  selectedMoves = [];
  const status = getStatus(state);
  if (mode === 'pass' && !status.over) viewColor = status.turn;
  else if (mode === 'pass') viewColor = movingColor;
  render({ settled: Boolean(online) });
  if (online) pushOnline({ previousState, visual });
  else runTransitionEffects(previousState, visual);
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

function render({ settled = false } = {}) {
  modeLabelEl.textContent = MODE_DEFS[mode].label;
  renderBoard();
  renderStatus();
  renderHistory();
  renderResult(settled);
  resignBtn.disabled = getStatus(state).over || Boolean(online && online.match.status !== 'playing');
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
  if (online) {
    const mine = status.turn === online.myPlayer;
    const opponent = online.match.opponents()[0] || {};
    if (status.check) {
      statusEl.textContent = mine
        ? 'CHECK — YOUR MOVE'
        : `CHECK — WAITING ON ${(opponent.name || 'YOUR OPPONENT').toUpperCase()}`;
      statusEl.classList.add('check');
    } else if (mine) {
      statusEl.textContent = `YOUR MOVE · YOU ARE ${COLOR_NAMES[online.myPlayer]}`;
    } else {
      const name = (opponent.name || 'YOUR OPPONENT').toUpperCase();
      statusEl.textContent = opponent.away ? `${name} STEPPED AWAY…` : `WAITING ON ${name}…`;
      statusEl.classList.add('thinking');
    }
    return;
  }
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
  renderCapturedPieces(history);
}

function renderCapturedPieces(history) {
  blackCapturesEl.innerHTML = '';
  whiteCapturesEl.innerHTML = '';
  const capturedBy = { w: [], b: [] };
  for (const move of history) {
    if (!move.san.includes('x') || !move.captured) continue;
    capturedBy[move.color].push({
      color: move.color === WHITE ? BLACK : WHITE,
      type: move.captured,
    });
  }
  for (const color of [BLACK, WHITE]) {
    const tray = color === BLACK ? blackCapturesEl : whiteCapturesEl;
    for (const piece of capturedBy[color]) {
      const icon = document.createElement('span');
      icon.className = piece.color === WHITE ? 'captured-white' : 'captured-black';
      icon.textContent = PIECES[piece.color][piece.type];
      icon.title = `${piece.color === WHITE ? 'White' : 'Black'} ${PIECE_NAMES[piece.type]}`;
      tray.appendChild(icon);
    }
    const description = capturedBy[color].length
      ? capturedBy[color].map((piece) => PIECE_NAMES[piece.type]).join(', ')
      : 'none';
    tray.setAttribute('aria-label', `Pieces captured by ${color === WHITE ? 'White' : 'Black'}: ${description}`);
  }
}

function renderResult(settled = false) {
  const status = getStatus(state);
  if (!status.over) {
    resultEl.classList.add('hidden');
    resultEl.classList.remove('settled', 'loss');
    celebrationEl.classList.add('hidden');
    return;
  }

  resultEl.classList.remove('hidden');
  resultEl.classList.toggle('settled', settled);
  resultEl.classList.toggle('loss', resultIsLoss(status));
  if (status.draw) {
    const [heading, copy] = DRAW_COPY[status.reason] || ['DRAW', 'Honors are even.'];
    resultKickerEl.textContent = heading;
    resultTextEl.textContent = copy;
  } else {
    const winner = COLOR_NAMES[status.winner];
    resultKickerEl.textContent = status.reason === 'checkmate' ? 'CHECKMATE!' : 'RESIGNED';
    if (mode === 'pass') {
      resultTextEl.textContent = `${winner} wins the board.`;
    } else if (online) {
      const opponent = online.match.opponents()[0] || {};
      const opponentName = (opponent.name || 'Your opponent').toUpperCase();
      const iWon = status.winner === online.myPlayer;
      if (status.reason === 'resignation') {
        resultTextEl.textContent = iWon
          ? `${opponentName} resigned. You win the board.`
          : 'You resigned. Fresh board?';
      } else {
        resultTextEl.textContent = iWon
          ? 'You rule the Queen City board.'
          : `${opponentName} takes the top table.`;
      }
    } else if (status.winner === WHITE) {
      resultTextEl.textContent = status.reason === 'checkmate'
        ? 'You rule the Queen City board.'
        : `${MODE_DEFS[mode].label} resigned.`;
    } else {
      resultTextEl.textContent = status.reason === 'checkmate'
        ? `${MODE_DEFS[mode].label} takes the top table.`
        : 'You resigned. Fresh board?';
    }
    if (isBotMode()) resultTextEl.textContent += ` ${botResultLine(status)}`;
  }
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
  const previousState = state;
  const resigning = online ? online.myPlayer : (isBotMode() ? WHITE : status.turn);
  state = resignGame(state, resigning);
  disarmResign();
  render({ settled: Boolean(online) });
  if (online) pushOnline({ previousState, visual: null });
  else runTransitionEffects(previousState, null);
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

/* ---------------------------------------------------------- game feel */

function renderMute() {
  muteBtn.textContent = sound.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', sound.muted ? 'Turn sound on' : 'Mute sound');
  muteBtn.setAttribute('aria-pressed', String(sound.muted));
}

function resetEffects() {
  effectGeneration++;
  clearTimeout(calloutTimer);
  clearTimeout(quipTimer);
  clearTimeout(celebrationTimer);
  moveCalloutEl.className = 'move-callout hidden';
  moveCalloutEl.textContent = '';
  botQuipEl.classList.add('hidden');
  botQuipEl.textContent = '';
  celebrationEl.classList.add('hidden');
  celebrationEl.classList.remove('loss');
  blackCapturesEl.classList.remove('just-captured');
  whiteCapturesEl.classList.remove('just-captured');
  document.querySelectorAll('.capture-ghost').forEach((node) => node.remove());
}

function prepareMoveVisual(move) {
  if (!move) return null;
  const movingPiece = boardEl.querySelector(`[data-square="${move.from}"] .piece`);
  let capturedPiece = null;
  if (move.captured) {
    const captureSquare = String(move.flags || '').includes('e')
      ? `${move.to[0]}${move.from[1]}`
      : move.to;
    capturedPiece = boardEl.querySelector(`[data-square="${captureSquare}"] .piece`);
  }
  return {
    fromRect: movingPiece ? copyRect(movingPiece.getBoundingClientRect()) : null,
    captured: capturedPiece ? {
      rect: copyRect(capturedPiece.getBoundingClientRect()),
      text: capturedPiece.textContent,
      color: capturedPiece.classList.contains('white') ? 'white' : 'black',
      fontSize: getComputedStyle(capturedPiece).fontSize,
    } : null,
  };
}

function copyRect(rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function transitionMove(previousState, nextState = state) {
  if (!previousState || nextState.history.length !== previousState.history.length + 1) return null;
  for (let i = 0; i < previousState.history.length; i++) {
    if (!sameMove(previousState.history[i], nextState.history[i])) return null;
  }
  return nextState.history[nextState.history.length - 1];
}

function sameMove(a, b) {
  return Boolean(a && b &&
    a.from === b.from &&
    a.to === b.to &&
    (a.promotion || '') === (b.promotion || '') &&
    a.san === b.san);
}

function runTransitionEffects(previousState, visual) {
  const move = transitionMove(previousState);
  const wasOver = previousState ? getStatus(previousState).over : true;
  const status = getStatus(state);
  const newlyOver = !wasOver && status.over;
  if (!move && !newlyOver) return;

  if (move) {
    animateMove(move, visual);
    if (move.captured) {
      animateCapture(visual);
      pulseCaptureTray(move.color);
      if (!status.over) {
        showCallout('CAPTURE', true);
        showBotQuip(move);
      }
    }
    if (status.check && !status.checkmate) showCheck();
    playMoveSound(move, status);
  }

  if (newlyOver) {
    if (!status.draw) showCelebration(status);
    if (status.draw) sound.draw();
    else if (!status.checkmate) sound.resolution(!resultIsLoss(status));
    resultEl.classList.remove('settled');
    rematchBtn.focus({ preventScroll: true });
    if (isBotMode() && !online) {
      // Fresh vs-bot finish only (newlyOver fires once per game). Wins
      // submit a score; losses and draws show the standings read-only.
      const humanWon = !status.draw && status.winner === WHITE;
      updateLeaderboard(humanWon ? botWinScore() : 0);
    }
  }
}

/* ------------------------------------------------------------- leaderboard */
// Monthly board for vs-bot wins only. Score rewards the fastest checkmate:
// base = 300 minus your (White) move count, +1000 for Queen City Club wins
// so any Club win outranks any Tourist win.

const lbBox = $('lb');
const lbList = $('lbList');
const lbStatusEl = $('lbStatus');
const lbForm = $('lbForm');
const lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn');
const lbLastBtn = $('lbLastBtn');
const lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

function resetLbPanel() {
  lbBox.classList.add('hidden');
  lbForm.classList.add('hidden');
  lbForm.dataset.pendingScore = '';
}

function botWinScore() {
  const myMoves = Math.ceil(getMoveHistory(state).length / 2);
  const base = Math.max(1, Math.min(999, 300 - myMoves));
  return mode === 'club' ? 1000 + base : base;
}

// s >= 1000 means a Queen City Club win; otherwise a Tourist win.
// Decode back to the winner's move count (base = 300 - moves).
function lbScoreLabel(s) {
  const club = s >= 1000;
  const moves = 300 - (club ? s - 1000 : s);
  return `${club ? '♛' : '🧳'} ${moves} moves`;
}

// score > 0 submits a fresh win; score 0 just shows the standings read-only
async function updateLeaderboard(score) {
  if (!lbEnabled()) return;
  lbBox.classList.remove('hidden');
  if (score > 0 && !lbGetName()) {
    // first win with no saved name: hold the score until they pick one
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatusEl.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(score);
    return;
  }
  if (score > 0) {
    try { await submitScore(score); } catch { /* offline — still show the board */ }
  }
  renderLbBoard();
}

async function renderLbBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatusEl.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = lbPlayerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((row, i) => {
      const item = document.createElement('li');
      if (row.player_id === me) item.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      item.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="sc"></span>';
      item.querySelector('.rank').textContent = medal || `${i + 1}.`;
      item.querySelector('.nm').textContent = row.name;
      item.querySelector('.sc').textContent = lbScoreLabel(row.score);
      lbList.appendChild(item);
    });
    const myRank = rows.findIndex((row) => row.player_id === me);
    lbStatusEl.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatusEl.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + renames any existing rows
    if (pending > 0) await submitScore(pending);
  } catch { /* offline — the name is still saved locally */ }
  renderLbBoard();
});
lbNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = lbGetName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderLbBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderLbBoard();
});

function animateMove(move, visual) {
  if (motionQuery.matches || !visual?.fromRect) return;
  const movedPiece = boardEl.querySelector(`[data-square="${move.to}"] .piece`);
  if (!movedPiece || typeof movedPiece.animate !== 'function') return;
  const destination = movedPiece.getBoundingClientRect();
  const deltaX = visual.fromRect.left - destination.left;
  const deltaY = visual.fromRect.top - destination.top;
  movedPiece.animate([
    { transform: `translate(${deltaX}px, ${deltaY}px)` },
    { transform: 'translate(0, -1%)' },
  ], {
    duration: 180,
    easing: 'cubic-bezier(0.22, 0.8, 0.28, 1)',
  });
}

function animateCapture(visual) {
  if (motionQuery.matches || !visual?.captured) return;
  const ghost = document.createElement('span');
  const captured = visual.captured;
  ghost.className = `capture-ghost ${captured.color}`;
  ghost.textContent = captured.text;
  Object.assign(ghost.style, {
    left: `${captured.rect.left}px`,
    top: `${captured.rect.top}px`,
    width: `${captured.rect.width}px`,
    height: `${captured.rect.height}px`,
    fontSize: captured.fontSize,
  });
  document.body.appendChild(ghost);
  ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
  window.setTimeout(() => ghost.remove(), 400);
}

function pulseCaptureTray(color) {
  if (motionQuery.matches) return;
  const tray = color === WHITE ? whiteCapturesEl : blackCapturesEl;
  tray.classList.remove('just-captured');
  void tray.offsetWidth;
  tray.classList.add('just-captured');
  window.setTimeout(() => tray.classList.remove('just-captured'), 320);
}

function showCheck() {
  if (!motionQuery.matches) {
    const kingSquare = boardEl.querySelector('.square.check');
    if (kingSquare) {
      kingSquare.classList.add('check-flash');
      kingSquare.addEventListener('animationend', () => {
        kingSquare.classList.remove('check-flash');
      }, { once: true });
    }
  }
  showCallout('CHECK!');
}

function showCallout(text, capture = false) {
  if (motionQuery.matches) return;
  clearTimeout(calloutTimer);
  moveCalloutEl.className = `move-callout${capture ? ' capture-callout' : ''}`;
  moveCalloutEl.textContent = text;
  void moveCalloutEl.offsetWidth;
  moveCalloutEl.classList.add('show');
  const generation = effectGeneration;
  calloutTimer = window.setTimeout(() => {
    if (generation !== effectGeneration) return;
    moveCalloutEl.className = 'move-callout hidden';
  }, 680);
}

function showBotQuip(move) {
  if (!isBotMode() || !move.captured) return;
  const botMoved = move.color === BLACK;
  const valuable = move.captured === 'q' || move.captured === 'r';
  const lines = mode === 'club'
    ? {
      bot: valuable ? 'The Club: “That piece was hanging.”' : 'The Club: “A clean pickup.”',
      player: valuable ? 'The Club: “That one stings. Well spotted.”' : 'The Club: “Nicely taken.”',
    }
    : {
      bot: valuable ? 'The Tourist: “Was that a shortcut?”' : 'The Tourist: “A souvenir!”',
      player: valuable ? 'The Tourist: “I needed that for the itinerary.”' : 'The Tourist: “Oops—wrong pocket.”',
    };
  clearTimeout(quipTimer);
  botQuipEl.textContent = botMoved ? lines.bot : lines.player;
  botQuipEl.classList.remove('hidden');
  const generation = effectGeneration;
  quipTimer = window.setTimeout(() => {
    if (generation === effectGeneration) botQuipEl.classList.add('hidden');
  }, 2600);
}

function playMoveSound(move, status) {
  if (status.checkmate) sound.checkmate();
  else if (status.check) sound.check();
  else if (move.san === 'O-O' || move.san === 'O-O-O') sound.castle();
  else if (move.captured) sound.capture();
  else sound.move();
}

function showCelebration(status) {
  if (motionQuery.matches) return;
  clearTimeout(celebrationTimer);
  celebrationEl.classList.toggle('loss', resultIsLoss(status));
  celebrationEl.classList.remove('hidden');
  const generation = effectGeneration;
  celebrationTimer = window.setTimeout(() => {
    if (generation === effectGeneration) celebrationEl.classList.add('hidden');
  }, 3700);
}

function resultIsLoss(status) {
  if (status.draw || !status.winner) return false;
  if (isBotMode()) return status.winner !== WHITE;
  if (online) return status.winner !== online.myPlayer;
  return false;
}

function botResultLine(status) {
  if (resultLineGame === gameSerial) return resultLine;
  const outcome = status.winner === WHITE ? 'win' : 'loss';
  const closeness = isCloseGame() ? 'close' : 'clear';
  const preferred = BOT_RESULT_LINES[mode][outcome][closeness];
  const alternatives = BOT_RESULT_LINES[mode][outcome][closeness === 'close' ? 'clear' : 'close'];
  const available = [...preferred, ...alternatives].filter((line) => !usedResultLines.has(line));
  if (available.length) {
    resultLine = available[resultLineSequence % available.length];
  } else {
    const name = mode === 'club' ? 'The Club' : 'The Tourist';
    resultLine = `${name}: “Another board for the books—round ${resultLineSequence + 1}.”`;
  }
  usedResultLines.add(resultLine);
  resultLineSequence++;
  resultLineGame = gameSerial;
  return resultLine;
}

function isCloseGame() {
  const captured = { w: 0, b: 0 };
  for (const move of getMoveHistory(state)) {
    if (move.san.includes('x') && move.captured) {
      captured[move.color] += CAPTURE_VALUES[move.captured] || 0;
    }
  }
  return Math.abs(captured.w - captured.b) <= 3;
}

/* ------------------------------------------------------------- online play */
// The rooms layer moves the engine's complete JSON state between two phones.
// Seat 0 is White and seat 1 is Black. Remote moves are repainted cold so
// promotion, check, history, rematches, and conflict truth all share the
// exact same rendering path as local moves.

const GAME = 'queen-city-chess';
let panelIntent = 'host';
let pollErrors = 0;

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinTable);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((input) => input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  opTitle.textContent = intent === 'host' ? 'OPEN A TABLE' : 'JOIN A TABLE';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'TAKE YOUR SEAT';
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No table with that code — double-check the letters.',
  room_full: 'That table already has two players.',
  room_started: 'That game is already under way.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the table — are you online?",
};

function friendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code is for ${String(err.detail || 'another game').replace(/-/g, ' ')} — open that game to use it.`;
  }
  return (err && FRIENDLY_ERRORS[err.code]) || 'The table wobbled — please try again.';
}

async function onlineGo() {
  const go = $('opGo');
  if (go.disabled) return;
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every player needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }

  go.disabled = true;
  opError.classList.add('hidden');
  try {
    if (panelIntent === 'host') {
      const match = await OnlineMatch.create({
        game: GAME,
        name,
        state: createInitialState(),
        seats: 2,
      });
      closePanel();
      openLobby(match);
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The table code is 4 letters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      const match = await OnlineMatch.join({ game: GAME, code, name });
      closePanel();
      enterOnlineGame(match);
    }
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  lobbyCode.textContent = match.code;
  lobbyEl.classList.remove('hidden');
  match.start({
    onStatus: (roomStatus) => {
      if (roomStatus === 'playing') {
        lobbyEl.classList.add('hidden');
        enterOnlineGame(match);
      }
    },
    onError: () => {},
  });
  lobbyEl._match = match;
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinTable() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (err) {
    if (err && (err.code === 'not_found' || err.code === 'not_seated' || err.code === 'room_started')) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR TABLE (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  disarmResign();
  resetEffects();
  gameSerial++;
  mode = 'online';
  online = { match, myPlayer: match.seat === 0 ? WHITE : BLACK };
  pollErrors = 0;
  state = match.state;
  selectedSquare = null;
  selectedMoves = [];
  pendingPromotion = [];
  viewColor = online.myPlayer;
  busy = false;
  promotionEl.classList.add('hidden');
  celebrationEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  resetLbPanel();
  rematchBtn.classList.remove('hidden');
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  render({ settled: true });
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  if (match.status === 'over' && !getStatus(state).over) renderAbandoned(true);
}

function onRemoteState(newState) {
  const previousState = state;
  const move = transitionMove(previousState, newState);
  const newlyOver = !getStatus(previousState).over && getStatus(newState).over;
  const visual = move ? prepareMoveVisual(move) : null;
  const allowEffects = Boolean(move || newlyOver) &&
    pollErrors === 0 &&
    !document.hidden &&
    performance.now() - restoredAt > 750;
  state = newState;
  selectedSquare = null;
  selectedMoves = [];
  pendingPromotion = [];
  viewColor = online.myPlayer;
  busy = false;
  promotionEl.classList.add('hidden');
  rematchBtn.classList.remove('hidden');
  render({ settled: !allowEffects });
  if (allowEffects) runTransitionEffects(previousState, visual);
}

function onRemoteStatus(roomStatus) {
  if (roomStatus === 'over' && !getStatus(state).over) renderAbandoned();
}

function onRemotePresence(opponents) {
  pollErrors = 0;
  const opponent = opponents[0];
  if (opponent && opponent.left) {
    rematchBtn.classList.add('hidden');
    if (!getStatus(state).over) renderAbandoned();
  } else if (!getStatus(state).over) {
    renderStatus();
  }
}

function renderAbandoned(settled = false) {
  const opponent = online.match.opponents()[0] || {};
  resetEffects();
  selectedSquare = null;
  selectedMoves = [];
  busy = false;
  closePromotion();
  renderBoard();
  renderHistory();
  statusEl.className = '';
  statusEl.textContent = 'THE OTHER PLAYER LEFT THE TABLE';
  resultKickerEl.textContent = 'TABLE CLOSED';
  resultTextEl.textContent = `${(opponent.name || 'Your opponent').toUpperCase()} left without resigning.`;
  resultEl.classList.remove('hidden');
  resultEl.classList.toggle('settled', settled);
  celebrationEl.classList.add('hidden');
  rematchBtn.classList.add('hidden');
  resignBtn.disabled = true;
}

function onPollError(err) {
  if (err && err.code === 'not_found') {
    online.match.stop();
    clearSession(GAME);
    online = null;
    mode = 'pass';
    gameEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
    refreshRejoin();
    return;
  }
  pollErrors++;
  if (pollErrors >= 3 && !getStatus(state).over) {
    statusEl.className = 'thinking';
    statusEl.textContent = 'CHOPPY CONNECTION — HOLD YOUR MOVE…';
  }
}

async function pushOnline(transition = null) {
  const activeOnline = online;
  if (!activeOnline) return;
  const attemptedState = state;
  const status = getStatus(attemptedState);
  const generation = effectGeneration;
  try {
    await activeOnline.match.push(attemptedState, { over: status.over });
    if (online !== activeOnline || generation !== effectGeneration || state !== attemptedState) return;
    pollErrors = 0;
    render({ settled: true });
    if (transition) runTransitionEffects(transition.previousState, transition.visual);
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      if (online !== activeOnline) return;
      state = activeOnline.match.state;
      onRemoteState(state);
      return;
    }
    window.setTimeout(async () => {
      if (online !== activeOnline || generation !== effectGeneration || state !== attemptedState) return;
      try {
        await activeOnline.match.push(attemptedState, { over: status.over });
        if (online !== activeOnline || generation !== effectGeneration || state !== attemptedState) return;
        pollErrors = 0;
        render({ settled: true });
        if (transition) runTransitionEffects(transition.previousState, transition.visual);
      } catch (retryErr) {
        onPollError(retryErr);
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online) return;
  resetEffects();
  gameSerial++;
  const fresh = createInitialState();
  state = fresh;
  onRemoteState(fresh);
  try {
    await online.match.push(fresh, {});
    render();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      state = online.match.state;
      onRemoteState(state);
    } else {
      onPollError(err);
    }
  }
}

refreshRejoin();

/* ------------------------------------------------- crew-link invites */
// Text a link instead of reading letters aloud: ?join=ABCD opens the join
// panel with the code filled in, then scrubs the URL so refreshes don't
// re-trigger it. Canonical pattern: four-in-a-rowboat (ROOMS-INTEGRATION §6).

$('inviteBtn').addEventListener('click', async () => {
  const code = ($('lobbyCode').textContent || '').trim();
  if (!code) return;
  const url = `${location.origin}${location.pathname}?join=${code}`;
  const text = `♛ Your move — chess me — tap to join my Queen City Chess game: ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* share sheet closed */ }
});

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  $('opCode').value = code.toUpperCase();
})();
