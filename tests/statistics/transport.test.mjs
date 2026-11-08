import {test} from 'node:test';
import assert from 'node:assert/strict';
import T from '../../assets/transport.js';
const experiment={id:'T-1',name:'CTA',task:'購入する',type:'cta',version:1,runEpoch:null,published:true,status:'running'};
const base=()=>({participantId:'P-1',tests:[structuredClone(experiment)],sessions:[],profile:{secret:'must not export'}});
const response=(id='S-1',status='completed')=>({id,testId:'T-1',participantId:'P-1',ts:'2026-11-08T00:00:00Z',runnerVersion:91,runEpoch:null,status,elapsed:status==='timeout'?10000:1000,selected:status==='completed'?'A':null,taps:1,misclicks:0});
test('study excludes profile and sessions, preserves local data',()=>{
 const s=base();s.sessions.push(response());const packet=T.study(s.tests);
 assert.equal(packet.profile,undefined);assert.equal(packet.sessions,undefined);
 const out=T.importStudy(s,packet);assert.deepEqual(out.sessions,s.sessions);assert.deepEqual(out.distributedTestIds,['T-1']);assert.equal(s.distributedTestIds,undefined);
});
test('round trip includes own answers only, retains timeout/aborted, deduplicates',()=>{
 const s=base();s.sessions=[response(),response('S-2','timeout'),response('S-3','aborted'),{...response('S-4'),participantId:'OTHER'}];
 const p=T.answers(s);assert.equal(p.sessions.length,3);assert.equal(p.profile,undefined);
 const merged=T.mergeAnswers(base(),p);assert.equal(merged.added,3);
 const again=T.mergeAnswers(merged.state,p);assert.equal(again.added,0);assert.equal(again.duplicate,3);assert.equal(base().sessions.length,0);
});
test('definition conflict and stale epoch fail atomically',()=>{
 const s=base();const p=T.study(s.tests);p.tests[0].task='違うタスク';
 assert.throws(()=>T.importStudy(s,p));assert.equal(s.tests[0].task,'購入する');
 s.sessions=[response()];const answer=T.answers(s);answer.sessions[0].runEpoch='other';assert.throws(()=>T.mergeAnswers(base(),answer));assert.equal(base().sessions.length,0);
});
test('duplicate id with conflicting data rejects entire batch',()=>{
 const s=base();s.sessions=[response()];const p=T.answers(s);
 p.sessions.push({...response(),selected:'B'});assert.throws(()=>T.mergeAnswers(base(),p));
});
test('malformed packet, metric and version rejected',()=>{
 const s=base();s.sessions=[response()];for(const mutate of [p=>p.schema='other',p=>p.sessions[0].elapsed=10001,p=>p.sessions[0].misclicks=-1,p=>p.sessions[0].selected=null,p=>p.tests[0].version=0]){
 const p=T.answers(s);mutate(p);assert.throws(()=>T.mergeAnswers(base(),p));
 }
});
test('old run and runner answers are excluded from current handoff',()=>{
 const s=base();s.sessions=[response(),{...response('S-old'),runEpoch:'old'},{...response('S-legacy'),runnerVersion:90}];
 assert.equal(T.answers(s).sessions.length,1);
});
