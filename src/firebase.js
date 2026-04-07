// src/firebase.js
// ① Firebaseコンソール(https://console.firebase.google.com)でプロジェクト作成後、
//    「プロジェクトの設定 > マイアプリ > ウェブアプリを追加」で取得した値に書き換えてください。

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyBf4OOsweC2VVYXfiiw57pT0Hh7ZNxvaH0",
  authDomain:        "warica-app-306b8.firebaseapp.com",
  projectId:         "warica-app-306b8",
  storageBucket:     "warica-app-306b8.firebasestorage.app",
  messagingSenderId: "343895440521",
  appId:             "1:343895440521:web:84531275e8eb0ce2c85a58",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
