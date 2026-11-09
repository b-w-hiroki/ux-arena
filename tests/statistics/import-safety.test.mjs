import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const src=readFileSync('assets/app.js','utf8');
const code=src.slice(src.indexOf('function validImportedState('),src.indexOf("$('#importDataBtn').onclick"));
const valid=runInNewContext(code+';validImportedState');
const good=()=>({tests:[{id:'T',name:'Test'}],sessions:[{testId:'T',selected:'A',elapsed:1200}]});
test('legacy minimal valid data stays accepted',()=>assert.equal(valid(good()),true));
test('untrusted selected text is rejected before import',()=>{const d=good();d.sessions[0].selected='<img src=x onerror=alert(1)>';assert.equal(valid(d),false)});
test('invalid elapsed and null records rejected',()=>{const d=good();d.sessions[0].elapsed='1';assert.equal(valid(d),false);d.sessions=[null];assert.equal(valid(d),false)});
test('history selected value is escaped as defense in depth',()=>assert.ok(src.includes("${esc(s.selected||'—')}選択")));
test('import persists before replacing state and cannot overwrite pending recovery',()=>{
const handler=src.slice(src.indexOf("$('#importDataFile').onchange"),src.indexOf('\n};',src.indexOf("$('#importDataFile').onchange")));
assert.ok(handler.includes('if(pendingRecovery) throw'));
assert.ok(handler.indexOf('localStorage.setItem(STORAGE')<handler.indexOf('state=next'));
assert.ok(!handler.includes('save();'));
});
