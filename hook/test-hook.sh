#!/bin/sh
# Unit tests for agy-auto-context.sh. Usage: sh test-hook.sh [shell]   (e.g. dash, bash)
SH=${1:-sh}; HERE=$(cd "$(dirname "$0")" && pwd); H="$HERE/agy-auto-context.sh"
T=$(mktemp -d); export AGY_AUTO_CONTEXT_DIR="$T"; unset AGY_AUTO_CONTEXT_DEBUG
sleep 60 & LIVE=$!
fail=0; n=0
run() { printf '%s' "$1" | $SH "$H"; }
check() { n=$((n+1)); got=$(run "$2"); case "$got" in *"$3"*) echo "ok   $n $1";; *) echo "FAIL $n $1: got [$got] want *$3*"; fail=1;; esac; }
# real VS Code-mode payload shape (2026-10-22): no executionId
P='{"artifactDirectoryPath":"/h/.gemini/antigravity/brain/c1","conversationId":"c1","initialNumSteps":24,"invocationNum":0,"modelName":"m","transcriptPath":"/h/.gemini/antigravity/brain/c1/.system_generated/logs/transcript_full.jsonl","workspacePaths":["/w/proj"]}'
p() { printf '%s' "$P" | sed "$1"; }
check "no records -> {}" "$P" '{}'
printf '{"v":1,"pid":%s,"sessionId":"s1","focused":false,"ts":1000,"workspaceFolders":["/w/proj"],"selection":{"path":"/w/proj/a b.ts","startLine":12,"endLine":40}}\n' $LIVE > "$T/s1-$LIVE.json"
printf '{"v":1,"pid":999999,"sessionId":"s2","focused":true,"ts":9999,"workspaceFolders":["/w/proj"],"selection":{"path":"/w/proj/dead.ts","startLine":1,"endLine":2}}\n' > "$T/s2-999999.json"
printf '{"v":1,"pid":%s,"sessionId":"s3","focused":true,"ts":5000,"workspaceFolders":["/w/other"],"selection":{"path":"/w/other/m.py","startLine":3,"endLine":4}}\n' $LIVE > "$T/s3-$LIVE.json"
check "live match (dead pid, other ws ignored)" "$(printf %s "$P")" '{"injectSteps":[{"ephemeralMessage":"IDE selection: /w/proj/a b.ts:L12-L40 (1-based, inclusive). These are the lines the user currently has selected in the editor; their message refers to them. ('"'"'Cursor is on line'"'"' in ADDITIONAL_METADATA is only the cursor position.)"}]}'
check "invocationNum 1 repeats the turn's message" "$(p 's/"invocationNum":0/"invocationNum":1/')" ':L12-L40'
n=$((n+1)); [ -s "$T/.turn-c1" ] && echo "ok   $n turn file written (mode $(stat -c %a "$T/.turn-c1"))" || { echo "FAIL $n turn file"; fail=1; }
cp "$T/s1-$LIVE.json" "$T/s1.keep"; sed -i 's/"startLine":12,"endLine":40/"startLine":1,"endLine":2/' "$T/s1-$LIVE.json"
check "invocationNum 5 repeats the turn-start range, not the new one" "$(p 's/"invocationNum":0/"invocationNum":5/')" ':L12-L40'
check "next turn invocationNum 0 recomputes" "$P" ':L1-L2'
mv "$T/s1.keep" "$T/s1-$LIVE.json"
check "missing invocationNum counts as 0" "$(p 's/"invocationNum":0,//')" ':L12-L40'
check "invocationNum 1 of another conversation without state -> {}" "$(p 's/"invocationNum":0/"invocationNum":1/; s/"conversationId":"c1"/"conversationId":"c9"/')" '{}'
check "IDE brain path not mistaken for CLI" "$P" ':L12-L40'
check "CLI session (~/.gemini/antigravity-cli/brain) -> {}" "$(p 's#/antigravity/brain#/antigravity-cli/brain#g')" '{}'
check "subagent -> {}" "$(p 's/"conversationId":"c1"/"conversationId":"c1","parentConversationId":"p"/')" '{}'
check "pretty-printed input" "$(printf %s "$P" | jq .)" ':L12-L40'
check "garbage input -> {}" 'not json' '{}'
check "empty input -> {}" '' '{}'
echo '{bad' > "$T/zz.json"; check "corrupt record ignored" "$(printf %s "$P")" ':L12-L40'; rm "$T/zz.json"
printf '{"v":1,"pid":%s,"sessionId":"s4","focused":true,"ts":2000,"workspaceFolders":["/w/proj"],"selection":{"path":"/w/proj/f.ts","startLine":7,"endLine":7}}\n' $LIVE > "$T/s4-$LIVE.json"
check "focused window preferred" "$(printf %s "$P")" 'f.ts:L7-L7'
printf '{"v":1,"pid":%s,"sessionId":"s4","focused":true,"ts":2001,"workspaceFolders":["/w/proj"],"selection":null}\n' $LIVE > "$T/s4-$LIVE.json"
check "focused window cleared selection -> {} (no fallback)" "$(printf %s "$P")" '{}'
check "no selection at turn start -> later invocation {}" "$(p 's/"invocationNum":0/"invocationNum":2/')" '{}'
rm -f "$T"/s1-*.json; check "only null/dead/other -> {}" "$(printf %s "$P")" '{}'
n=$((n+1)); got=$(printf '%s' "$P" | env PATH=/nonexistent JQ=/nonexistent /bin/sh "$H"); [ "$got" = '{}' ] && echo "ok   $n no jq -> {}" || { echo "FAIL $n no jq: [$got]"; fail=1; }
n=$((n+1)); got=$(printf '%s' "$(printf %s "$P")" | AGY_AUTO_CONTEXT_DEBUG=1 $SH "$H"); grep -q 'why=no-selection' "$T/hook.log" && echo "ok   $n debug log written" || { echo "FAIL $n debug log"; fail=1; }
n=$((n+1)); [ "$(stat -c %a "$T/hook.log")" = 600 ] && echo "ok   $n hook.log mode 600" || { echo "FAIL $n hook.log mode $(stat -c %a "$T/hook.log")"; fail=1; }
s=$(date +%s%N); i=0; while [ $i -lt 20 ]; do i=$((i+1)); printf '%s' "$P" | $SH "$H" >/dev/null; done
echo "timing: $(( ($(date +%s%N)-s)/20000000 )) ms/call ($SH)"
kill $LIVE 2>/dev/null; rm -rf "$T"
[ $fail = 0 ] && echo "ALL PASS ($n)" || { echo "SOME FAILED"; exit 1; }
