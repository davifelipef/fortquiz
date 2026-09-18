import {
  onDisconnect,
  onValue,
  ref,
  remove,
  set,
  update,
} from 'firebase/database';
import { database } from './config';

export type PlayerShape = 'circle' | 'square' | 'triangle';

export interface RemotePlayer {
  x: number;
  y: number;
  shape: PlayerShape;
  color: string;
}

interface FirebasePlayer {
  x?: unknown;
  y?: unknown;
  shape?: unknown;
  color?: unknown;
}

const playersRef = ref(database, 'game/players');

export const playerId = crypto.randomUUID();

export function createPlayer(
  x: number,
  y: number,
  shape: PlayerShape,
  color: string,
): void {
  const playerRef = ref(database, `game/players/${playerId}`);

  onDisconnect(playerRef).remove();

  set(playerRef, {
    x,
    y,
    shape,
    color,
  });
}

export function savePlayerPosition(x: number, y: number): void {
  const playerRef = ref(database, `game/players/${playerId}`);

  update(playerRef, {
    x,
    y,
  });
}

export function removePlayer(): void {
  const playerRef = ref(database, `game/players/${playerId}`);

  remove(playerRef);
}

export function resetAllPlayers(
  players: Record<string, RemotePlayer>,
): Promise<void> {
  const updates: Record<string, number> = {};

  Object.keys(players).forEach((remotePlayerId) => {
    updates[`${remotePlayerId}/x`] = 0;
    updates[`${remotePlayerId}/y`] = 0;
  });

  if (Object.keys(updates).length === 0) {
    return Promise.resolve();
  }

  return update(playersRef, updates);
}

export function listenToPlayers(
  callback: (players: Record<string, RemotePlayer>) => void,
): void {
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val() as Record<string, FirebasePlayer> | null;
    const validPlayers: Record<string, RemotePlayer> = {};

    if (!data) {
      callback(validPlayers);
      return;
    }

    Object.entries(data).forEach(([playerId, player]) => {
      if (
        typeof player.x !== 'number' ||
        typeof player.y !== 'number' ||
        typeof player.shape !== 'string' ||
        typeof player.color !== 'string'
      ) {
        return;
      }

      if (
        player.shape !== 'circle' &&
        player.shape !== 'square' &&
        player.shape !== 'triangle'
      ) {
        return;
      }

      validPlayers[playerId] = {
        x: player.x,
        y: player.y,
        shape: player.shape,
        color: player.color,
      };
    });

    callback(validPlayers);
  });
}