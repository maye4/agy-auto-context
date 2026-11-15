# Antigravity: automatic full-selection context via a PreInvocation hook

Status: **v2, implemented 2026-10-22; live-tested 2026-10-22 (works).** Author: Ye Ma.

> **Names:** since 0.4.0 the project is **agy-auto-context** (extension `maye.agy-auto-context`, hook
> `hook/agy-auto-context.sh`, records in `~/.cache/agy-auto-context`, env vars `AGY_AUTO_CONTEXT_DIR` /
> `AGY_AUTO_CONTEXT_DEBUG`, view `agyAutoContext.view`). Before that it was the extension
> `maye.selection-export` plus the hook `antigravity-hooks/ide-selection.sh`; the history below keeps the old version numbers.

**Scope (v1 of the feature): WSL remote windows only.** That is: the VS Code UI runs on Windows but is
connected to WSL (Ubuntu 24.04); the Antigravity extension and its `agy` backend run in WSL, so the
record files, the hook and `~/.gemini` are all on the WSL side. **Local Windows windows** (not connected
to WSL) run the Windows Antigravity/agy with `%USERPROFILE%\.gemini` and are **out of scope**; nothing
is installed on Windows (`maye.agy-auto-context` is a workspace extension, so it only runs in the WSL
extension host anyway).

## Changelog v1 → v2 (review of 2026-10-22)

Accepted:
1. Hook rewritten from node (`.mjs`) to POSIX `sh` + `/usr/bin/jq`: ~13 ms vs ~100 ms per call, no
   dependency on which node is on PATH (`/usr/bin/node` v18 vs nvm v24). (Node's `process.exit()`
   truncation on pipes is real but moot now, and irrelevant for a ~150-byte payload.)
2. hooks.json is global and also loaded by agy CLI sessions → the hook skips CLI sessions
   (`artifactDirectoryPath` contains `/antigravity-cli/`) and subagents (`parentConversationId` set).
3. "Once per turn": first shipped as a per-conversation state file keyed on `executionId`; the live
   test showed the payload has no `executionId` (so it fell back to `invocationNum` and injected twice in
   one turn). Then: inject only when `invocationNum == 0`. **Regression found 12:03 (fixed 12:10):** agy
   shows an ephemeral message only to the model call it was injected for. In one live conversation the
   message was injected (step 1), the model called read_file L58-64 with it, but the next model call
   (invocationNum 1, after the tool result) no longer saw it and answered "only the cursor line was
   transmitted"; a turn without tool calls answered correctly. **Now:** at `invocationNum 0` compute the
   message and store it in `~/.cache/agy-auto-context/.turn-<conversationId>` (0600); at every later
   invocation of the turn re-inject that same stored message (the turn-start selection, even if the
   selection changes mid-turn); a new turn (`invocationNum 0`) recomputes; `.turn-*` older than 1 day are pruned.
4. No internal 300 ms budget (agy docs give none); the guard is `"timeout": 2` in hooks.json, and the
   script never reads with `timeout cat`. It always prints one JSON object (`{}` on any failure) and exits 0.
5. Record file named `<sessionId>-<pid>.json` (sessionId alone is not guaranteed unique per window);
   tmp file name contains the pid and does not end in `.json`; dir 0700, files 0600; liveness via `/proc/<pid>`.
6. `focused` is used for ordering (focused first, then newest `ts`), not as a filter — it may not be
   reliable in a remote extension host.
7. Scheme allowlist `file:` only (v1 also allowed `vscode-remote:`; in the WSL extension host real
   files are `file:`).
8. Injected message is self-describing (states its 1-based line base, that the user's message refers to
   those lines, and that `Cursor is on line` is only the cursor), partly because the chip's line base
   (insertSnippet passes the 0-based `start.line`) is unknown.
