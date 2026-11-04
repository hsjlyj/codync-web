# Host Integration Checklist — Channel Call Examples

Channel frame envelope: `{"id":"<uuid>","m":"<method>","b":<body>}`

## Bot Management

### createBot
Request body: BotDraft (name, description, backend, cwd, permission, model, mode, avatarColor, avatarShape, ...)
Response: `{"bot": Bot}`

Example:
```json
{"id":"...","m":"createBot","b":{"name":"My Bot","backend":"claude","permission":"ask"}}
```

### updateBot
Request body: BotDraft with `id`
Response: `{"bot": Bot}`

### deleteBot
Request body: `{"botId":"<id>"}`
Response: `{}`

### reorderBots
Request body: `{"ids":["<id1>","<id2>"]}` — top first
Response: `{}`

### renameSection
Request body: `{"from":"Work","to":"Personal"}` or `{"from":"Work","to":null}`
Response: `{}`

## Roster / State

### usage
Request: `{"refresh":false}`
Response: Usage structure with providers/windows

### backends / refreshBackends
Host provides backend list; method name as per host API.

## File System

### listDirs
Request: `{"path":"<path>"}`
Response: directory listing

### upload / readUpload
Channel methods for chunked uploads: `upload` with `uploadId`, `name`, `data` base64, `offset`, `done`; `readUpload` for download chunks.

## Artifacts

### library
Request: `{"botId":"<id>"}`
Response: artifact list

### readArtifact / renameArtifact
Methods for artifact operations.

## Notes

- `setBotPosition` / `setBotSection` do not exist; use `reorderBots` and `updateBot.section`.
- Message `search` does not exist on host; Phase 2 search is client-side filtering.
