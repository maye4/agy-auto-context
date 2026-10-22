#!/bin/sh
# End-to-end: extension (mocked vscode, live node process) writes a record; the hook injects it.
HERE=$(cd "$(dirname "$0")/.." && pwd); HOOK="$HERE/hook/agy-auto-context.sh"
T=$(mktemp -d); export AGY_AUTO_CONTEXT_DIR="$T" AGY_AUTO_CONTEXT_DIR="$T"
node -e '
const Module=require("module"),o=Module._load;
const vs={env:{sessionId:"e2e"},workspace:{workspaceFolders:[{uri:{scheme:"file",fsPath:"/w/p"}}],onDidChangeWorkspaceFolders:()=>({dispose(){}})},
 window:{state:{focused:true},activeTextEditor:{document:{uri:{scheme:"file",fsPath:"/w/p/src/a.js"}},selection:{start:{line:11,character:0},end:{line:40,character:0},isEmpty:false}},
 onDidChangeTextEditorSelection:()=>({dispose(){}}),onDidChangeActiveTextEditor:()=>({dispose(){}}),onDidChangeWindowState:()=>({dispose(){}})}};
Module._load=function(r,...a){return r==="vscode"?vs:o.call(this,r,...a)};
const e=require(process.argv[1]);const c={subscriptions:[]};e.activate(c);
setTimeout(()=>{e.deactivate()},3000);
' "$HERE/extension.js" &
NP=$!; sleep 0.5
P='{"artifactDirectoryPath":"/h/.gemini/antigravity/brain/c","conversationId":"c","initialNumSteps":3,"invocationNum":0,"modelName":"m","transcriptPath":"/h/t.jsonl","workspacePaths":["/w/p"]}'
a=$(printf '%s' "$P" | sh "$HOOK"); echo "with selection: $a"
wait $NP; b=$(printf '%s' "$P" | sh "$HOOK"); echo "after deactivate: $b"; [ -z "$(ls -A "$T")" ] || { echo "leftover: $(ls -A "$T")"; exit 1; }
rm -rf "$T"
case "$a" in '{"injectSteps":[{"ephemeralMessage":"IDE selection: /w/p/src/a.js:L12-L40 (1-based, inclusive). These are the lines the user currently has selected in the editor; their message refers to them. ('"'"'Cursor is on line'"'"' in ADDITIONAL_METADATA is only the cursor position.)"}]}') ;; *) echo E2E FAIL; exit 1;; esac
[ "$b" = '{}' ] || { echo E2E FAIL; exit 1; }; echo E2E PASS
