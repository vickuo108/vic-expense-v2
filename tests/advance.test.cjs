const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const receiptSource = html.slice(html.indexOf('function advanceRepayments('), html.indexOf('function setAdvanceFieldsExpanded('));
const fieldsSource = html.slice(html.indexOf('function updateAdvanceFields('), html.indexOf('function creditCardOwnAmount('));

function contextFor(records) {
  const options = [];
  const select = {
    value: '',
    replaceChildren() { options.length = 0; },
    appendChild(option) { options.push(option); },
  };
  const context = vm.createContext({
    isCCMethod: () => false,
    loadRecords: () => records,
    fmt: value => String(value),
    document: {
      getElementById: () => select,
      createElement: () => ({value: '', textContent: ''}),
    },
  });
  vm.runInContext(receiptSource, context);
  vm.runInContext(fieldsSource, context);
  return {context, options};
}

test('代墊收款可以早於支出，仍不得超收', () => {
  const target = {id: 'expense', date: '2026-11-10', amount: -100, advanceFor: '父母'};
  const receipt = {id: 'receipt', date: '2026-11-01', amount: 40, method: '現金'};
  const {context} = contextFor([target]);
  assert.equal(context.advanceReceiptError(receipt, target, [target]), '');
  assert.match(context.advanceReceiptError({...receipt, amount: 101}, target, [target]), /收款金額超過/);
  assert.match(context.advanceReceiptError(receipt, {...target, advanceFor: ''}, [target]), /找不到對應/);
});

test('較晚日期的代墊支出仍可出現在早收款的對應選單', () => {
  const target = {id: 'expense', date: '2026-11-10', amount: -100, advanceFor: '父母', method: '現金', main: '旅遊'};
  const {context, options} = contextFor([target]);
  context.updateAdvanceFields('f');
  assert.deepEqual(options.map(option => option.value), ['', 'expense']);
});
