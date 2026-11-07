# UX ARENA

スマホ向け高速UI/UX A/B直感選択テスト。1問10秒、5試行バッチ。参加者にはテスト中の結果を表示しません。

## 入口

- `index.html`: 参加者用。テスト・自分の結果・マイデータのみ。管理画面や管理へのリンクは含みません。
- `admin.html`: 運営者用。テスト管理・分析・ライブラリ・入出力。プレビューで参加者の操作も確認できます。
- `assets/app.js` / `assets/app.css`: 共通ランナー・保存・分析ロジックとスタイル。管理用イベントと描画は管理入口でのみ初期化します。

この段階では入口と画面の責務を分離しています。分析・保存の完全なモジュール分割は未実施です。URL分離は認証・アクセス制御ではありません。管理ページの公開を制限する場合は別途認証が必要です。

## データ互換

同じオリジンの両入口は既存キー `ux_arena_v6` を共有します。回答・timeout・実験設定の形式は変更しません。端末間の自動同期はありません。参加者へ配るURLは `index.html` を使用してください。

## 検証

`npm install` → `npx playwright install chromium` → `npm run verify`。
JS構文、統計回帰、390×844 / 320×568の5試行・保存復旧・管理集計JSONを検証します。スクリーンショットは `test-results/` に保存します。

変更はPR・CIを通してmainへ統合します。

## 何を競う／試す場なのか

UX ARENA は、スマホUIの2案（A/B）を「どちらが直感的に操作できるか」で競わせ、感覚ではなく計測値で比べるための実験場です。

- 参加者はお題に対して、左右ランダムに配置された2つのバリアントから直感で1つを選びます。考え込まず普段どおりの速さで操作することが前提で、制限時間は1問10秒、1セッションは5試行です。
- 計測するのは正解・不正解だけではありません。結果画面では平均決定時間、有効選択率、平均誤操作、平均迷い時間、初動時間、中央値、反応傾向が表示されます（テスト中は参加者に結果を見せません）。
- 初回だけ、デジタルサービスの利用経験（初心者／ふつう／慣れている）を設定します。結果はこの端末（localStorage、キー `ux_arena_v6`）に保存され、「マイデータ」で参加回数や最近の回答を確認・削除できます。
- 運営者は `admin.html` の分析で、実験ごとに有効選択率や「10秒超過／無選択」の件数、識別できる参加者数を確認でき、選好が安定しているか（判定例：「暫定的に安定」「左右バイアス要確認」「選好反転を検出」）を判定します。分析結果はJSONでダウンロードできます。

つまり、単発の好み投票ではなく、制限時間つきの直感選択を繰り返して「どちらのUIが速く・迷わず使えるか」の収束を見にいく場です。

## Playwrightテストの回し方

前提：Node.js と npm。初回は依存関係とブラウザを取得します。

```bash
npm install
npx playwright install chromium
```

一括検証（JS構文チェック＋統計回帰＋E2E）は次の1コマンドです。これがCIと同じ入口です。

```bash
npm run verify
```

内訳（`package.json` の scripts）：

| コマンド | 内容 |
|---|---|
| `npm run check:js` | `scripts/check-js.mjs` によるJS構文チェック |
| `npm run test:statistics` | `tests/statistics/*.test.mjs` を `node --test` で実行（収束判定 `intuitionMetrics` の回帰。フィクスチャは `tests/fixtures/intuition.mjs`） |
| `npm run test:e2e` | Playwright のE2E（`tests/e2e/`） |

E2Eだけを回す場合は `npm run test:e2e` で足ります。設定は `playwright.config.ts`：

- テスト対象ディレクトリは `tests/e2e`（`smoke.spec.ts`：5試行の完走、`entrypoints.spec.ts`：参加者入口と管理入口の分離・保存復旧・タイムアウト、`convergence.spec.ts`：管理画面の収束表示とJSONダウンロード）
- `baseURL` は `http://127.0.0.1:4173` で、Webサーバー（`python3 -m http.server 4173`）はPlaywrightが自動起動します（CI以外では既存サーバーを再利用）
- プロジェクトは `mobile-chromium`（iPhone 13 デバイスプロファイル＋Chromium）。スペック内では 390×844 と 320×568 の2ビューポートで、スクロールなしに収まることまで検証します
- スクリーンショットは失敗時のみ自動保存（`screenshot: 'only-on-failure'`）。検証用スクリーンショットは `test-results/` に出力されます
