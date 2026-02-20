const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Anthropic = require("@anthropic-ai/sdk").default;

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// ============================================================
// 研修ワークシートのフィールド定義（フロントエンドと同期）
// ============================================================
const FIELD_META = {
  overview: [
    { id: "ws_team", label: "チーム・プロジェクト名" },
    { id: "ws_members", label: "メンバー構成" },
    { id: "ws_goal", label: "GitHub導入の目的" },
  ],
  git_basics: [
    { id: "ws_repo_structure", label: "リポジトリ構成" },
    { id: "ws_branch_strategy", label: "ブランチ戦略" },
    { id: "ws_commit_rules", label: "コミットルール" },
  ],
  team_dev: [
    { id: "ws_pr_flow", label: "Pull Requestのルール" },
    { id: "ws_review_policy", label: "コードレビュー方針" },
    { id: "ws_issue_management", label: "Issue管理" },
    { id: "ws_conflict_policy", label: "コンフリクト対応方針" },
  ],
  repo_mgmt: [
    { id: "ws_branch_protection", label: "ブランチ保護ルール" },
    { id: "ws_gitignore", label: ".gitignore設計" },
    { id: "ws_lfs", label: "Git LFS対象ファイル" },
    { id: "ws_ci_cd", label: "CI/CD・自動化" },
  ],
};

const SECTION_LABELS = {
  overview: "概要",
  git_basics: "Git基礎設計",
  team_dev: "チーム開発ルール",
  repo_mgmt: "リポジトリ管理",
};

const ANSWER_EXAMPLE = {
  ws_team: "商材開発チーム（研修スライド管理プロジェクト）",
  ws_members:
    "6名（Git経験者1名、GitHub初心者5名）\nリーダー: 杉田\nメンバー: たから、さくもと、なかべっぷ、他2名",
  ws_goal:
    "【現状の課題】\n・研修スライド（PPTX）をローカルやGoogle Driveでバラバラに管理\n・誰がいつ何を変更したか追跡できない\n・同じファイルを複数人が編集して上書き事故が発生\n\n【導入目的】\n・変更履歴の可視化と追跡\n・チームでの同時編集を安全に行う\n・レビュープロセスの導入による品質向上",
  ws_repo_structure:
    "モノレポ構成（1リポジトリ）\nリポジトリ名: training-slide-generator\n\n構成:\n・courses/ — 研修コースごとのスライド・資料\n・docs/ — 議事録・設計ドキュメント\n・.github/workflows/ — CI/CD設定",
  ws_branch_strategy:
    "GitHub Flow ベース:\n・main: 本番（リリース済み資料）\n・dev: 開発統合ブランチ\n・feature/*: 機能開発・コンテンツ追加\n・docs/*: ドキュメント・議事録\n\ndevで統合テスト → mainにマージで本番反映",
  ws_commit_rules:
    "プレフィックス:\n・feat: 新規コンテンツ追加\n・fix: 誤字修正・内容修正\n・docs: 議事録・ドキュメント\n・refactor: 構成変更\n\n形式: feat: 第3章スライドを追加\n粒度: 1トピック1コミットを目安",
  ws_pr_flow:
    "・feature/* → dev へのPRを作成\n・PRテンプレートを使用（変更内容・確認事項を記載）\n・最低1名のレビュー承認が必要\n・マージ後、featureブランチは削除",
  ws_review_policy:
    "観点:\n・内容の正確性（研修資料として適切か）\n・ファイル構成の整合性\n・コミットメッセージの適切さ\n\n担当: チームメンバーの持ち回り\n期限: PR作成から24時間以内にレビュー開始",
  ws_issue_management:
    "ラベル:\n・content: コンテンツ関連\n・bug: 誤字・不具合\n・enhancement: 改善提案\n・question: 質問・相談\n\nProjectボード: カンバン形式（Todo / In Progress / Review / Done）\nテンプレート: コンテンツ追加・バグ報告",
  ws_conflict_policy:
    "・feature作成者がコンフリクト解消の責任を持つ\n・バイナリファイル（PPTX）は事前に担当を分けて競合を予防\n・不明な場合はチームリーダーに相談\n・定期的にdevからpullして差分を小さく保つ",
  ws_branch_protection:
    "main:\n・直接push禁止\n・PR必須（devからのみ）\n・レビュー1名以上の承認必須\n・branch-guard CIチェック必須\n\ndev:\n・直接push禁止\n・PR必須\n・レビュー1名以上の承認必須",
  ws_gitignore:
    "・.env（環境変数・秘密情報）\n・node_modules/（依存パッケージ）\n・.DS_Store（macOSシステムファイル）\n・*.log（ログファイル）\n・~$*.pptx（PowerPoint一時ファイル）",
  ws_lfs:
    "Git LFS対象:\n・*.pptx（PowerPointスライド）\n・*.pdf（配布資料）\n・*.xlsx（ワークシート）\n・*.zip（アーカイブ）\n\n理由: バイナリファイルはGit通常管理だと差分が肥大化するため",
  ws_ci_cd:
    "・Branch Guard: mainへのPRはdevからのみ許可（branch-guard.yml）\n・将来的に: スライドPDF自動生成、リンク切れチェック\n・Dependabot: 依存パッケージの脆弱性通知",
};

