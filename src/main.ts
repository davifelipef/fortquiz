import './style.css';
import {
  createPlayer,
  listenToPlayers,
  removePlayer,
  resetAllPlayers,
  savePlayerPosition,
  playerId,
  type PlayerShape,
  type RemotePlayer,
} from './firebase/player';
import {
  finishGame,
  initializeGame,
  listenToGame,
  nextQuestion,
  resetGame,
  startGame,
  type GameSession,
} from './firebase/game';
import { loginTeacher } from './firebase/auth';
import { database } from './firebase/config';
import { onValue, ref } from 'firebase/database';

type Shape = PlayerShape;

interface Player {
  element: HTMLDivElement;
  x: number;
  y: number;
  speed: number;
  shape: Shape;
}

interface RemotePlayerState {
  element: HTMLDivElement;
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  interpolationStart: number;
}

const ROUND_DURATION = 15;
const PLAYER_SIZE = 32;

const questions = [
  {
    text: 'Qual linguagem é executada diretamente pelo navegador?',
    answers: ['Python', 'JavaScript', 'C#', 'Java'],
    correctAnswer: 1,
  },
  {
    text: 'Qual tecnologia é usada para estruturar o conteúdo de uma página web?',
    answers: ['CSS', 'HTML', 'SQL', 'Git'],
    correctAnswer: 1,
  },
];

const shapes: Shape[] = ['circle', 'square', 'triangle'];

const colors = [
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#facc15',
  '#fb923c',
  '#c084fc',
];

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Elemento #app não encontrado.');
}

const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
const randomColor = colors[Math.floor(Math.random() * colors.length)];

let isTeacher = false;
let isFrozen = false;
let currentSession: GameSession | null = null;
let currentQuestionIndex = 0;
let countdownInterval: number | null = null;
let playersSnapshot: Record<string, RemotePlayer> = {};

app.innerHTML = `
  <main class="game">
    <section class="question">
      <h1 id="question-text"></h1>
    </section>

    <section class="arena" id="arena">
      <div class="player player-${randomShape}" id="player"></div>

      <div class="answers" id="answers"></div>

      <div class="countdown" id="countdown"></div>
    </section>

    <button class="menu-button" id="menu-button" type="button" aria-label="Menu">
      ⋮
    </button>

    <div class="admin-panel hidden" id="admin-panel">
      <form class="password-form" id="password-form">
        <input
          id="password-input"
          type="password"
          placeholder="Senha"
          autocomplete="current-password"
        />
        <button type="submit">Entrar</button>
      </form>
    </div>

    <div class="teacher-controls hidden" id="teacher-controls">
      <button class="control-button" id="play-button" type="button">
        ▶ Play
      </button>

      <button class="control-button" id="reset-button" type="button">
        ↻ Reset
      </button>

      <button
        class="control-button hidden"
        id="next-button"
        type="button"
      >
        ⏭ Próxima
      </button>
    </div>

    <div class="modal-overlay hidden" id="report-modal">
      <section class="report-modal">
        <h2>Resultado da rodada</h2>

        <div id="report-content"></div>

        <button class="control-button" id="close-report-button" type="button">
          Fechar
        </button>
      </section>
    </div>
  </main>
`;

const arena = document.querySelector<HTMLDivElement>('#arena')!;
const playerElement =
  document.querySelector<HTMLDivElement>('#player')!;
const questionText =
  document.querySelector<HTMLHeadingElement>('#question-text')!;
const answersContainer =
  document.querySelector<HTMLDivElement>('#answers')!;
const countdownElement =
  document.querySelector<HTMLDivElement>('#countdown')!;

const menuButton =
  document.querySelector<HTMLButtonElement>('#menu-button')!;
const adminPanel =
  document.querySelector<HTMLDivElement>('#admin-panel')!;
const passwordForm =
  document.querySelector<HTMLFormElement>('#password-form')!;
const passwordInput =
  document.querySelector<HTMLInputElement>('#password-input')!;

