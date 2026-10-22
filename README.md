# agy auto context

Automatic editor-selection context for **Google Antigravity** (the `agy` agent) in VS Code.

When you select lines 12-40 and ask Antigravity about them, `agy` 1.4.x only tells the model
`Cursor is on line: 12`; the end of the selection is lost. This project adds the full range to every
model call of the turn, without patching Antigravity or `agy` and without stealing focus:

```
IDE selection: /home/me/proj/src/a.ts:L12-L40 (1-based, inclusive). These are the lines the user
currently has selected in the editor; their message refers to them. ('Cursor is on line' in
ADDITIONAL_METADATA is only the cursor position.)
```

Only the path and line numbers are sent, never the selected text; the model reads the lines itself.

It has two parts:

- **VS Code extension `maye.agy-auto-context`** (`extension.js`): a workspace extension that writes the
  active editor's primary selection range (absolute path, 1-based inclusive lines, no text) to
  `~/.cache/agy-auto-context/<sessionId>-<pid>.json`. The record is one compact JSON line, written
  atomically (tmp + rename, 40 ms debounce); the directory is 0700 and the file 0600. `selection` is
  `null` when nothing is selected or the document is not a `file:` URI. Optional one-row view
  "N lines selected" under the Antigravity chat (hidden by default).
- **agy PreInvocation hook** (`hook/agy-auto-context.sh`, POSIX `sh` + `jq`): picks the record of the
  live VS Code window whose workspace matches the conversation (the focused one first, then the newest),
  and injects the message above as an ephemeral message. It computes the message on the turn's first
  model call (`invocationNum` 0) and repeats it on later calls of the same turn, because an ephemeral
  message is seen only by the call it was injected for. It skips agy CLI sessions and subagents. It
  always prints one JSON object (`{}` on any problem) and exits 0.

Design notes and verified agy behaviour: [docs/DESIGN.md](docs/DESIGN.md).

## Scope

Tested with VS Code 1.142 connected to **WSL** (Ubuntu 24.04), Antigravity extension 1.8.0 and agy 1.4.4,
where the extension host, `agy` and `~/.gemini` all run on the Linux side. It should also work on
native Linux and macOS (`/proc` is used for the pid liveness check, so macOS needs a small change).
Native Windows is not supported.

## Install

Requirements: `jq` (`/usr/bin/jq` or on `PATH`), `python3` (only to build the vsix), `node` (only for tests).

```sh
git clone https://github.com/maye4/agy-auto-context.git ~/code/agy-auto-context
cd ~/code/agy-auto-context
python3 build_vsix.py                      # -> agy-auto-context-0.4.0.vsix
code --install-extension agy-auto-context-0.4.0.vsix
# in a WSL / Remote window use the server CLI instead:
#   ~/.vscode-server/bin/<commit>/bin/code-server --install-extension agy-auto-context-0.4.0.vsix
```

Register the hook in `~/.gemini/config/hooks.json` (shared by agy in VS Code and the agy CLI; use an
absolute path, and merge with existing hooks if the file already exists):

```json
{"agy-auto-context":{"PreInvocation":[{"type":"command","command":"/home/me/code/agy-auto-context/hook/agy-auto-context.sh","timeout":2}]}}
```

Reload the VS Code window. Check with `ls -l ~/.cache/agy-auto-context/`.

### Optional "N lines selected" row

The extension contributes a view "Selection" (`agyAutoContext.view`) into Antigravity's sidebar
container, hidden by default. To show it, right-click the Antigravity sidebar title and check
**Selection**. Collapsed, it is a single header row showing `N lines selected`; expanded, one row with a
`path:La-Lb` tooltip. VS Code 1.142 cannot hide a pane header or make it non-collapsible in a container
with two or more views, and it renders the title capitalised (`7 Lines Selected`). The divider line is the
theme colour `sideBarSectionHeader.border`, which you can set to `#00000000` in
`workbench.colorCustomizations` if you like (this affects every side bar section header).

## Configuration

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `AGY_AUTO_CONTEXT_DIR` | extension, hook | `~/.cache/agy-auto-context` | record directory |
| `AGY_AUTO_CONTEXT_DEBUG=1` | hook | off | append one line per call (time, reason, payload, output) to `$AGY_AUTO_CONTEXT_DIR/hook.log` (0600) |
| `JQ` | hook | `/usr/bin/jq` | jq binary |

To debug, prefix the hooks.json command with `AGY_AUTO_CONTEXT_DEBUG=1 `. Reasons logged: `ok`, `repeat`,
`later-invocation-no-selection`, `no-records`, `no-selection`, `no-live-match`,
`skip-cli-subagent-or-bad-json`, `no-jq`, `bad-json`, `jq-records`, `jq-out`, `empty-stdin`, `stdin`.

## Tests

```sh
node --check extension.js && node test/mock-test.js   # extension, mocked vscode API
sh hook/test-hook.sh dash && sh hook/test-hook.sh bash  # hook unit tests
sh test/e2e.sh                                          # extension writes a record, hook injects it
```

## Uninstall

1. Remove the `agy-auto-context` key from `~/.gemini/config/hooks.json` (or add `"enabled": false` to it).
2. `code --uninstall-extension maye.agy-auto-context` (or `code-server` in a WSL window), then reload.
3. `rm -rf ~/.cache/agy-auto-context`.

No global rule in `~/.gemini/GEMINI.md` is needed or installed: the injected message is self-describing.

## License

MIT, see [LICENSE](LICENSE).
