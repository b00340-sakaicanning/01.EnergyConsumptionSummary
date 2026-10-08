# GEMINI.md - エネルギー使用量集計システム プロジェクト設定

同じ内容を `CLAUDE.md`（Claude Code 向け）にも持っているため、どちらかを直すときはもう一方も揃えること。技術スタック、アーキテクチャ方針、重要な制約、現在の状態と既知の課題は `CLAUDE.md` に記載している。

## 言語
- ユーザーとのやり取りはすべて日本語で行う
- コメント・コミットメッセージ・ドキュメントも日本語を基本とする

## フォルダ構成(追加)
```
エネルギー使用量集計/
├── GEMINI.md                            # プロジェクト指針・設定 (Gemini 向け)
├── CLAUDE.md                            # プロジェクト指針・設定 (Claude Code 向け。内容は GEMINI.md と揃える)
├── plan/                                # 詳細実装計画ドキュメント
│   ├── 00_実装計画書(要件定義).md       # 実装計画段階の要件定義
│   └── 00_実装計画書(構築手順).md       # 実装計画段階の構築手順（タスク分解）
├── docs/                                # 設計・仕様ドキュメント（実装段階で順次追加）
│   ├── 01_要件定義書.md
│   ├── 02_システム設計.md
│   ├── 03_データ設計.md
│   ├── 04_実装仕様.md
│   └── 05_セットアップ手順.md
├── prompt/                              # 指示・プロンプトファイル
│   ├── 00.アプリ要件定義&構築手順作成用プロンプト.txt
│   ├── 01.アプリ作成初回用プロンプト.md
│   ├── 修正依頼.txt                     # 修正依頼の累積ログ
│   └── 修正依頼(Claude).txt             # Claude向けの修正依頼
├── reference/                           # 入力データ・正解リファレンス (git管理外)
│   ├── 読込用データ/                    # アプリへ投入する実データ
│   │   ├── CSVデータ/{年度}/{YYYYMM}/   # 日別ロガーファイル (AQyyyymmdd_00N.TXT)
│   │   ├── かつらぎ工場エネルギー計算表_読込用.xlsx
│   │   └── 月報PET_読込用.xlsx
│   └── 参考用データ/                    # 突合用のExcel原紙・過去データ
│       ├── 00.プロセスデータ/
│       ├── 2024年度3月度/
│       └── 月別電力使用量集約(31日版原紙).xlsx 等
├── tests/                               # 数値突合・検証スクリプト
│   ├── extract_reference_truth.py       # Excel原紙から正解データ (truth_202503.json) を抽出
│   ├── truth_202503.json                # 2025年3月度の正解データ
│   ├── test_etl_runner.js               # 実データでETLを実行し test_output_202503.json を出力
│   ├── test_output_202503.json          # 上記の出力
│   ├── verify_output.py                 # 出力と正解データの数値突合
│   ├── verify_variety_fixes.js          # 品種マスター・操業モード分離の検証
│   ├── verify_variety_and_restore.js    # 復元データからの年間集約の検証
│   ├── verify_config_sync.js            # Config.gs と js/config.js の二重定義の一致検証
│   └── verify_excel_reader.js           # 月報PET・エネルギー計算表の解析の検証 (模擬シートを使用)
├── screenshot/                          # 画面確認時のスクリーンショット
│   └── YYYYMMDDhhmm_変更内容/           # 作業ごとのフォルダ (history/ の履歴ファイルと同じ名前)
├── gas_app/                             # アプリケーション本体
│   ├── Code.gs                          # GASバックエンド (doGet / 保存・復元・エクスポート用データ取得)
│   ├── Config.gs                        # 設定値・マスター定義
│   ├── build.js                         # 自己完結型 index.html 生成スクリプト
│   ├── index.html                       # SPAフロントエンド本番成果物 (CSS/JSインライン統合)
│   ├── index.template.html              # フロントエンドHTMLテンプレート
│   ├── css/
│   │   └── style.css                    # スタイリング (ライトテーマ)
│   ├── js/
│   │   ├── app.js                       # アプリケーション起点・UI制御
│   │   ├── config.js                    # 列定義・工程マッピング・共通定数 (品種キー、年度の月並び等)
│   │   ├── etl/
│   │   │   ├── csvParser.js             # CSVパース・電力列動的抽出・外れ値補正
│   │   │   ├── hourlyAggregator.js      # 2段階欠損補正・1時間平均化
│   │   │   └── excelReader.js           # 外部Excel解析 (月報PET / 計算表)
│   │   ├── services/
│   │   │   ├── categoryService.js       # 工程別小計・集約
│   │   │   ├── kpiService.js            # 原単位・コスト算出
│   │   │   └── annualService.js         # 品種別・設備別年間集約
│   │   └── components/
│   │       └── charts.js                # グラフ描画 (Chart.js)・目盛り上限の算出
│   └── demo/                            # ローカル開発時 (localhost) のみ読み込むデモ用JSONデータ
│       ├── demo_annual_2024.json        # 2024年度年間デモデータ
│       ├── demo_annual_2025.json        # 2025年度年間デモデータ
│       └── demo_data_202503.json        # 2025年3月度単月デモデータ
└── history/                             # 作業履歴 (YYYYMMDDhhmm_変更内容.md)
```