const teacherControls =
  document.querySelector<HTMLDivElement>('#teacher-controls')!;
const playButton =
  document.querySelector<HTMLButtonElement>('#play-button')!;
const resetButton =
  document.querySelector<HTMLButtonElement>('#reset-button')!;
const nextButton =
  document.querySelector<HTMLButtonElement>('#next-button')!;

const reportModal =
  document.querySelector<HTMLDivElement>('#report-modal')!;
const reportContent =
  document.querySelector<HTMLDivElement>('#report-content')!;
const closeReportButton =
  document.querySelector<HTMLButtonElement>('#close-report-button')!;

playerElement.style.backgroundColor = randomColor;

const player: Player = {
  element: playerElement,
  x: 0,
  y: 0,
  speed: 4,
  shape: randomShape,
};

const remotePlayers = new Map<string, RemotePlayerState>();
const keys = new Set<string>();

function getMaxPlayerPosition(): {
  maxX: number;
  maxY: number;
} {
  return {
    maxX: Math.max(0, arena.clientWidth - PLAYER_SIZE),
    maxY: Math.max(0, arena.clientHeight - PLAYER_SIZE),
  };
}

function normalizePosition(
  x: number,
  y: number,
): {
  x: number;
  y: number;
} {
  const { maxX, maxY } = getMaxPlayerPosition();

  return {
    x: maxX > 0 ? Math.max(0, Math.min(1, x / maxX)) : 0,
    y: maxY > 0 ? Math.max(0, Math.min(1, y / maxY)) : 0,
  };
}

function denormalizePosition(
  x: number,
  y: number,
): {
  x: number;
  y: number;
} {
  const { maxX, maxY } = getMaxPlayerPosition();

  return {
    x: Math.max(0, Math.min(maxX, x * maxX)),
    y: Math.max(0, Math.min(maxY, y * maxY)),
  };
}

function renderQuestion(): void {
  const question = questions[currentQuestionIndex];

  if (!question) {
    return;
  }

  questionText.textContent = question.text;

  answersContainer.innerHTML = question.answers
    .map(
      (answer, index) => `
        <div class="answer" data-answer="${index}">
          ${answer}
        </div>
      `,
    )
    .join('');
}

function clearAnswerResults(): void {
  getAnswerElements().forEach((answerElement) => {
    answerElement.classList.remove('correct', 'incorrect', 'selected');
  });
}

function getAnswerElements(): HTMLDivElement[] {
  return Array.from(
    answersContainer.querySelectorAll<HTMLDivElement>('.answer'),
  );
}

function isPlayerInsideAnswer(
  x: number,
  y: number,
): boolean {
  const playerCenterX = x + PLAYER_SIZE / 2;
  const playerCenterY = y + PLAYER_SIZE / 2;

  const arenaRect = arena.getBoundingClientRect();

  return getAnswerElements().some((answerElement) => {
    const answerRect = answerElement.getBoundingClientRect();

    return (
      playerCenterX + arenaRect.left >= answerRect.left &&
      playerCenterX + arenaRect.left <= answerRect.right &&
      playerCenterY + arenaRect.top >= answerRect.top &&
      playerCenterY + arenaRect.top <= answerRect.bottom
    );
  });
}

function updateSelectedAnswer(): void {
  if (isFrozen || isTeacher) {
    return;
  }

  const playerRect = player.element.getBoundingClientRect();

  const playerCenterX =
    playerRect.left + playerRect.width / 2;

  const playerCenterY =
    playerRect.top + playerRect.height / 2;

  let selectedAnswer: HTMLDivElement | null = null;

  getAnswerElements().forEach((answerElement) => {
    const answerRect = answerElement.getBoundingClientRect();

    const isInside =
      playerCenterX >= answerRect.left &&
      playerCenterX <= answerRect.right &&
      playerCenterY >= answerRect.top &&
      playerCenterY <= answerRect.bottom;

    if (isInside) {
      selectedAnswer = answerElement;
    }
  });

  getAnswerElements().forEach((answerElement) => {
    answerElement.classList.toggle(
      'selected',
      answerElement === selectedAnswer,
    );
  });

  player.element.style.opacity = selectedAnswer ? '0.15' : '1';
}