// ============================================================
// プロンプト定義
// ============================================================
const SYSTEM_PROMPT_SECTION = `あなたはGitHub研修の講師アシスタントです。受講者がワークシートに記入したGitHub運用設計の回答に対して、建設的なフィードバックを日本語で提供してください。

## フィードバックの方針
- 受講者を励ましながら、具体的な改善点を指摘する
- 良い点を最初に挙げてから、改善点を提案する
- 研修で学んだ内容（Git基礎、ブランチ戦略、PR、コードレビュー、Issue管理など）に関連づけてフィードバックする
- 回答が空欄の場合は記入を促す
- 回答例はあくまで参考であり、受講者のチーム状況に応じた回答も正解であることを考慮する

## 回答フォーマット
各フィールドについて1-3文で簡潔にフィードバックし、セクション全体の総評を最後に1-2文で記載してください。
フィールド名は【】で囲んでください。`;

const SYSTEM_PROMPT_OVERALL = `あなたはGitHub研修の講師アシスタントです。受講者がワークシート全体（4セクション・14項目）に記入したGitHub運用設計の回答に対して、総合的なフィードバックを日本語で提供してください。

## フィードバックの方針
- まず全体の完成度と充実度を評価する
- 各セクション（概要、Git基礎設計、チーム開発ルール、リポジトリ管理）ごとに1-2文で評価する
- セクション間の一貫性を確認する（例：ブランチ戦略とPRルールが整合しているか）
- 実際の運用で特に注意すべきポイントを2-3点挙げる
- 全体を通しての改善アドバイスを記載する
- 受講者を励まし、次のステップ（実際にリポジトリを作って運用を開始するなど）を提案する

## 回答フォーマット
以下の構成でフィードバックを記載してください：
1. 全体評価（2-3文）
2. セクション別評価（各1-2文）
3. 一貫性チェック（2-3文）
4. 改善アドバイス（2-3点）
5. 次のステップ（1-2文）`;

// ============================================================
// ユーティリティ
// ============================================================
function sanitizeInput(text) {
  if (typeof text !== "string") return "";
  return text.substring(0, 2000);
}

function sanitizeAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  const clean = {};
  for (const key of Object.keys(answers)) {
    if (key.startsWith("ws_")) {
      clean[key] = sanitizeInput(answers[key]);
    }
  }
  return clean;
}

// レート制限（インメモリ）
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimiter.get(userId) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (entry.timestamps.length >= RATE_LIMIT_MAX) {
    throw new HttpsError(
      "resource-exhausted",
      "リクエスト制限を超えました。1分後に再試行してください。"
    );
  }
  entry.timestamps.push(now);
  rateLimiter.set(userId, entry);
}

