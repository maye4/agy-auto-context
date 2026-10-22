'use strict';
// agy-auto-context (maye.agy-auto-context): write this window's primary editor selection (path + 1-based lines, no text)
// to ~/.cache/agy-auto-context/<sessionId>-<pid>.json for the Antigravity PreInvocation hook.
// Runs in the workspace (WSL) extension host. Never touches focus, editors or chat.
// 0.3.0: a one-row view "N lines selected" in Antigravity's sidebar container (antigravity-sidebar),
// placed below the Antigravity chat. Collapsed (the default), the view is just its header row, which
// shows the text as the view title; expanded, its single tree row shows the same text with a
// file icon and a path:range tooltip. VS Code always shows pane headers when a container has 2+ views,
// and hides the header description of collapsed panes, so the text goes into the header title.
// so the header cannot be removed; using it as the row is the most compact option.
// 0.4.0: renamed from maye.selection-export (record dir ~/.cache/agy-auto-context, view agyAutoContext.view).
// 0.3.1: the view is hidden by default ("visibility": "hidden"); show it via right-click on the
// Antigravity container header > Selection.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEBOUNCE_MS = 40;
const ALLOWED_SCHEMES = new Set(['file']); // allowlist: only real files the agent can read

let dir = '';
let file = '';
let timer = null;
let active = false;
let lastKey = '';
let view = null;
let viewKey = '';
let rowItem = null;
let onRowChange = null;
const VIEW_ID = 'agyAutoContext.view';

function selectionOf(editor) {
  if (!editor || !editor.document) return null;
  const uri = editor.document.uri;
  if (!ALLOWED_SCHEMES.has(uri.scheme)) return null;
  const s = editor.selection; // primary selection when multi-cursor
  if (!s || s.isEmpty) return null;
  const startLine = s.start.line + 1;
  // endLine rule: a selection ending at column 0 of a later line does not include that line
  const endLine = (s.end.character === 0 && s.end.line > s.start.line) ? s.end.line : s.end.line + 1;
  return { path: uri.fsPath, startLine, endLine };
}

function buildRecord() {
  const folders = (vscode.workspace.workspaceFolders || [])
    .filter((f) => ALLOWED_SCHEMES.has(f.uri.scheme))
    .map((f) => f.uri.fsPath);
  return {
    v: 1,
    pid: process.pid,
    sessionId: vscode.env.sessionId,
    workspaceFolders: folders,
    focused: !!(vscode.window.state && vscode.window.state.focused),
    ts: Date.now(),
    selection: selectionOf(vscode.window.activeTextEditor),
  };
}

function writeNow() {
  timer = null;
  if (!active) return;
  try { updateView(); } catch (e) { /* ignore */ }
  try {
    const rec = buildRecord();
    const key = JSON.stringify(Object.assign({}, rec, { ts: 0 }));
    if (key === lastKey) return; // nothing changed; keep ts = time of last real change
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`; // not *.json, so the hook never globs it
    fs.writeFileSync(tmp, JSON.stringify(rec) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    lastKey = key;
  } catch (e) {
    // best effort only; never bother the user
    lastKey = '';
  }
}

function linesText(sel) {
  const n = sel.endLine - sel.startLine + 1;
  return `${n} line${n === 1 ? '' : 's'} selected`;
}

function updateView() {
  if (!view) return;
  const sel = active ? selectionOf(vscode.window.activeTextEditor) : null;
  const text = sel ? linesText(sel) : '';
  const tip = sel ? `${sel.path}:L${sel.startLine}-L${sel.endLine} (1-based, inclusive)` : '';
  const key = text + '\n' + tip;
  if (key === viewKey) return;
  viewKey = key;
  // header row: the title is the only header text VS Code shows while the view is collapsed
  // (the description is CSS-hidden on collapsed panes); the description shows when expanded
  view.title = text;
  view.description = sel ? `${path.basename(sel.path)}:L${sel.startLine}-L${sel.endLine}` : '';
  if (sel) {
    rowItem = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    rowItem.id = 'sel';
    rowItem.iconPath = new vscode.ThemeIcon('file');
    rowItem.tooltip = tip;
  } else {
    rowItem = null;
  }
  view.message = sel ? undefined : 'No selection';
  if (onRowChange) onRowChange.fire();
}

function schedule() {
  if (!active) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(writeNow, DEBOUNCE_MS);
}

function cleanupDead() {
  // remove records left by crashed extension hosts on this machine (<anything>-<pid>.json)
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const n of names) {
    const m = /-(\d+)\.json$/.exec(n);
    if (!m || Number(m[1]) === process.pid) continue;
    try { process.kill(Number(m[1]), 0); } catch (e) {
      if (e && e.code === 'ESRCH') { try { fs.unlinkSync(path.join(dir, n)); } catch (_) { /* ignore */ } }
    }
  }
}

function activate(context) {
  dir = process.env.AGY_AUTO_CONTEXT_DIR || path.join(os.homedir(), '.cache', 'agy-auto-context');
  const sid = String(vscode.env.sessionId || 'nosession').replace(/[^A-Za-z0-9_.-]/g, '_');
  file = path.join(dir, `${sid}-${process.pid}.json`);
  active = true;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  } catch (e) { /* ignore */ }
  cleanupDead();
  try {
    // never reveals or focuses the view; only provides its content
    onRowChange = new vscode.EventEmitter();
    context.subscriptions.push(onRowChange);
    view = vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider: { onDidChangeTreeData: onRowChange.event, getChildren: () => (rowItem ? [rowItem] : []), getTreeItem: (x) => x },
    });
    view.title = '';
    context.subscriptions.push(view);
  } catch (e) {
    view = null; // e.g. Antigravity not installed (container missing): records still work
  }
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) schedule();
    }),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.window.onDidChangeWindowState(schedule),
    vscode.workspace.onDidChangeWorkspaceFolders(schedule),
    { dispose: stop },
  );
  schedule();
}

function stop() {
  if (!active) return;
  active = false;
  if (timer) { clearTimeout(timer); timer = null; }
  try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  lastKey = '';
  if (view) { try { view.dispose(); } catch (e) { /* ignore */ } }
  view = null; rowItem = null; viewKey = ''; onRowChange = null;
}

function deactivate() { stop(); }

module.exports = { activate, deactivate, _test: { selectionOf, buildRecord, linesText } };
