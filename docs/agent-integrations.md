# AIエージェント連携の接続と確認

物欲王の公開MCP URLは `https://butsuyokuoh.exe.xyz/api/mcp`。HTTPの応答、AIへの登録、OAuthの許可、実際のツール実行は別々に確認する。検証結果と確認日は [互換性確認表のIssue #352](https://github.com/maishu-kobo/butuyokuoh/issues/352)、全体の進捗は [#349](https://github.com/maishu-kobo/butuyokuoh/issues/349) に記録する。

## 公開設定を先に確認する

```bash
node scripts/check-mcp-public.mjs https://butsuyokuoh.exe.xyz
```

クライアントに登録したURLは `--client-url` に追加して照合する。サーバーの公開設定が正しくても、既存クライアントに旧URLが残ることがある。設定ファイル全体や認証情報を共有せず、対象のURLだけを比較する。詳しくは [デプロイ手順のMCP公開URL](./deployment.md#mcp-の公開url) を参照。

## クライアントごとの入口

| 対象 | 接続方法と確認点 | 公式資料 |
| --- | --- | --- |
| Claude.ai | カスタムコネクタに公開URLを登録し、物欲王で権限を確認して接続する。 | [カスタムコネクタ](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) |
| Claude Code | Claude.ai由来のコネクタと、CLIで手動登録したサーバーを区別する。`/mcp`で実際に使っている登録元と接続状態を確認する。 | [Claude Code MCP](https://code.claude.com/docs/en/mcp) |
| Codex | Streamable HTTPのサーバーとして登録し、OAuthでログインする。CLI・アプリの設定と、既に起動した会話の接続状態を区別する。 | [OpenAI Docs: MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| GrokBot | BotにMCPサーバーのURLによる追加を依頼し、ConnectカードのAuthorize/Authenticateから提供元への認証を完了する。インストール済み表示だけでは認証成功を意味しない。 | [Grok Botのアプリ接続](https://docs.x.ai/grok-bot/computer-and-apps) |
| Muse | Connector Platformの手順に沿って、エンドポイント・認証・権限・ツール説明・専用テストアカウントを準備する。提出・審査・承認を実接続と区別する。 | [Muse Connector guidelines](https://platform.muse.ai/docs) |

公式の接続方法があることは、物欲王との実接続の証明ではない。アプリの版、契約・組織設定、登録方法によって差が出るため、未実施は確認表に「未確認」と書く。

### Claude Codeの手動登録

```bash
claude mcp add --transport http butuyokuoh https://butsuyokuoh.exe.xyz/api/mcp --scope user
claude mcp login butuyokuoh
```

既に同名の手動登録がある場合は、そのURLとscopeを先に確認する。旧URLを直す場合は対象エントリの控えを取り、`claude mcp remove butuyokuoh --scope user` の後に上の登録を行う。他のサーバー設定は変更しない。権限の同意後、`/mcp`で再接続するか新しいセッションを開き、ツールを実行する。

Claude.aiのコネクタがClaude Codeにも届く構成では、手動登録との重複に注意する。同じURLの手動登録が優先される場合がある。Claude.aiで接続できたという結果だけで、別の手動登録も動作していると判断しない。

### Codexの読み取り専用接続

```bash
codex mcp add butuyokuoh --url https://butsuyokuoh.exe.xyz/api/mcp
codex mcp login butuyokuoh --scopes read
```

既存登録のURLを直す際は、`scopes`、`enabled_tools`、`disabled_tools`などの利用者の制限を保持する。新規追加がそのまま認証を開始し、read以外の権限を要求した場合は同意せず、次の `login --scopes read` からやり直す。トークンの保存先や内容をログ・Issueへ貼らない。

### URL不一致のエラー

`Protected resource ... does not match expected ...` や `INVALID_RESOURCE` は、登録URLとサーバーが宣言したresource、または既存トークンの宛先が一致していない場合に起こる。スキーム・ホスト・ポート・パスを照合する。`https://butsuyokuoh.exe.xyz:8000/api/mcp` が残っていたら公開URLへ直し、通常のOAuthで再接続する。認証の宛先チェックは無効にしない。

## 同じ手順で互換性を確認する

1. 確認表にクライアント名・版・登録元・URL・認証方式・scope・確認日を記入する。Claude.aiとClaude Codeは別行にする。
2. 新しい接続で認可画面まで進み、対象アカウントと権限を確認して同意する。物欲王に未ログインから試したか、既存ログインを使ったかも記録する。
3. 新しい会話で読み取りツールを1回実行する。例えば「物欲王の比較グループ一覧を取得し、件数だけ返してください。変更はしないでください」。利用可能なツールが制限されている場合は `list_categories` などの読み取りを使い、何を実行したか記録する。
4. ツール名、成功・失敗、件数を確認する。AIの文章だけでなく、実際のツール呼び出し結果を確認する。実データの名前や画像、認証コードは公開の記録へ載せない。
5. 専用テストアカウントで、拒否・read権限での書き込み拒否・トークン更新・再接続を確認する。実施していない項目は成功に含めない。書き込み確認は許可されたテスト環境だけで行う。

CIでの未ログインからの確認は [MCPのブラウザE2E](./ci.md#mcpのログインから一覧取得まで) を使う。メール・パスワード認証による共通サーバー経路のテストであり、Googleログインや実AIクライアントの自動認証・更新を検証したものではない。

## 確認表の記録項目

検証結果はIssue/PRに記載し、この使い方のページへ実データを保存しない。

| 項目 | 記載する内容 |
| --- | --- |
| 対象 | AI名、CLI/ブラウザ/アプリ、版、確認日、アプリの配備SHA |
| 登録 | 登録元、公開URL、認証方式、scope。秘密は記載しない |
| 新規接続 | 物欲王へのログイン状態、同意画面、認可成功の有無 |
| 読み取り | 実行ツール、結果件数、エラーの有無、証拠のあるIssue/PR |
| 書き込み制御 | 同意拒否、read権限での拒否、確認を実施した環境 |
| 継続利用 | refresh、再接続、クライアント再起動後の読み取りを別々に記録 |
| 判定 | 確認済み / 失敗 / 未確認、残る作業と担当Issue |

認証・公開URL・MCP実装・ツールschemaを変えるPRでは共通テストを通し、統合後は公開検査と影響する実クライアントの読み取りを再確認する。新しいAIを対応済みと案内する前にも同じ確認を行う。定期実行や本番への自動接続は、別途運用方法を決めて設定する。
