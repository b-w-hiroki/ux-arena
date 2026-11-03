import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync('index.html','utf8');
const start=html.indexOf('function intuitionMetrics(rows){');
const end=html.indexOf('function renderIntuitionPanel()',start);
assert(start>=0&&end>start,'production intuitionMetrics not found');
const code=html.slice(start,end);
const calculate=runInNewContext(code+';intuitionMetrics', {Math,Number,Object,Array,Set,String,Date});
function dataset({mode='stable',n=128,participants=16}={}){
 const rows=[];
 for(let i=0;i<n;i++){
  const leftVariant=i%2?'A':'B';
  const pid='P'+(i%participants);
  let selected;
  if(mode==='stable')selected=i%8===0?'A':'B';
  else if(mode==='balanced')selected=i%2?'A':'B';
  else if(mode==='reverse')selected=i<n/2?'A':'B';
  else if(mode==='leftBias')selected=leftVariant;
  else selected='B';
  const chosenSide=selected===leftVariant?'left':'right';
  rows.push({id:'r'+String(i).padStart(4,'0'),ts:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),runnerVersion:91,status:'completed',selected,chosenSide,leftVariant,participantId:pid,elapsed:1100});
 }
 return rows;
}
const stable=calculate(dataset({mode:'stable'}));
const balanced=calculate(dataset({mode:'balanced'}));
const reverse=calculate(dataset({mode:'reverse'}));
const bias=calculate(dataset({mode:'leftBias'}));
const insufficient=calculate(dataset({mode:'stable',n:32}));
const concentration=calculate(dataset({mode:'stable',participants:2}));
assert.equal(stable.valid,128);
assert.equal(stable.participants,16);
assert.equal(balanced.stable,false);
assert.equal(reverse.reversed,true);
assert.equal(bias.biased,true);
assert.equal(insufficient.stable,false);
assert.equal(concentration.stable,false);
assert.equal(calculate([...dataset({mode:'stable'}),{runnerVersion:91,status:'timeout',id:'timeout'}]).valid,128);
console.log(JSON.stringify({stable:stable.stable,balanced:balanced.stable,reverse:reverse.reversed,positionBias:bias.biased,insufficient:insufficient.stable,concentration:concentration.stable}));

// Regression through production selection + metrics, using the browser fixture.
const {fixture}=await import('../fixtures/intuition.mjs');
const state=fixture();
const selection=html.slice(html.indexOf('function filteredSessions('),html.indexOf('function filteredTestSessions('));
const currentRun=html.slice(html.indexOf('function isCurrentRunSession('),html.indexOf('function completedSessionsFor('));
const quality=html.slice(html.indexOf('function sessionQuality('),html.indexOf('function weightedBRate('));
const select=runInNewContext(currentRun+quality+selection+';filteredSessions', {state,qualityFilter:'valid',analysisFilter:'standard',RUNNER_LIMIT:10000});
for(const t of state.tests){
 const rows=select({includeTimeout:true}).filter(x=>x.testId===t.id);
 const m=calculate(rows);
 assert.equal(m.valid,128);assert.equal(m.timeout,t.id==='slow'?64:16);
 assert.equal(m.within,128/(128+m.timeout));assert.equal(m.participants,16);
 assert.equal(m.stable,t.id==='stable');assert.equal(m.biased,t.id==='biased');assert.equal(m.reversed,t.id==='reverse');
 assert.equal(m.positionEffect,t.id==='biased'?1:0);
 assert.equal(select().filter(x=>x.testId===t.id).length,128);
}
