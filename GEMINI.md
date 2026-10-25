@./AGENTS.md

Gemini CLI の既定コンテキスト名は GEMINI.md です。ルールの正本は AGENTS.md で、このファイルは import だけです。`.gemini/settings.json` の `context.fileName` を AGENTS.md だけにすると、この import と二重に読まれることがあるので、設定ファイルは置いていません。