function revealCorrectAnswer(): void {
  const question = questions[currentQuestionIndex];

  if (!question) {
    return;
  }

  getAnswerElements().forEach((answerElement) => {
    const answerIndex = Number(answerElement.dataset.answer);

    answerElement.classList.remove('selected');

    if (answerIndex === question.correctAnswer) {
      answerElement.classList.add('correct');
    } else {
      answerElement.classList.add('incorrect');
    }
  });
}

function createRemotePlayerElement(
  remotePlayerId: string,
  remotePlayer: RemotePlayer,
): RemotePlayerState {
  const position = denormalizePosition(
    remotePlayer.x,
    remotePlayer.y,
  );

  const element = document.createElement('div');

  element.className = `player player-${remotePlayer.shape}`;
  element.dataset.playerId = remotePlayerId;
  element.style.backgroundColor = remotePlayer.color;
  element.style.transform =
    `translate(${position.x}px, ${position.y}px)`;
  element.style.opacity = isPlayerInsideAnswer(
    position.x,
    position.y,
  )
    ? '0.15'
    : '1';

  arena.appendChild(element);

  const state: RemotePlayerState = {
    element,
    currentX: position.x,
    currentY: position.y,
    startX: position.x,
    startY: position.y,
    targetX: position.x,
    targetY: position.y,
    interpolationStart: performance.now(),
  };

  remotePlayers.set(remotePlayerId, state);

  return state;
}

function updateRemotePlayers(
  players: Record<string, RemotePlayer>,
): void {
  playersSnapshot = players;

  const remotePlayerIds = Object.keys(players).filter(
    (remotePlayerId) => remotePlayerId !== playerId,
  );

  const currentPlayerIds = new Set(remotePlayerIds);

  for (const [remotePlayerId, state] of remotePlayers) {
    if (!currentPlayerIds.has(remotePlayerId)) {
      state.element.remove();
      remotePlayers.delete(remotePlayerId);
    }
  }

  remotePlayerIds.forEach((remotePlayerId) => {
    const remotePlayer = players[remotePlayerId];

    if (!remotePlayer) {
      return;
    }

    const position = denormalizePosition(
      remotePlayer.x,
      remotePlayer.y,
    );

    let state = remotePlayers.get(remotePlayerId);

    if (!state) {
      state = createRemotePlayerElement(
        remotePlayerId,
        remotePlayer,
      );
    }

    state.element.className = `player player-${remotePlayer.shape}`;
    state.element.style.backgroundColor = remotePlayer.color;

    state.startX = state.currentX;
    state.startY = state.currentY;

    state.targetX = position.x;
    state.targetY = position.y;

    state.interpolationStart = performance.now();
  });
}

function updateRemotePlayerPositions(timestamp: number): void {
  const interpolationDuration = 100;

  remotePlayers.forEach((state) => {
    if (isFrozen) {
      return;
    }

    const elapsed = timestamp - state.interpolationStart;
    const progress = Math.min(elapsed / interpolationDuration, 1);

    state.currentX =
      state.startX + (state.targetX - state.startX) * progress;

    state.currentY =
      state.startY + (state.targetY - state.startY) * progress;

    state.element.style.transform =
      `translate(${state.currentX}px, ${state.currentY}px)`;

    state.element.style.opacity = isPlayerInsideAnswer(
      state.currentX,
      state.currentY,
    )
      ? '0.15'
      : '1';
  });

  requestAnimationFrame(updateRemotePlayerPositions);
}

