// Mock-vscode test for extension.js record writing. Usage: node test/mock-test.js
'use strict';
const Module = require('module');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selexp-')) + '/sel';
process.env.AGY_AUTO_CONTEXT_DIR = dir;
const L = { sel: [], ed: [], win: [], ws: [] };
const ev = (k) => (fn) => { L[k].push(fn); return { dispose() { L[k] = L[k].filter((f) => f !== fn); } }; };
const pos = (line, character) => ({ line, character });
const mkSel = (a, b, c, d) => ({ start: pos(a, b), end: pos(c, d), isEmpty: a === c && b === d });
const ed = (scheme, fsPath, s) => ({ document: { uri: { scheme, fsPath } }, selection: s });
const probe = { title: undefined, description: undefined, message: undefined, disposed: false, viewId: null, dispose() { this.disposed = true; } };
class EventEmitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach((f) => f(x)); } dispose() { this.l = []; } }
class TreeItem { constructor(label, cs) { this.label = label; this.collapsibleState = cs; } }
class ThemeIcon { constructor(id) { this.id = id; } }
const vscode = {
  EventEmitter, TreeItem, ThemeIcon, TreeItemCollapsibleState: { None: 0 },
  env: { sessionId: 'sess/1:x' },
  workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/w/proj' } }, { uri: { scheme: 'vscode-vfs', fsPath: '/x' } }],
    onDidChangeWorkspaceFolders: ev('ws') },
  window: { activeTextEditor: undefined, state: { focused: true },
    createTreeView: (id, opts) => { probe.viewId = id; probe.provider = opts.treeDataProvider; return probe; },
    onDidChangeTextEditorSelection: ev('sel'), onDidChangeActiveTextEditor: ev('ed'), onDidChangeWindowState: ev('win') },
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : orig.call(this, req, ...rest); };
const ext = require('../extension.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = path.join(dir, `sess_1_x-${process.pid}.json`);
const read = () => { const t = fs.readFileSync(file, 'utf8'); assert.strictEqual(t.split('\n').length, 2, 'single line'); return JSON.parse(t); };
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old-999999.json'), '{}');           // dead pid -> cleaned
  fs.writeFileSync(path.join(dir, `live-${process.ppid}.json`), '{}');  // live pid -> kept
  const ctx = { subscriptions: [] };
  ext.activate(ctx);
  assert.ok(!fs.existsSync(path.join(dir, 'old-999999.json')), 'dead record cleaned');
  assert.ok(fs.existsSync(path.join(dir, `live-${process.ppid}.json`)), 'live record kept');
  await sleep(80);
  let r = read();
  assert.deepStrictEqual([r.v, r.pid, r.sessionId, r.focused, r.selection], [1, process.pid, 'sess/1:x', true, null]);
  assert.deepStrictEqual(r.workspaceFolders, ['/w/proj']);
  assert.strictEqual((fs.statSync(dir).mode & 0o777).toString(8), '700');
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');
  const set = (e) => { vscode.window.activeTextEditor = e; L.ed.forEach((f) => f(e)); };
  const selc = (s) => { vscode.window.activeTextEditor.selection = s; L.sel.forEach((f) => f({ textEditor: vscode.window.activeTextEditor })); };
  const cases = [
    ['multi-line', () => set(ed('file', '/w/proj/a.ts', mkSel(11, 2, 39, 5))), { path: '/w/proj/a.ts', startLine: 12, endLine: 40 }],
    ['end at col 0 excludes line', () => selc(mkSel(11, 0, 40, 0)), { path: '/w/proj/z.ts', startLine: 12, endLine: 40 }],
    ['single line partial', () => selc(mkSel(6, 1, 6, 9)), { path: '/w/proj/z.ts', startLine: 7, endLine: 7 }],
    ['cleared (cursor only)', () => selc(mkSel(6, 3, 6, 3)), null],
    ['untitled scheme', () => set(ed('untitled', 'Untitled-1', mkSel(0, 0, 3, 1))), null],
    ['vscode-remote scheme not allowed', () => set(ed('vscode-remote', '/x', mkSel(0, 0, 3, 1))), null],
    ['no editor', () => set(undefined), null],
  ];
  for (const [name, act, want] of cases) {
    set(ed('file', '/w/proj/z.ts', mkSel(0, 0, 0, 1))); await sleep(60);
    act(); await sleep(60);
    assert.deepStrictEqual(read().selection, want, name); console.log('ok  ', name);
  }
  // debounce: 5 rapid changes -> one write with the last value
  set(ed('file', '/w/proj/b.ts', mkSel(0, 0, 0, 1))); await sleep(60);
  let writes = 0; const w0 = fs.writeFileSync; fs.writeFileSync = function (...a) { writes++; return w0.apply(this, a); };
  for (let i = 1; i <= 5; i++) selc(mkSel(i, 0, i + 2, 1));
  await sleep(80); fs.writeFileSync = w0;
  assert.strictEqual(writes, 1, 'debounced'); assert.deepStrictEqual(read().selection.startLine, 6); console.log('ok   debounce (1 write)');
  // non-active editor selection events ignored
  L.sel.forEach((f) => f({ textEditor: {} })); console.log('ok   non-active editor ignored');
  // focus tracking
  vscode.window.state.focused = false; L.win.forEach((f) => f({ focused: false })); await sleep(60);
  assert.strictEqual(read().focused, false); console.log('ok   focus tracked');
  // one-row view in Antigravity's container: header title = "N lines selected", row with icon + tooltip
  assert.strictEqual(probe.viewId, 'agyAutoContext.view');
  let fired = 0; probe.provider.onDidChangeTreeData(() => fired++);
  set(ed('file', '/w/proj/a.ts', mkSel(11, 2, 17, 4))); await sleep(60);
  assert.strictEqual(probe.title, '7 lines selected');
  assert.strictEqual(probe.description, 'a.ts:L12-L18');
  let kids = probe.provider.getChildren();
  assert.strictEqual(kids.length, 1); assert.strictEqual(kids[0].label, '7 lines selected');
  assert.strictEqual(kids[0].iconPath.id, 'file'); assert.strictEqual(kids[0].tooltip, '/w/proj/a.ts:L12-L18 (1-based, inclusive)');
  assert.strictEqual(kids[0].command, undefined, 'no click command'); assert.strictEqual(probe.provider.getTreeItem(kids[0]), kids[0]);
  assert.ok(fired >= 1, 'tree refreshed'); const f0 = fired;
  selc(mkSel(11, 2, 17, 4)); await sleep(60); assert.strictEqual(fired, f0, 'no refresh when unchanged');
  selc(mkSel(4, 0, 4, 3)); await sleep(60); assert.strictEqual(probe.title, '1 line selected');
  selc(mkSel(4, 0, 6, 0)); await sleep(60);
  assert.strictEqual(probe.title, '2 lines selected', 'endLine rule shared with record');
  assert.deepStrictEqual(read().selection, { path: '/w/proj/a.ts', startLine: 5, endLine: 6 });
  selc(mkSel(4, 3, 4, 3)); await sleep(60);
  assert.strictEqual(probe.title, ''); assert.strictEqual(probe.description, ''); assert.deepStrictEqual(probe.provider.getChildren(), []);
  assert.strictEqual(probe.message, 'No selection');
  set(ed('untitled', 'U', mkSel(0, 0, 5, 0))); await sleep(60); assert.strictEqual(probe.title, '', 'empty for non-file');
  set(undefined); await sleep(60); assert.strictEqual(probe.title, '', 'empty with no editor');
  console.log('ok   view row follows selection (title/description/row/tooltip)');
  // no tmp leftovers
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []); console.log('ok   no tmp files');
  // deactivate: unlink + listeners disposed
  ctx.subscriptions.forEach((d) => d.dispose()); ext.deactivate();
  assert.ok(!fs.existsSync(file), 'unlinked');
  assert.ok(probe.disposed, 'view disposed'); assert.strictEqual(L.sel.length + L.ed.length + L.win.length + L.ws.length, 0);
  set(ed('file', '/w/proj/a.ts', mkSel(1, 0, 3, 0))); await sleep(60);
  assert.ok(!fs.existsSync(file), 'no write after deactivate'); console.log('ok   deactivate unlinks + disposes');
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