GASへデプロイするのは `Code.gs`、`Config.gs`、`index.html` の3ファイルのみ。`css/`、`js/`、`index.template.html` を変更したら `node gas_app/build.js` で `index.html` を再生成する。

## ドキュメント(追加)
| ファイル | 用途 |
|---|---|
| plan/00_実装計画書(要件定義).md | 実装計画段階の確定要件定義 |
| plan/00_実装計画書(構築手順).md | 実装計画段階の詳細構築手順（全12タスク分解） |
| docs/01_要件定義書.md | 正式機能要件・非機能要件仕様 |
| docs/02_システム設計.md | アーキテクチャ・画面構成・処理フロー・GASとの通信仕様 |
| docs/03_データ設計.md | スプレッドシートのシート・カラム定義、カテゴリ・品種の定義、入力ファイルの仕様 |
| docs/04_実装仕様.md | 計算ロジック（集約・欠損補正・KPI・目盛り上限）、各モジュールの関数仕様 |
| docs/05_セットアップ手順.md | GASへの配置・デプロイ、ローカルでの動作確認、テストの実行、日常の運用手順 |

`plan/` は実装前の計画であり、現行の仕様は `docs/` を正とする。

## 開発規約
- 変数名はキャメルケース（例: `getUserName`, `hourlyDataList`）
- 変更前の確認:
  - コードを変更する前に変更内容と理由を簡潔にユーザーへ説明し、確認を得てから実行すること
  - ユーザーから「修正作業OK」の回答であっても、文末や内容に「確認お願いします」等が含まれている場合は、コード修正を即時実施しないこと。質問や確認事項・前提条件のすり合わせが含まれているため、まずはその質問・確認事項に回答し、改めて実施してよいかの確認（GOサイン）を得てから修正を行うこと
- 履歴と完了報告: 修正・実装を実行した場合は、`history/` 配下に `YYYYMMDDhhmm_変更内容.md` を作成すること
- 安全な削除: ファイル・フォルダの削除が必要な場合は即時削除せずゴミ箱へ移動させること
- 再ビルド: `gas_app/css/`、`gas_app/js/`、`gas_app/index.template.html` を変更したら、`node gas_app/build.js` で `gas_app/index.html` を再生成し、ローカル（`cd gas_app && python3 -m http.server 8000` → `http://localhost:8000/index.html`）で画面を確認すること。`index.html` は生成物なので直接編集しない
- 設定の二重定義: `gas_app/Config.gs` と `gas_app/js/config.js` には同じマスター定義（品種キー、品種合算マッピング、カテゴリ、設備90列、目盛り設定）がある。片方を変えたらもう一方も同じ内容に揃え、`node tests/verify_config_sync.js` で一致を確認すること
- テスト: 集計ロジック（`js/etl/`、`js/services/`、`js/config.js`）や `Config.gs` を変更したら、次を実行すること
  - `node tests/test_etl_runner.js` → `python3 tests/verify_output.py tests/test_output_202503.json`（`reference/` の実データが必要）
  - `node tests/verify_variety_fixes.js`、`node tests/verify_variety_and_restore.js`、`node tests/verify_config_sync.js`、`node tests/verify_excel_reader.js`
- スクリーンショット:
  - 画面確認用のスクリーンショットや HTML は、作業中は `screenshot/` の直下に採取すること
  - 検証が終わり完了報告をする前に、`screenshot/YYYYMMDDhhmm_変更内容/`（その作業の `history/` ファイルと同じ名前）を作成して移動すること
  - `history/` には、移動後のフォルダを含めたパスを記載すること
  - `screenshot/` の直下には、確認途中のファイル以外を残さないこと
- テンプレートの目印: `index.template.html` の `<!-- CSSスタイル -->` と `<!-- スクリプト読み込み` で始まるコメントはビルドの置換開始位置の目印のため消さないこと。その目印から `</head>`・`</body>` までの間に、`</head>`・`</body>` という文字列を書かないこと
- JSファイルの追加: `gas_app/build.js` の `jsFiles` と、`index.template.html` 末尾のローカル用ローダーの一覧の両方に、依存順で追加すること

