import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCermoz0AUv5v8DUyjadlejKLqzgk2ODmI",
  authDomain: "jogo-fortquiz.firebaseapp.com",
  databaseURL: "https://jogo-fortquiz-default-rtdb.firebaseio.com",
  projectId: "jogo-fortquiz",
  storageBucket: "jogo-fortquiz.firebasestorage.app",
  messagingSenderId: "471345417842",
  appId: "1:471345417842:web:7d001edfb9b7b327effceb"
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);