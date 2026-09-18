import {
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
} from 'firebase/database';
import { database } from './config';

export type GameStatus = 'waiting' | 'countdown' | 'finished';

export interface GameSession {
  questionIndex: number;
  status: GameStatus;
  startedAt: number | null;
  finishedAt: number | null;
}

interface FirebaseGameSession {
  questionIndex?: unknown;
  status?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
}

const sessionRef = ref(database, 'game/session');

export function startGame(questionIndex: number): void {
  set(sessionRef, {
    questionIndex,
    status: 'countdown',
    startedAt: serverTimestamp(),
    finishedAt: null,
  });
}

export function finishGame(questionIndex: number): void {
  set(sessionRef, {
    questionIndex,
    status: 'finished',
    startedAt: null,
    finishedAt: serverTimestamp(),
  });
}

export function nextQuestion(questionIndex: number): void {
  set(sessionRef, {
    questionIndex,
    status: 'waiting',
    startedAt: null,
    finishedAt: null,
  });
}

export function initializeGame(questionIndex: number): void {
  set(sessionRef, {
    questionIndex,
    status: 'waiting',
    startedAt: null,
    finishedAt: null,
  });
}

export function resetGame(): Promise<void> {
  return remove(sessionRef);
}

export function listenToGame(
  callback: (session: GameSession | null) => void,
): void {
  onValue(sessionRef, (snapshot) => {
    const data = snapshot.val() as FirebaseGameSession | null;

    if (!data) {
      callback(null);
      return;
    }

    if (
      typeof data.questionIndex !== 'number' ||
      (data.status !== 'waiting' &&
        data.status !== 'countdown' &&
        data.status !== 'finished')
    ) {
      callback(null);
      return;
    }

    callback({
      questionIndex: data.questionIndex,
      status: data.status,
      startedAt:
        typeof data.startedAt === 'number' ? data.startedAt : null,
      finishedAt:
        typeof data.finishedAt === 'number' ? data.finishedAt : null,
    });
  });
}