function updatePlayerPosition(): void {
  if (!isTeacher && !isFrozen) {
    const { maxX, maxY } = getMaxPlayerPosition();

    if (keys.has('ArrowLeft')) {
      player.x -= player.speed;
    }

    if (keys.has('ArrowRight')) {
      player.x += player.speed;
    }

    if (keys.has('ArrowUp')) {
      player.y -= player.speed;
    }

    if (keys.has('ArrowDown')) {
      player.y += player.speed;
    }

    player.x = Math.max(0, Math.min(player.x, maxX));
    player.y = Math.max(0, Math.min(player.y, maxY));

    player.element.style.transform =
      `translate(${player.x}px, ${player.y}px)`;

    updateSelectedAnswer();
  }

  requestAnimationFrame(updatePlayerPosition);
}

let lastSyncTime = 0;

function syncPlayerPosition(timestamp: number): void {
  if (!isTeacher && !isFrozen && timestamp - lastSyncTime >= 100) {
    const normalizedPosition = normalizePosition(
      player.x,
      player.y,
    );

    savePlayerPosition(
      normalizedPosition.x,
      normalizedPosition.y,
    );

    lastSyncTime = timestamp;
  }

  requestAnimationFrame(syncPlayerPosition);
}

function getServerTime(): Promise<number> {
  return new Promise((resolve) => {
    const offsetRef = ref(database, '.info/serverTimeOffset');

    onValue(
      offsetRef,
      (snapshot) => {
        const offset = snapshot.val();

        resolve(
          Date.now() + (typeof offset === 'number' ? offset : 0),
        );
      },
      {
        onlyOnce: true,
      },
    );
  });
}

function showCountdown(value: number): void {
  countdownElement.textContent = String(value);
  countdownElement.classList.remove('hidden');
}

function hideCountdown(): void {
  countdownElement.textContent = '';
  countdownElement.classList.add('hidden');
}

function freezePlayers(): void {
  isFrozen = true;
  keys.clear();

  revealCorrectAnswer();

  player.element.classList.add('frozen');

  remotePlayers.forEach((state) => {
    state.currentX = state.targetX;
    state.currentY = state.targetY;

    state.element.style.transform =
      `translate(${state.currentX}px, ${state.currentY}px)`;

    state.element.classList.add('frozen');
  });

  if (isTeacher) {
    player.element.classList.add('hidden');
  }
}

function unfreezePlayers(): void {
  isFrozen = false;

  player.element.classList.remove('frozen');

  remotePlayers.forEach((state) => {
    state.element.classList.remove('frozen');
  });
}

async function startCountdown(session: GameSession): Promise<void> {
  if (!session.startedAt) {
    return;
  }

  if (countdownInterval !== null) {
    window.clearInterval(countdownInterval);
  }

  isFrozen = false;
  unfreezePlayers();
  hideCountdown();

  const startedAt = session.startedAt;

  const updateCountdown = async (): Promise<void> => {
    const serverTime = await getServerTime();
    const elapsed = serverTime - startedAt;
    const remaining = ROUND_DURATION * 1000 - elapsed;

    if (remaining <= 0) {
      if (countdownInterval !== null) {
        window.clearInterval(countdownInterval);
        countdownInterval = null;
      }

      showCountdown(0);
      freezePlayers();

      if (isTeacher) {
        finishGame(currentQuestionIndex);
        showReport();
      }

      return;
    }

    const seconds = Math.ceil(remaining / 1000);

    showCountdown(seconds);
  };

  await updateCountdown();

  countdownInterval = window.setInterval(updateCountdown, 100);
}

function getPlayerAnswer(
  x: number,
  y: number,
): number | null {
  const question = questions[currentQuestionIndex];

  if (!question) {
    return null;
  }

  const position = denormalizePosition(x, y);

  const playerCenterX = position.x + PLAYER_SIZE / 2;
  const playerCenterY = position.y + PLAYER_SIZE / 2;

  const answerElements = getAnswerElements();
  const arenaRect = arena.getBoundingClientRect();

  for (const answerElement of answerElements) {
    const answerRect = answerElement.getBoundingClientRect();

    const isInside =
      playerCenterX + arenaRect.left >= answerRect.left &&
      playerCenterX + arenaRect.left <= answerRect.right &&
      playerCenterY + arenaRect.top >= answerRect.top &&
      playerCenterY + arenaRect.top <= answerRect.bottom;

    if (isInside) {
      return Number(answerElement.dataset.answer);
    }
  }

  return null;
}

