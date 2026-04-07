# WARICA - 割り勘アプリ

全員がリアルタイムで同じデータを共有できる割り勘アプリです。

---

## 🚀 セットアップ手順

### ① Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名（例：warica）を入力して作成

### ② Firestore データベースの有効化

1. 左メニューの「Firestore Database」をクリック
2. 「データベースを作成」をクリック
3. **「テストモードで開始」** を選択（開発中はこれでOK）
4. ロケーションは `asia-northeast1`（東京）を推奨

### ③ Firebase設定の取得

1. プロジェクトの設定（歯車アイコン）→「プロジェクトの設定」
2. 「マイアプリ」セクションで `</>` をクリックしてウェブアプリを追加
3. 表示された `firebaseConfig` の値をコピー

### ④ 設定ファイルを書き換える

`src/firebase.js` を開いて、`firebaseConfig` の各値を書き換えてください：

```js
const firebaseConfig = {
  apiKey:            "AIza...",           // ← コピーした値
  authDomain:        "your-app.firebaseapp.com",
  projectId:         "your-app",
  storageBucket:     "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...",
};
```

### ⑤ ローカルで動かす

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開いて確認してください。

---

## 🌐 Vercelへのデプロイ（無料）

### 方法A：GitHub経由（推奨）

1. このフォルダをGitHubにpush
2. [Vercel](https://vercel.com/) にGitHubでログイン
3. 「New Project」→ リポジトリを選択 → 「Deploy」
4. 数分で `https://xxx.vercel.app` のURLが発行されます ✅

### 方法B：Vercel CLIで直接デプロイ

```bash
npm install -g vercel
vercel
```

---

## 🔒 本番運用前のセキュリティ設定（推奨）

Firestore のセキュリティルールを設定してください。
Firebase Console → Firestore → ルール：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /groups/{groupId} {
      allow read, write: if true; // 認証なしで全員アクセス可
    }
  }
}
```

---

## 📁 ファイル構成

```
warica/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx       # エントリポイント
    ├── App.jsx        # メインアプリ
    └── firebase.js    # Firebase設定（← ここを書き換える）
```
