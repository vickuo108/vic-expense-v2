const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const groupSource = html.slice(html.indexOf('function transactionKey('), html.indexOf('function initSearchListeners()'));
const lineSource = html.slice(html.indexOf('function collectBundleLines('), html.indexOf('function submitAdd()'));
const reconcileSource = html.slice(html.indexOf('function updateBundleTotal('), html.indexOf('function removeBundleLine('));
const cancellationSource = html.slice(html.indexOf('function savedBundleCancellationError('), html.indexOf('function toggleBundle('));

function loadGroups() {
  const context = vm.createContext({Map, Set});
  vm.runInContext(groupSource, context);
  return context;
}

function line({id = '', main, sub = '', amount, split = 'self', custom = '', advance = ''}) {
  const fields = {'.bundle-main': main, '.bundle-sub': sub, '.bundle-amount': amount,
    '.bundle-split': split, '.bundle-custom': custom, '.bundle-advance': advance};
  return {
    dataset: {recordId: id},
    querySelector(selector) { return {value: fields[selector]}; },
  };
}

function collect(lines) {
  let nextId = 0;
  const context = vm.createContext({
    document: {querySelectorAll() { return lines; }},
    parseAmt(value) { return Number(String(value).replaceAll(',', '')); },
    genId() { return `new-${++nextId}`; },
  });
  vm.runInContext(lineSource, context);
  return context.collectBundleLines('f');
}

function reconcile(entered, amounts) {
  const amount = {value: entered};
  const sum = {textContent: ''};
  const status = {textContent: '', matched: false,
    classList: {toggle(_name, value) { status.matched = value; }}};
  const context = vm.createContext({
    document: {
      getElementById(id) { return id === 'f-amount' ? amount : id === 'f-bundle-sum' ? sum : status; },
      querySelectorAll() { return amounts.map(value => ({value})); },
    },
    isBundleMode() { return true; },
    parseAmt(value) { return Number(String(value).replaceAll(',', '')) || 0; },
    fmtInput(value) { return Number(value).toLocaleString('en-US', {maximumFractionDigits: 2}); },
  });
  vm.runInContext(reconcileSource, context);
  context.updateBundleTotal('f');
  return {sum: sum.textContent, status: status.textContent, matched: status.matched,
    error: context.bundleAmountError('f'), entered: amount.value};
}

test('拆帳整筆只計一次，但保留各項金額與 ID', () => {
  const context = loadGroups();
  const records = [
    {id: 'a', bundleId: 'group', bundleIndex: 0, date: '2026-11-25', amount: -120, main: '主食'},
    {id: 'b', bundleId: 'group', bundleIndex: 1, date: '2026-11-25', amount: -80, main: '衣物'},
    {id: 'c', date: '2026-11-25', amount: -50, main: '交通'},
  ];
  assert.equal(context.transactionCount(records), 2);
  const transactions = context.collapseTransactions(records);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].amount, -200);
  assert.deepEqual(Array.from(transactions[0].bundleRows, row => row.id), ['a', 'b']);
  assert.equal(context.matchingTransactions(records, [records[1]]).length, 2);
});

test('每項獨立儲存分攤與代墊，整筆總額可由項目加總', () => {
  const result = collect([
    line({id: 'old-a', main: '主食', amount: '-285', split: 'half'}),
    line({main: '衣物', amount: '-1,000', advance: '父母'}),
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.records[0].id, 'old-a');
  assert.equal(result.records[0].split, 1);
  assert.equal(result.records[0].amount, -285);
  assert.equal(result.records[1].advanceFor, '父母');
  assert.equal(result.records[1].split, null);
  assert.equal(result.records.reduce((sum, row) => sum + row.amount, 0), -1285);
});

test('同一項不能同時代墊及女友分攤', () => {
  const result = collect([
    line({main: '主食', amount: '-100', split: 'half', advance: '父母'}),
    line({main: '衣物', amount: '-50'}),
  ]);
  assert.match(result.error, /不能同時代墊/);
});

test('拆帳金額必須為負數', () => {
  const result = collect([
    line({main: '主食', amount: '110'}),
    line({main: '衣物', amount: '-50'}),
  ]);
  assert.match(result.error, /負數金額/);
});

test('交易總金額與項目加總一致才能儲存', () => {
  const matched = reconcile('-500', ['-200', '-300']);
  assert.equal(matched.sum, '-$500');
  assert.equal(matched.status, '金額相符');
  assert.equal(matched.matched, true);
  assert.equal(matched.error, '');
  assert.equal(matched.entered, '-500');

  const mismatch = reconcile('-500', ['-200', '-250']);
  assert.equal(mismatch.status, '差額 $50');
  assert.match(mismatch.error, /差 \$50/);
  assert.equal(mismatch.matched, false);

  const incomplete = reconcile('-500', ['-500', '-']);
  assert.equal(incomplete.status, '尚有未填項目');
  assert.match(incomplete.error, /請填完整/);
});

test('已儲存拆帳有對應收款時不能取消', () => {
  const rows = [
    {id: 'a', bundleId: 'group'},
    {id: 'b', bundleId: 'group'},
  ];
  const context = vm.createContext({Set, gfSettlement: () => ({byId: {}})});
  vm.runInContext(cancellationSource, context);
  assert.equal(context.savedBundleCancellationError(rows, 'group'), '');
  assert.match(context.savedBundleCancellationError([...rows, {advanceRepaymentFor: 'a'}], 'group'), /代墊收款/);
  context.gfSettlement = () => ({byId: {b: {paid: 20}}});
  assert.match(context.savedBundleCancellationError(rows, 'group'), /女友還款/);
});
