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
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';

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
const menuBtn = $('menuBtn');
const rematchBtn = $('rematchBtn');
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

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => startMatch(button.dataset.mode));
});
menuBtn.addEventListener('click', backToMenu);
rematchBtn.addEventListener('click', rematch);
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
  const movingColor = move.color;
  state = applyMove(state, move);
  selectedSquare = null;
  selectedMoves = [];
  const status = getStatus(state);
  if (mode === 'pass' && !status.over) viewColor = status.turn;
  else if (mode === 'pass') viewColor = movingColor;
  render();
  if (online) pushOnline();
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
  const resigning = online ? online.myPlayer : (isBotMode() ? WHITE : status.turn);
  state = resignGame(state, resigning);
  disarmResign();
  render();
  if (online) pushOnline();
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
  rematchBtn.classList.remove('hidden');
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  render();
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  if (match.status === 'over' && !getStatus(state).over) renderAbandoned();
}

function onRemoteState(newState) {
  state = newState;
  selectedSquare = null;
  selectedMoves = [];
  pendingPromotion = [];
  viewColor = online.myPlayer;
  busy = false;
  promotionEl.classList.add('hidden');
  rematchBtn.classList.remove('hidden');
  render();
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

function renderAbandoned() {
  const opponent = online.match.opponents()[0] || {};
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

async function pushOnline() {
  const attemptedState = state;
  const status = getStatus(attemptedState);
  try {
    await online.match.push(attemptedState, { over: status.over });
    pollErrors = 0;
    render();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      state = online.match.state;
      onRemoteState(state);
      return;
    }
    window.setTimeout(async () => {
      if (!online || state !== attemptedState) return;
      try {
        await online.match.push(attemptedState, { over: status.over });
        pollErrors = 0;
        render();
      } catch (retryErr) {
        onPollError(retryErr);
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online) return;
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