function showReport(): void {
  const question = questions[currentQuestionIndex];

  if (!question) {
    return;
  }

  const counts = question.answers.map(() => 0);
  let outside = 0;

  Object.entries(playersSnapshot).forEach(
    ([remotePlayerId, remotePlayer]) => {
      if (remotePlayerId === playerId) {
        return;
      }

      const answer = getPlayerAnswer(
        remotePlayer.x,
        remotePlayer.y,
      );

      if (answer === null) {
        outside += 1;
        return;
      }

      counts[answer] += 1;
    },
  );

  reportContent.innerHTML = `
    <div class="report-question">
      ${question.text}
    </div>

    <div class="report-results">
      ${question.answers
        .map(
          (answer, index) => `
            <div
              class="report-answer ${
                index === question.correctAnswer
                  ? 'correct'
                  : 'incorrect'
              }"
            >
              <span>${answer}</span>
              <strong>${counts[index]}</strong>
            </div>
          `,
        )
        .join('')}

      <div class="report-answer outside">
        <span>Fora das alternativas</span>
        <strong>${outside}</strong>
      </div>
    </div>
  `;

  reportModal.classList.remove('hidden');

  nextButton.classList.toggle(
    'hidden',
    currentQuestionIndex >= questions.length - 1,
  );
}

function resetLocalPlayer(): void {
  player.x = 0;
  player.y = 0;

  player.element.style.transform =
    `translate(${player.x}px, ${player.y}px)`;

  player.element.style.opacity = '1';

  if (!isTeacher) {
    savePlayerPosition(0, 0);
  }

  updateSelectedAnswer();
}

function enterTeacherMode(): void {
  isTeacher = true;

  keys.clear();
  removePlayer();

  currentQuestionIndex = 0;
  currentSession = null;

  playerElement.classList.add('hidden');
  adminPanel.classList.add('hidden');
  menuButton.classList.add('hidden');
  teacherControls.classList.remove('hidden');

  playButton.textContent = '▶ Play';
  playButton.classList.remove('hidden');
  nextButton.classList.add('hidden');

  renderQuestion();
  hideCountdown();
  reportModal.classList.add('hidden');

  initializeGame(currentQuestionIndex);
}

menuButton.addEventListener('click', () => {
  if (isTeacher) {
    return;
  }

  adminPanel.classList.toggle('hidden');

  if (!adminPanel.classList.contains('hidden')) {
    passwordInput.focus();
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const password = passwordInput.value.trim();

  if (!password) {
    passwordInput.focus();
    return;
  }

  try {
    await loginTeacher(password);

    passwordInput.value = '';
    enterTeacherMode();
  } catch {
    passwordInput.value = '';
    passwordInput.focus();
  }
});

playButton.addEventListener('click', async () => {
  if (!isTeacher || currentSession?.status === 'countdown') {
    return;
  }

  clearAnswerResults();

  reportModal.classList.add('hidden');

  playButton.textContent = '↻ Replay';

  await resetAllPlayers(playersSnapshot);

  startGame(currentQuestionIndex);
});

resetButton.addEventListener('click', async () => {
  if (!isTeacher) {
    return;
  }

  if (countdownInterval !== null) {
    window.clearInterval(countdownInterval);
    countdownInterval = null;
  }

  keys.clear();
  isFrozen = false;
  currentSession = null;
  currentQuestionIndex = 0;

  renderQuestion();
  hideCountdown();
  reportModal.classList.add('hidden');

  playButton.textContent = '▶ Play';

  await resetGame();

  unfreezePlayers();

  playButton.classList.remove('hidden');
  nextButton.classList.add('hidden');
});

nextButton.addEventListener('click', async () => {
  if (!isTeacher) {
    return;
  }

  if (currentQuestionIndex >= questions.length - 1) {
    return;
  }

  currentQuestionIndex += 1;

  renderQuestion();
  clearAnswerResults();
  unfreezePlayers();
  hideCountdown();
  reportModal.classList.add('hidden');

  playButton.textContent = '▶ Play';
  playButton.classList.remove('hidden');
  nextButton.classList.add('hidden');

  await resetAllPlayers(playersSnapshot);

  startNextQuestion();
});

async function startNextQuestion(): Promise<void> {
  nextButton.classList.add('hidden');
  playButton.classList.remove('hidden');

  nextQuestion(currentQuestionIndex);
}

closeReportButton.addEventListener('click', () => {
  reportModal.classList.add('hidden');
});

window.addEventListener('keydown', (event) => {
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();

    if (!isTeacher && !isFrozen) {
      keys.add(event.key);
    }
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key.startsWith('Arrow')) {
    keys.delete(event.key);
  }
});