function buildSectionPrompt(section, fields, answers) {
  let prompt = `## セクション: ${SECTION_LABELS[section]}\n\n`;
  prompt += `### 受講者の回答:\n`;
  for (const f of fields) {
    const answer = answers[f.id] || "(未記入)";
    prompt += `【${f.label}】\n${answer}\n\n`;
  }
  prompt += `### 参考回答例:\n`;
  for (const f of fields) {
    prompt += `【${f.label}】\n${ANSWER_EXAMPLE[f.id]}\n\n`;
  }
  prompt += `上記の受講者の回答を参考回答例と比較し、フィードバックを提供してください。`;
  return prompt;
}

function buildOverallPrompt(answers) {
  let prompt = `## GitHub運用設計ワークシート全体\n\n`;
  for (const [section, fields] of Object.entries(FIELD_META)) {
    prompt += `### ${SECTION_LABELS[section]}\n`;
    prompt += `#### 受講者の回答:\n`;
    for (const f of fields) {
      const answer = answers[f.id] || "(未記入)";
      prompt += `【${f.label}】\n${answer}\n\n`;
    }
    prompt += `#### 参考回答例:\n`;
    for (const f of fields) {
      prompt += `【${f.label}】\n${ANSWER_EXAMPLE[f.id]}\n\n`;
    }
  }
  prompt += `上記のワークシート全体を評価し、総合フィードバックを提供してください。`;
  return prompt;
}

// ============================================================
// Cloud Functions
// ============================================================
exports.getSectionFeedback = onCall(
  {
    secrets: [anthropicApiKey],
    cors: [
      "https://kojisugita1226.github.io",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
    ],
    region: "asia-northeast1",
    timeoutSeconds: 60,
  },
  async (request) => {
    const { section, answers: rawAnswers, userId } = request.data;

    if (!section || !FIELD_META[section]) {
      throw new HttpsError("invalid-argument", "無効なセクションです");
    }

    const answers = sanitizeAnswers(rawAnswers);
    checkRateLimit(userId || "anonymous");

    const fields = FIELD_META[section];
    const filledCount = fields.filter(
      (f) => (answers[f.id] || "").trim()
    ).length;
    if (filledCount === 0) {
      throw new HttpsError(
        "failed-precondition",
        "このセクションにはまだ回答がありません。"
      );
    }

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });
    const prompt = buildSectionPrompt(section, fields, answers);

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      system: SYSTEM_PROMPT_SECTION,
      messages: [{ role: "user", content: prompt }],
    });

    return {
      feedback: response.content[0].text,
      section,
    };
  }
);

exports.getOverallFeedback = onCall(
  {
    secrets: [anthropicApiKey],
    cors: [
      "https://kojisugita1226.github.io",
      "http://localhost:5000",
      "http://127.0.0.1:5000",
    ],
    region: "asia-northeast1",
    timeoutSeconds: 90,
  },
  async (request) => {
    const { answers: rawAnswers, userId } = request.data;

    if (!rawAnswers) {
      throw new HttpsError("invalid-argument", "回答データがありません");
    }

    const answers = sanitizeAnswers(rawAnswers);
    checkRateLimit(userId || "anonymous");

    const allFields = Object.values(FIELD_META).flat();
    const filledCount = allFields.filter(
      (f) => (answers[f.id] || "").trim()
    ).length;
    if (filledCount < 3) {
      throw new HttpsError(
        "failed-precondition",
        `総合フィードバックには最低3つ以上の記入が必要です（現在${filledCount}/14）。`
      );
    }

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });
    const prompt = buildOverallPrompt(answers);

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2500,
      system: SYSTEM_PROMPT_OVERALL,
      messages: [{ role: "user", content: prompt }],
    });

    return {
      feedback: response.content[0].text,
    };
  }
);
