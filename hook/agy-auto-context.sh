#!/bin/sh
# agy-auto-context: Antigravity (agy) PreInvocation hook.
# Injects the VS Code editor selection (written by the maye.agy-auto-context extension to
# ~/.cache/agy-auto-context/<sessionId>-<pid>.json) once per turn as an ephemeral message:
#   IDE selection: /abs/path:L12-L40 (1-based, inclusive). These are the lines the user ... (self-describing; no global rule)
# Contract: ALWAYS print exactly one JSON object on stdout and exit 0, whatever happens.
# Env: AGY_AUTO_CONTEXT_DIR (record dir), AGY_AUTO_CONTEXT_DEBUG=1 (append to $AGY_AUTO_CONTEXT_DIR/hook.log), JQ (jq binary).
# Design: docs/DESIGN.md in https://github.com/maye4/agy-auto-context
out='{}'
DIR="${AGY_AUTO_CONTEXT_DIR:-$HOME/.cache/agy-auto-context}"
JQ="${JQ:-/usr/bin/jq}"
[ -x "$JQ" ] || JQ=$(command -v jq 2>/dev/null) || JQ=
in=
why=
finish() {
  printf '%s\n' "$out"
  if [ "${AGY_AUTO_CONTEXT_DEBUG:-}" = 1 ] && [ -d "$DIR" ]; then
    { umask 077
      printf '%s why=%s in=%.4000s out=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${why:-ok}" \
        "$(printf '%s' "$in" | tr '\n' ' ')" "$out" >> "$DIR/hook.log"; } 2>/dev/null
  fi
}
trap finish EXIT
[ -n "$JQ" ] || { why=no-jq; exit 0; }
in=$(cat) || { why=stdin; exit 0; }       # agy closes stdin after the payload; hooks.json timeout guards
[ -n "$in" ] || { why=empty-stdin; exit 0; }
# skip agy CLI sessions (artifacts in ~/.gemini/antigravity-cli/brain; VS Code uses ~/.gemini/antigravity/brain) and subagents
printf '%s' "$in" | "$JQ" -e '((.artifactDirectoryPath // "") | test("/antigravity-cli/") | not)
  and ((.parentConversationId // "") == "")' >/dev/null 2>&1 || { why=skip-cli-subagent-or-bad-json; exit 0; }
# Per turn: compute the selection on the turn's first model call (invocationNum 0, missing = 0) and
# repeat that same message on every later model call of the turn. agy only shows an ephemeral message
# to the model call it was injected for (live test 2026-10-22: after a tool call, invocationNum 1 no
# longer saw it and the model answered from "Cursor is on line" alone). The payload has no executionId.
inv=$(printf '%s' "$in" | "$JQ" -r '.invocationNum // 0' 2>/dev/null) || { why=bad-json; exit 0; }
conv=$(printf '%s' "$in" | "$JQ" -r '.conversationId // ""' 2>/dev/null | tr -cd 'A-Za-z0-9_.-')
st="$DIR/.turn-$conv"
if [ "$inv" != 0 ]; then
  [ -n "$conv" ] && [ -s "$st" ] || { why=later-invocation-no-selection; exit 0; }
  msg=$(cat "$st" 2>/dev/null)
  [ -n "$msg" ] || { why=later-invocation-no-selection; exit 0; }
  out=$("$JQ" -cn --arg m "$msg" '{injectSteps:[{ephemeralMessage:$m}]}') || { out='{}'; why=jq-out; exit 0; }
  why=repeat; exit 0
fi
# new turn: forget this conversation's previous turn; prune stale turn files (>1 day)
[ -n "$conv" ] && rm -f "$st" 2>/dev/null
find "$DIR" -maxdepth 1 -name '.turn-*' -mtime +0 -delete 2>/dev/null
set -- "$DIR"/*.json
[ -e "$1" ] || { why=no-records; exit 0; }
cands=$("$JQ" -nrR --argjson in "$in" '
  def ws: ($in.workspacePaths // []);
  # newest live window of this workspace wins (focused first); if its selection is null, inject nothing
  [ inputs | fromjson? | select(type=="object" and .v==1 and (.pid|type)=="number")
        | select(. as $r | any(ws[]; . as $w | (($r.workspaceFolders // []) | index($w)) != null
                                   or (($r.selection.path // "") | startswith($w + "/"))))
  ] | sort_by([(if .focused then 1 else 0 end), (.ts // 0)]) | reverse | .[]
  | "\(.pid)\t" + (if .selection == null then "-" else
      "IDE selection: \(.selection.path):L\(.selection.startLine)-L\(.selection.endLine) (1-based, inclusive). These are the lines the user currently has selected in the editor; their message refers to them. (\u0027Cursor is on line\u0027 in ADDITIONAL_METADATA is only the cursor position.)" end)
' "$@" 2>/dev/null) || { why=jq-records; exit 0; }
tab=$(printf '\t')
msg=$(printf '%s\n' "$cands" | while IFS="$tab" read -r pid m; do
  [ -n "$pid" ] && [ -d "/proc/$pid" ] && { printf '%s' "$m"; break; }
done)
[ -n "$msg" ] || { why=no-live-match; exit 0; }
[ "$msg" != - ] || { why=no-selection; exit 0; }
[ -n "$conv" ] && { umask 077; printf '%s' "$msg" > "$st.$$" && mv -f "$st.$$" "$st"; } 2>/dev/null
out=$("$JQ" -cn --arg m "$msg" '{injectSteps:[{ephemeralMessage:$m}]}') || { out='{}'; why=jq-out; }
exit 0