9. Absolute paths everywhere in hooks.json (the hook's cwd is not documented).

Rejected / not applicable:
- "Ship it as send-visible-selection 0.4.0" and its fixes (denylist→allowlist, stale `remember()`,
  focus-stealing `pickTarget`, empty `deactivate`): that extension is retired and uninstalled; v2 uses a
  new extension written from scratch with those properties built in.
- `build_vsix.py` XML-escaping, dead `viewColumn` branch, `SKIP_SCHEMES` comment: belonged to the old
  extension. The new build script escapes manifest fields anyway.

**No global rule (Ye's final decision).** `Cursor is on line: N` also appears with no selection, so it keeps
its literal meaning (v1's "cursor line = selection start" rule was wrong), and the injected message is
made fully self-describing (ASCII), so no `~/.gemini/GEMINI.md` rule is needed. GEMINI.md stays empty.

Also changed: if the newest live record for the workspace has `selection: null` (Ye cleared the
selection), nothing is injected — no fallback to another window's older selection.

## Verified in Ye's live test (2026-10-22, VS Code WSL window, agy 1.4.4, hook.log)
- **Hooks fire in VS Code (`--hub`) mode** from the global `~/.gemini/config/hooks.json`, and the model
  answered from the injected range (selection L62-L68 of a text file).
- **PreInvocation payload fields (exactly):** `artifactDirectoryPath` (`~/.gemini/antigravity/brain/<conv>`),
  `conversationId`, `initialNumSteps`, `invocationNum`, `modelName`, `transcriptPath`
  (`…/brain/<conv>/.system_generated/logs/transcript_full.jsonl`), `workspacePaths`. No `executionId`,
  no `parentConversationId` seen.
- **`invocationNum` is 0-based per turn:** 0 then 1 within one turn (11:21:56, 11:21:59; `initialNumSteps`
  24 → 28), and 0 again on the next turn (11:22:13, `initialNumSteps` 31).
- **CLI vs IDE:** the agy CLI keeps artifacts in `~/.gemini/antigravity-cli/brain/…` (seen on disk;
  CLI 1.0.8 changelog: hooks.json is shared at `~/.gemini/config/hooks.json`); VS Code's agy runs with
  `--app_data_dir=antigravity` → `~/.gemini/antigravity/brain/…`. The `/antigravity-cli/` test separates them.
- **Latency:** not measurable from hook.log (it logs only the start time). Offline the hook takes
  ~10-21 ms per call in WSL (dash/bash); no noticeable delay in the live test.
- **Ephemeral messages last one model call** (live transcript, 12:03): see changelog item 3.
- Still unknown: whether the ephemeral message is visible in the chat UI, and the chip's line base.

## 1. Problem

When Ye selects several lines and asks Antigravity about them, the model sees only the first line.

- `google.google-antigravity-1.8.0` **sends the full selection** to `~/.gemini/bin/agy` 1.4.4
  (`agy --hub …`):
  ```js
  this.window.onDidChangeTextEditorSelection(g=>{(g=this.buildTextDocument(g.textEditor,g.textEditor.document))&&this.forward("SELECTION_CHANGED",g)})
  toProtoRange(a,b=0){return xp(O.EditorStateMessage_Document_RangeSchema,
    {start:{line:a.start.line+b,character:a.start.character},end:{line:a.end.line+b,character:a.end.character}})}
  ```
  (`selection.start/end`, not `selection.active`; `forward` debounced 500 ms.)
- **agy drops the end.** Its only editor-state prompt strings are `Active Document: %s (%s)`,
  `Cursor is on line: %d`, `Other open documents:`. Ye's conversations show `Cursor is on line: 58`
  for a multi-line selection — the start line only. Ye confirmed this by testing.

## 2. Existing manual path

Built-in `ctrl+l → antigravity.insertSnippet` (when `editorTextFocus`) adds a chip:
```js
if(m){this.addContext({case:"fileLineRange",value:{absoluteUri:k.document.uri.toString(),startLine:m.start.line,endLine:m.end.line}}); … this.focusChatView(p)}
```
agy renders `fileLineRange` as `%s:L%d-L%d`. Works, but needs a key press, steals focus, and adds a chip
per press. Ye wants automatic, WYSIWYG behaviour.

## 3. Options considered and rejected

| Option | Why rejected |
|---|---|
| Global rule (alone or as helper) | Cannot recover the end line; as a helper it is unnecessary since the injected message is self-describing (Ye's decision: no rule). |
| Hidden setting | None exists (settings: serverPort, serverStartupTimeoutMs, enableTelemetry, enableInlineDiff, autoAcceptOnChat, autoOpenFiles, releaseBaseUrl, serverArgs, channel). |
| Automate `insertSnippet` / `antigravity.addContext` | Both focus the chat view; chips accumulate and cannot be removed programmatically. |
| MCP `get_current_selection` tool | Relies on the model choosing to call it; extra tool round-trip per turn. |
| Patch agy or the extension | Ye's policy; agy self-updates. |
| Claude IDE bridge (`~/.claude/ide/<port>.lock`) | One client per window, slot held by dsh-ide-context; WebSocket handshake per turn. |

## 4. Design (as implemented)

agy loads `hooks.json` from the customization root (global: `~/.gemini/config/hooks.json`). Format per
agy's bundled docs: top-level key = hook name; `PreInvocation` is a *flat* list of handlers
`{"type":"command","command":…,"timeout":<s>}`; `"enabled": false` disables a named hook. A handler
returns `{"injectSteps":[{"ephemeralMessage":"…"}]}`; ephemeral messages are dropped after the turn.

### 4.1 Extension `maye.agy-auto-context` 0.1.0
- repo root (`extension.js`, `package.json`, `build_vsix.py`, `test/mock-test.js`).
  `extensionKind: ["workspace"]`, `onStartupFinished`. Installed in WSL (`~/.vscode-server/extensions`).
- Listens to selection (active editor only), active-editor, window-state and workspace-folder changes;
  debounce 40 ms; skips the write when nothing but `ts` changed. Writes
  `~/.cache/agy-auto-context/<sessionId>-<pid>.json` via `<file>.<pid>.tmp` + `rename`. On activate,
  removes records whose pid is dead (ESRCH). On deactivate: disposes listeners, unlinks its file.
  Never touches focus, editors or the chat.
- Record (one compact line, no selected text):
  ```json
  {"v":1,"pid":12345,"sessionId":"…","workspaceFolders":["/home/maye/proj"],"focused":true,"ts":1792650000000,"selection":{"path":"/home/maye/proj/x.ts","startLine":12,"endLine":40}}
  ```
  `selection` is `null` for an empty selection (cursor only), no active editor, or a non-`file:` URI.
  Primary selection only for multi-cursor. Lines 1-based inclusive; if `end.character == 0` and
  `end.line > start.line`, `endLine = end.line` (the trailing line isn't really selected), else `end.line + 1`.

### 4.1a "N lines selected" row (selection-export 0.3.0, 2026-10-22)
0.2.0's status bar item was dropped (Ye). 0.3.0 contributes a collapsed tree view "Selection"
(`agyAutoContext.view`) into Antigravity's container `antigravity-sidebar`, below the chat; its
header title is `N lines selected` (one row), expanding it shows a file-icon row with a `path:La-Lb`
tooltip. VS Code 1.142 limits (from its source, verified with screenshots on the exact build 6d62b1d5
in a stub container): headers can't be hidden or made non-collapsible in a multi-view container,
titles render capitalized ("7 Lines Selected"), the description is hidden while collapsed, the
divider is `sideBarSectionHeader.border` (user can set it transparent globally). Details: extension README.
**0.3.1 (Ye):** the view is hidden by default (`"visibility": "hidden"` → `hideByDefault`, applied
regardless of who owns the container); with it hidden the Antigravity sidebar is a single view again.
Show it via right-click on the sidebar title > Selection.

**2026.11.15:** `"visibility"` changed to `"collapsed"` and the view ID changed from
`agyAutoContext.view` to `agyAutoContext.selectionView`. The new ID clears the old saved hidden state,
so existing installs receive the collapsed default on upgrade.

### 4.1b Status bar indicator (2026.11.15)
Alongside the optional sidebar view, 2026.11.15 adds a right-aligned status bar item
(`agyAutoContext.selection`, priority 101, always `.show()`n so VS Code keeps it in the status bar
right-click visibility menu). Clicking it invokes `agyAutoContext.selectStatusBarFormat` (QuickPick)
to update `agyAutoContext.statusBarFormat` between `concise` (`agy: # lines selected`, default) and
`detailed` (`agy: # lines selected: filename: L#-L#`). The setting is application-scoped, so a
workspace override cannot make the chooser appear to have no effect. When `selection` is `null`, it
shows `agy: 0 lines selected`.

### 4.2 Hook `hook/agy-auto-context.sh`
- `sh` + `/usr/bin/jq` (falls back to `jq` on PATH; no jq → `{}`).
- Steps: read stdin → skip CLI/subagent → if `invocationNum` (missing = 0) is not 0, re-inject the message
  stored at this turn's invocation 0 (`.turn-<conversationId>`), or `{}` if there was none → else read `*.json` records (corrupt
  ones ignored) → keep those matching a `workspacePaths` entry (in `workspaceFolders`, or the path lies
  under it) → order focused first, then newest `ts` → first record with a live pid wins → `selection == null`
  → `{}`, else inject:
  ```json
  {"injectSteps":[{"ephemeralMessage":"IDE selection: /home/maye/proj/x.ts:L12-L40 (1-based, inclusive). These are the lines the user currently has selected in the editor; their message refers to them. ('Cursor is on line' in ADDITIONAL_METADATA is only the cursor position.)"}]}
  ```
- `AGY_AUTO_CONTEXT_DEBUG=1` appends one line per call (time, reason, stdin payload ≤4000 chars, output) to
  `~/.cache/agy-auto-context/hook.log` (0600). Was on for the first test; now off.
- `~/.gemini/config/hooks.json`:
  ```json
  {"agy-auto-context":{"PreInvocation":[{"type":"command","command":"/home/maye/code/agy-auto-context/hook/agy-auto-context.sh","timeout":2}]}}
  ```

### 4.3 No global rule
Decided against (Ye): the injected message is self-describing, and `Cursor is on line: N` keeps its
literal meaning (it appears even with nothing selected). `~/.gemini/GEMINI.md` is left empty (it was
briefly given a rule during rollout and restored from `GEMINI.md.bak-20261022-110552`).

### 4.4 Why lean
Tiny token cost; same `path:La-Lb` shape as the chip; no stale text snapshot; few moving parts and
nothing sensitive in `~/.cache`.

## 5. Edge cases
- **Several windows / workspaces:** one record per window, matched via `workspacePaths`; focused, then newest.
  Dead windows filtered by pid; the extension also cleans dead records on start.
- **Cursor only / selection cleared:** inject nothing (the newest window's `null` wins, no fallback);
  ADDITIONAL_METADATA's `Cursor is on line: N` then is just the cursor.
- **Multi-cursor:** primary selection only.
- **Untitled / non-file URIs:** `selection: null`.
- **Selection made after typing:** read at send time (WYSIWYG). Clicking into the chat keeps the editor
  selection. A chat opened as an editor tab would make `activeTextEditor` undefined → `null`.
- **Local Windows windows:** out of scope (see top).
- **agy update changes hook format:** hook outputs `{}` on unexpected input; feature silently stops.
- **Hook failure / timeout:** always `{}` + exit 0; agy's 2 s timeout as a backstop.
- **Tool steps inside a turn:** every model call of the turn gets the same message (computed at
  `invocationNum 0`), because an ephemeral message is only visible to the call it was injected for.

## 6. Open questions
| Question | Status / how |
|---|---|
| Hooks fire in `--hub` (VS Code) mode? | **Yes** (verified, see top). |
| Per-turn key | **`invocationNum == 0`** starts a turn (verified 0-based per turn; no `executionId`); the message is repeated on later invocations (ephemeral = one model call only, verified 12:03). |
| Ephemeral message visible in the chat UI? | Unknown; the model sees it (it answered with the range). Check the chat / transcript. |
| Chip line base (`%s:L%d-L%d` from 0-based `start.line`) | Unknown. Select lines 12-40, Ctrl+L, ask the model to quote the chip. Our message states its base either way. |

## 7. Rollout and rollback
- Files: this repo (extension + `agy-auto-context-<version>.vsix`), `hook/agy-auto-context.sh`
  (+ `hook/test-hook.sh`), `~/.gemini/config/hooks.json` (new). `~/.gemini/GEMINI.md` unchanged (empty).
  Antigravity, agy, DSH and keybindings untouched.
- Disable: remove the `agy-auto-context` key from `~/.gemini/config/hooks.json` (or `"enabled": false`);
  `code --uninstall-extension maye.agy-auto-context` in WSL;
  `rm -rf ~/.cache/agy-auto-context`. Details in `README.md`.
