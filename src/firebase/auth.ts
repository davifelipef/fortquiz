import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

import './config';

const auth = getAuth();

const PROFESSOR_EMAIL = 'professor@local.fortquizz';

export async function loginTeacher(password: string): Promise<void> {
  const credential = await signInWithEmailAndPassword(
    auth,
    PROFESSOR_EMAIL,
    password,
  );

  if (credential.user.email !== PROFESSOR_EMAIL) {
    await signOut(auth);
    throw new Error('Usuário não autorizado.');
  }
}

export function listenToAuth(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function logoutTeacher(): Promise<void> {
  await signOut(auth);
}