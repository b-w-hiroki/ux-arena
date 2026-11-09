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
test('all formerly raw test metadata rejects markup and render sites escape',()=>{
 for(const key of ['winner','adoptedWinner','version','targetResponses','minimumDetectableEffect']){
  const d=good();d.tests[0][key]='<img src=x onerror=alert(1)>';assert.equal(valid(d),false,key);
 }
 for(const value of ['t.version||1','t.targetResponses||30','t.winner','t.minimumDetectableEffect||15','r.winner'])assert.ok(src.includes('${esc('+value+')}'),value);
});
test('snapshot, decision log and backup fields cannot poison the next render',()=>{
 for(const extra of [{snapshots:[{}]},{snapshots:[{tests:[],ts:12}]},{decisionLog:[{ts:{}}]},{backups:[{ts:123}]},{backups:[{tests:[{id:'T',name:'x',winner:'<img>'}]}]}])assert.equal(valid({...good(),...extra}),false);
});
test('full current records and old comma separated tags remain compatible',()=>{
 const d=good();Object.assign(d.tests[0],{task:'Choose',winner:null,adoptedWinner:'A',published:true,pausedRun:false,version:1,targetResponses:30,minimumDetectableEffect:15,tags:'ui, mobile',history:[{ts:'2026-11-09',event:'created'}]});
 Object.assign(d.sessions[0],{pref:null,firstTouch:'A',leftVariant:'A',rightVariant:'B',firstActionMs:null,confidence:null,agree:null,qualityScore:100,qualityValid:true,qualityReasons:[],runnerVersion:91});
 d.snapshots=[{ts:'2026-11-09',tests:[],analysisFilter:'all'}];d.backups=[{ts:'2026-11-09',tests:d.tests,sessions:d.sessions,snapshots:d.snapshots}];assert.equal(valid(d),true);
});
test('rejected data never reaches persistent write through actual import handler',async()=>{
 const begin=src.indexOf("$('#importDataFile').onchange=");const end=src.indexOf('\n};',begin)+3;
 for(const extra of [{tests:[{id:'x',name:'x',winner:'<img src=x onerror=alert(1)>'}]},{snapshots:[{}]},{decisionLog:[{ts:123}]}]){
  const input={};let writes=0;const before={participantId:'P',profile:{},tests:[],sessions:[]};const context={validImportedState:valid,$:()=>input,state:before,pendingRecovery:null,localStorage:{setItem(){writes++}},toast(){}};
  runInNewContext(src.slice(begin,end),context);
  await input.onchange({target:{files:[{size:100,text:async()=>JSON.stringify({...good(),...extra})}],value:'file'}});
  assert.equal(writes,0);assert.equal(context.state,before);
 }
});