window.addEventListener('resize', () => {
  if (isTeacher) {
    return;
  }

  const normalizedPosition = normalizePosition(
    player.x,
    player.y,
  );

  const newPosition = denormalizePosition(
    normalizedPosition.x,
    normalizedPosition.y,
  );

  player.x = newPosition.x;
  player.y = newPosition.y;

  player.element.style.transform =
    `translate(${player.x}px, ${player.y}px)`;

  remotePlayers.forEach((state, remotePlayerId) => {
    const remotePlayer = playersSnapshot[remotePlayerId];

    if (!remotePlayer) {
      return;
    }

    const position = denormalizePosition(
      remotePlayer.x,
      remotePlayer.y,
    );

    state.currentX = position.x;
    state.currentY = position.y;
    state.startX = position.x;
    state.startY = position.y;
    state.targetX = position.x;
    state.targetY = position.y;
    state.interpolationStart = performance.now();
  });

  updateSelectedAnswer();
});

window.addEventListener('beforeunload', () => {
  if (!isTeacher) {
    removePlayer();
  }
});

renderQuestion();

createPlayer(
  0,
  0,
  player.shape,
  randomColor,
);

listenToPlayers(updateRemotePlayers);

listenToGame((session) => {
  currentSession = session;

  if (!session) {
    if (!isTeacher) {
      if (countdownInterval !== null) {
        window.clearInterval(countdownInterval);
        countdownInterval = null;
      }

      currentQuestionIndex = 0;
      isFrozen = false;
      keys.clear();

      renderQuestion();
      hideCountdown();
      reportModal.classList.add('hidden');

      resetLocalPlayer();
      unfreezePlayers();
    }

    return;
  }

  if (
    session.questionIndex !== currentQuestionIndex &&
    questions[session.questionIndex]
  ) {
    currentQuestionIndex = session.questionIndex;

    if (isTeacher) {
      playButton.textContent = '▶ Play';
    }

    renderQuestion();
  }

  if (session.status === 'countdown') {
    clearAnswerResults();
    resetLocalPlayer();
    startCountdown(session);
    return;
  }

  if (session.status === 'finished') {
    freezePlayers();
    hideCountdown();

    if (isTeacher) {
      showReport();
      playButton.textContent = '↻ Replay';
    }

    return;
  }

  if (session.status === 'waiting') {
    unfreezePlayers();
    hideCountdown();

    if (!isTeacher) {
      resetLocalPlayer();
    }

    if (isTeacher) {
      playButton.classList.remove('hidden');
      nextButton.classList.add('hidden');
    }
  }
});

requestAnimationFrame(updatePlayerPosition);
requestAnimationFrame(syncPlayerPosition);
requestAnimationFrame(updateRemotePlayerPositions);