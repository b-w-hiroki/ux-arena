/* Local JSON handoff only: no upload, network or participant-profile export. */
(function(root){
'use strict';
const SCHEMA='ux-arena-handoff-v1', MAX_SESSIONS=10000;
const fields=['id','name','task','metric','type','version','runEpoch','hypothesis','successMetric','targetResponses','minimumDetectableEffect','guardrailMetric','tags'];
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>JSON.stringify(sort(x));
function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
function text(x){return typeof x==='string'&&x.length>0&&x.length<=2000;}
function definition(t){
 if(!t||!text(t.id)||!text(t.name)||!text(t.task)||!['cta','density','nav'].includes(t.type))throw Error('実験定義の形式が不正です');
 const out={};for(const k of fields)if(t[k]!==undefined)out[k]=clone(t[k]);
 out.version=t.version??1;out.runEpoch=t.runEpoch??null;
 out.hypothesis=t.hypothesis||'';out.successMetric=t.successMetric||'selection';out.targetResponses=t.targetResponses??30;out.minimumDetectableEffect=t.minimumDetectableEffect??15;out.guardrailMetric=t.guardrailMetric||'misclick';out.tags=Array.isArray(t.tags)?t.tags:typeof t.tags==='string'?t.tags.split(',').map(x=>x.trim()).filter(Boolean):[];
 if(!out.tags.every(x=>typeof x==='string')||['hypothesis','successMetric','guardrailMetric'].some(k=>typeof out[k]!=='string'))throw Error('実験の文字列が不正です');
 if(!Number.isInteger(out.version)||out.version<1||!(out.runEpoch===null||text(out.runEpoch)))throw Error('実験の版・世代が不正です');
 for(const k of ['targetResponses','minimumDetectableEffect'])if(out[k]!==undefined&&(!Number.isFinite(out[k])||out[k]<=0))throw Error('実験の数値が不正です');
 return out;
}
function envelope(p,kind){
 if(!p||p.schema!==SCHEMA||p.kind!==kind||p.runnerVersion!==91||!Array.isArray(p.tests)||!p.tests.length||p.tests.length>100)throw Error('ファイルの種類・形式・ランナー版を確認してください');
 const tests=p.tests.map(definition);if(new Set(tests.map(t=>t.id)).size!==tests.length)throw Error('実験IDが重複しています');return tests;
}
function packet(kind,tests,sessions){return {schema:SCHEMA,kind,runnerVersion:91,createdAt:new Date().toISOString(),tests:tests.map(definition),...(sessions?{sessions:clone(sessions)}:{})};}
function study(tests){if(!tests.length)throw Error('配信中の実験がありません');return packet('study',tests);}
function importStudy(state,p){
 const tests=envelope(p,'study'),next=clone(state);
 for(const t of tests){const existing=next.tests.find(x=>x.id===t.id);if(existing&&stable(definition(existing))!==stable(t))throw Error('同じIDで定義・版・世代が異なります。別のブラウザプロファイルで開いてください');if(!existing)next.tests.push({...t,published:true,status:'running'});}
 next.distributedTestIds=tests.map(t=>t.id);return next;
}
function answers(state){
 const sessions=state.sessions.filter(s=>s.runnerVersion===91&&state.tests.some(t=>t.id===s.testId&&(t.runEpoch||null)===s.runEpoch)&&s.participantId===state.participantId&&(!state.distributedTestIds||state.distributedTestIds.includes(s.testId)));
 if(!sessions.length)throw Error('書き出せる自分の回答がありません');
 const ids=new Set(sessions.map(s=>s.testId));return packet('answers',state.tests.filter(t=>ids.has(t.id)),sessions);
}
function mergeAnswers(state,p){
 const tests=envelope(p,'answers');if(!Array.isArray(p.sessions)||!p.sessions.length||p.sessions.length>MAX_SESSIONS)throw Error('回答件数が不正です');
 const defs=new Map(tests.map(t=>[t.id,t]));
 for(const t of tests){const local=state.tests.find(x=>x.id===t.id);if(!local||stable(definition(local))!==stable(t))throw Error('実験定義・版・世代が一致しません。異なる実験として保管してください');}
 const next=clone(state),seen=new Map(next.sessions.map(s=>[s.id,s]));let added=0,duplicate=0;
 for(const s of p.sessions){
  const t=defs.get(s.testId);
  if(!t||!text(s.id)||!text(s.participantId)||!text(s.ts)||!Number.isFinite(Date.parse(s.ts))||s.runnerVersion!==91||!['completed','timeout','aborted'].includes(s.status)||!(s.runEpoch===null||text(s.runEpoch))||s.runEpoch!==t.runEpoch||!Number.isFinite(s.elapsed)||s.elapsed<0||s.elapsed>10000)throw Error('回答の形式・世代・時間が不正です');
  if(s.status==='completed'?(!['A','B'].includes(s.selected)||s.elapsed<=0||s.elapsed>=10000):s.selected!==null)throw Error('回答の状態と選択が一致しません');
  for(const k of ['taps','misclicks','hesitation','firstActionMs','postFirstDecisionMs','qualityScore'])if(s[k]!=null&&(!Number.isFinite(s[k])||s[k]<0))throw Error('回答の計測値が不正です');
  if(seen.has(s.id)){if(stable(seen.get(s.id))!==stable(s))throw Error('同じ回答IDに異なる内容があります');duplicate++;continue;}
  seen.set(s.id,s);next.sessions.push(clone(s));added++;
 }
 return {state:next,added,duplicate};
}
const api={study,importStudy,answers,mergeAnswers,definition};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ArenaTransport=api;
})(typeof globalThis!=='undefined'?globalThis:this);
