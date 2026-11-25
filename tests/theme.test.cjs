const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const themeSource = html.slice(html.indexOf('const THEMES=['), html.indexOf('const DEFAULT_METHODS_GROUPED'));

function loadTheme(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const variables = new Map();
  const meta = {content: ''};
  const context = vm.createContext({
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
    document: {
      documentElement: {style: {setProperty(key, value) { variables.set(key, value); }}},
      querySelector() { return meta; },
      querySelectorAll() { return []; },
    },
  });
  vm.runInContext(themeSource, context);
  return {storage, variables, meta, context};
}

test('新裝置預設使用我的主題與完整主視覺色票', () => {
  const {storage, variables, meta} = loadTheme();
  assert.equal(storage.get('vic2_theme'), 'vic');
  assert.equal(meta.content, '#2F6F6B');
  assert.equal(variables.get('--primary'), '#2F6F6B');
  assert.equal(variables.get('--app-bg'), '#F7F4EE');
  assert.equal(variables.get('--app-ink'), '#293331');
  assert.equal(variables.get('--app-accent'), '#DDA378');
});

test('舊預設藍色只轉換一次，之後仍能手動選回藍色', () => {
  const first = loadTheme({vic2_theme: 'blue'});
  assert.equal(first.storage.get('vic2_theme'), 'vic');
  vm.runInContext("applyTheme('blue')", first.context);
  const again = loadTheme(Object.fromEntries(first.storage));
  assert.equal(again.storage.get('vic2_theme'), 'blue');
  assert.equal(again.variables.get('--app-bg'), '#F0F2F5');
  assert.equal(again.variables.get('--app-ink'), '#1A1A2E');
});

test('既有自選配色不被預設主題覆蓋', () => {
  const {storage, variables} = loadTheme({vic2_theme: 'rose'});
  assert.equal(storage.get('vic2_theme'), 'rose');
  assert.equal(variables.get('--primary'), '#E11D48');
});
