
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const IS_ADMIN=document.body.dataset.role==='admin';
const STORAGE='ux_arena_v6'; // v30: keep existing storage key for backward compatibility
let state=load();
const RUNNER_LIMIT=10000, RUNNER_BATCH=5;
let runnerLocked=false, runnerRaf=0, runnerTimer=0;
let runnerGeneration=0;
let currentTestId=null, startedAt=0, firstTouch=null, selected=null, pref=null, taps=0, misclicks=0, lastActionAt=0, maxIdle=0, firstActionAt=0, sideMap={left:'A',right:'B'};

function uid(){return 'P-'+Math.random().toString(36).slice(2,8).toUpperCase()}
function tid(){return 'T-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}
function defaults(){return [
{id:'T-CTA',name:'CTA配置',task:'商品を確認して購入まで進んでください。',metric:'発見性',type:'cta',published:true,status:'running'},
{id:'T-DENSITY',name:'情報密度',task:'商品の特徴を確認して購入まで進んでください。',metric:'理解度',type:'density',published:true,status:'running'},
{id:'T-NAV',name:'ナビ配置',task:'商品一覧から目的の商品を探して購入まで進んでください。',metric:'操作速度',type:'nav',published:true,status:'running'}
]}
function load(){try{const r=localStorage.getItem(STORAGE);if(r){const p=JSON.parse(r);if(!p.participantId)p.participantId=uid();if(!Array.isArray(p.tests))p.tests=defaults();p.tests.forEach(t=>{if(!t.status)t.status=t.published?'running':'draft';});if(!Array.isArray(p.sessions))p.sessions=[];if(!p.profile)p.profile={experience:'standard',device:'mobile'};if(!Array.isArray(p.decisionLog))p.decisionLog=[];if(!Array.isArray(p.snapshots))p.snapshots=[];if(!Array.isArray(p.backups))p.backups=[];return p}}catch(e){}return{participantId:uid(),tests:defaults(),sessions:[],profile:{experience:'standard',device:'mobile'},decisionLog:[],snapshots:[],backups:[]}}
// v60: secondary same-tab recovery journal. This is best-effort and not a cloud backup.
const RECOVERY_KEY=STORAGE+'-pending-recovery-v60';
let pendingRecovery=null;
function journalRecovery(snapshot){
  try{sessionStorage.setItem(RECOVERY_KEY,JSON.stringify(snapshot));return true}catch(e){console.warn('Recovery journal unavailable',e);return false}
}
function clearRecoveryJournal(){try{sessionStorage.removeItem(RECOVERY_KEY)}catch(e){}}
function restoreRecoveryJournal(){
  try{const raw=sessionStorage.getItem(RECOVERY_KEY);if(!raw)return;
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.sessions)||!Array.isArray(data.tests)){console.warn('Recovery journal schema invalid');return;}
    // Compare the full saved state: admin-only changes may not add sessions.
    // Comparing session IDs alone could discard a pending publish/archive/delete.
    if(JSON.stringify(data)===JSON.stringify(state)){clearRecoveryJournal();return;}
    // Never overwrite persistent state silently. Require an explicit retry.
    pendingRecovery=data;
    queueMicrotask(()=>{runnerGeneration++;cancelAnimationFrame(runnerRaf);clearTimeout(runnerTimer);startedAt=0;runnerLocked=true;document.body.classList.remove('runner-active');$('#testStage').classList.add('hidden');$('#testStage').inert=true;showSaveFailure();});
  }catch(e){console.warn('Recovery journal invalid',e)}
}

window.addEventListener('beforeunload',e=>{if(pendingRecovery){e.preventDefault();e.returnValue='';}});
function save(silent=false){if(pendingRecovery){if(!silent)showSaveFailure();return false;}try{localStorage.setItem(STORAGE,JSON.stringify(state));return true}catch(e){console.error('UX ARENA: 保存に失敗しました',e);if(!silent){pendingRecovery=JSON.parse(JSON.stringify(state));journalRecovery(pendingRecovery);showSaveFailure();}return false}}
function showSaveFailure(){
 let alert=document.getElementById('saveFailure');
 if(!alert){alert=document.createElement('div');alert.id='saveFailure';alert.setAttribute('role','alert');alert.className='save-failure';alert.innerHTML='<strong>記録を保存できませんでした</strong><span>未保存回答を保護中です。再保存またはJSON保存を行ってください。復旧前の別操作・リセットはできません。</span><button type="button" id="retrySave">再保存</button><button type="button" id="backupSave">JSON保存</button>';document.body.appendChild(alert);document.getElementById('retrySave').onclick=()=>{try{localStorage.setItem(STORAGE,JSON.stringify(pendingRecovery||state));if(pendingRecovery){state=pendingRecovery;pendingRecovery=null;}clearRecoveryJournal();alert.remove();runnerGeneration++;runnerBatchCount=0;cancelAnimationFrame(runnerRaf);clearTimeout(runnerTimer);startedAt=0;runnerLocked=false;document.body.classList.remove('runner-active');$('#testStage').classList.add('hidden');$('#testStage').inert=true;$('#batchComplete').classList.add('hidden');refreshAll();renderParticipant();toast('未保存の回答を復旧しました。新しいバッチを開始できます')}catch(e){console.error(e);const note=alert.querySelector('span');if(note)note.textContent='再保存に失敗しました。空き容量やブラウザ設定を確認し、必要ならJSON保存してください。'}};document.getElementById('backupSave').onclick=()=>{const blob=new Blob([JSON.stringify(pendingRecovery||state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ux-arena-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}
 if(document.body.classList.contains('runner-active')){
   runnerGeneration++;
   cancelAnimationFrame(runnerRaf);
   clearTimeout(runnerTimer);
   startedAt=0;
   runnerLocked=true;
   document.body.classList.remove('runner-active');
   $('#testStage').classList.add('hidden');
   $('#testStage').inert=true;
 }
}
function toast(m){const e=$('#toast');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1300)}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function show(id){
 if(!$('#'+id)||(!IS_ADMIN&&id.startsWith('a-')))return false;
 if(pendingRecovery){showSaveFailure();return false;}
 if(!$('#testStage').classList.contains('hidden') && id!=='p-test' && startedAt && !runnerLocked){
   const elapsed=Math.round(performance.now()-startedAt);
   state.sessions.push({
     id:'S-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),testId:currentTestId,ts:new Date().toISOString(),
     status:'aborted',runnerVersion:91,runEpoch:state.tests.find(t=>t.id===currentTestId)?.runEpoch||null,participantId:state.participantId,elapsed,taps,misclicks,hesitation:Math.round(maxIdle),
     firstTouch,leftVariant:sideMap.left,rightVariant:sideMap.right
   });
   if(!save())return false;
   runnerGeneration++;
   cancelAnimationFrame(runnerRaf);
   clearTimeout(runnerTimer);
   startedAt=0;
   runnerLocked=false;
   document.body.classList.remove('runner-active');
   $('#testStage').classList.add('hidden');
   $('#testStage').inert=true;
 }
 $$('.screen').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active');$$('.nav button,.topnav button').forEach(b=>b.classList.toggle('active',b.dataset.target===id));if(id==='p-test')renderParticipant();if(id==='p-results')refreshStats();if(id==='a-tests')renderAdminTests();if(id==='a-analysis'){renderAnalysis();renderHealth();renderSegmentInsights();renderCohortMatrix();renderDesignCheck();renderDecisionLog();renderReport();}if(id==='a-library'){renderLibrary();renderBenchmark();renderAdoptedPatterns();renderTemplateLibrary();}return true;}
function setMode(m){if(pendingRecovery){showSaveFailure();return false;}const a=m==='admin',target=a?'a-tests':'p-test';if(document.body.classList.contains('runner-active')&&show(target)===false)return false;$('#participantMode').classList.toggle('active',!a);$('#adminMode').classList.toggle('active',a);$('#participantNav').classList.toggle('hidden',a);$('#adminNav').classList.toggle('hidden',!a);$('#participantTopNav').classList.toggle('hidden',a);$('#adminTopNav').classList.toggle('hidden',!a);if(!$('#'+target).classList.contains('active'))return show(target);return true}
function pubs(){normalizeAllStatuses();return state.tests.filter(t=>t.status==='running' && t.published)}

function detectDevice(){
  const w=Math.min(window.innerWidth||999,screen.width||999);
  return w<=600?'mobile':'desktop';
}
function completedTestIds(){
  return new Set(state.sessions.filter(x=>isCurrentRunSession(x) && x.status==='completed' && (x.selected==='A'||x.selected==='B') && x.participantId===state.participantId).map(x=>x.testId));
}
function chooseNextTest(){
  const list=pubs();
  if(!list.length)return null;
  const done=completedTestIds();
  const unseen=list.filter(t=>!done.has(t.id));
  const pool=unseen.length?unseen:list;
  const counts=pool.map(t=>({t,n:completedSessionsFor(t.id).length}));
  const least=Math.min(...counts.map(x=>x.n));
  const balanced=counts.filter(x=>x.n===least).map(x=>x.t);
  return balanced[Math.floor(Math.random()*balanced.length)];
}

function current(){const l=pubs();if(!l.length)return null;return l.find(t=>t.id===currentTestId)||chooseNextTest()}
function cardContent(type,variant){
  if(type==='density'){
    if(variant==='A') return `<div><div class="mock-top"><b>A</b><span class="mock-chip">詳細</span></div><div class="mock-title">ワイヤレスイヤホン</div><div class="mock-copy">ノイズキャンセリング・防滴・30時間再生・急速充電・マルチポイント対応。</div><div class="info-list"><div class="info-row"><span>再生</span><b>30時間</b></div><div class="info-row"><span>防滴</span><b>IPX4</b></div><div class="info-row"><span>重量</span><b>4.8g</b></div></div><div class="mock-price">¥12,800</div></div><button type="button" class="mock-cta bottom-cta" data-success="1">購入する</button>`;
    return `<div><div class="mock-top"><b>B</b><span class="mock-chip">要点</span></div><div class="mock-title">ワイヤレスイヤホン</div><div class="mock-copy">30時間再生。ノイズキャンセリング。防滴対応。</div><div class="mock-price">¥12,800</div></div><button type="button" class="mock-cta bottom-cta" data-success="1">購入する</button>`;
  }
  if(type==='nav'){
    if(variant==='A') return `<div><div class="navmock top"><button type="button" data-mis="1">ホーム</button><button type="button" data-mis="1">検索</button><button type="button" data-mis="1">保存</button></div><div class="mock-title">商品一覧</div><div class="mock-copy">イヤホン / スピーカー / 時計</div><div class="mock-price">¥12,800</div></div><button type="button" class="mock-cta" data-success="1">この商品を購入</button>`;
    return `<div><div class="mock-title">商品一覧</div><div class="mock-copy">イヤホン / スピーカー / 時計</div><div class="mock-price">¥12,800</div></div><div><button type="button" class="mock-cta" data-success="1">この商品を購入</button><div class="navmock"><button type="button" data-mis="1">ホーム</button><button type="button" data-mis="1">検索</button><button type="button" data-mis="1">保存</button></div></div>`;
  }
  if(variant==='A') return `<div><div class="mock-top"><b>A</b><span class="mock-chip">下CTA</span></div><div class="mock-title">ワイヤレスイヤホン</div><div class="mock-copy">商品の説明を読んでから購入します。</div><div class="mock-price">¥12,800</div></div><button type="button" class="mock-cta bottom-cta" data-success="1">購入する</button>`;
  return `<div><div class="mock-top"><b>B</b><span class="mock-chip">上CTA</span></div><button type="button" class="mock-cta top-cta" data-success="1">今すぐ購入</button><div class="mock-title">ワイヤレスイヤホン</div><div class="mock-copy">CTAを先に見せます。</div><div class="mock-price">¥12,800</div></div><div></div>`;
}
function renderParticipant(){
 const t=current(),btn=$('#startTest');if(!document.body.classList.contains('runner-active'))$('#testStage').classList.add('hidden');if(!t){$('#taskText').textContent='現在参加できるテストはありません。';btn.disabled=true;return}currentTestId=t.id;$('#taskText').textContent=t.task;$('#metricBadge').textContent=t.metric;const bp=batchProgress();$('#batchBadge').textContent=Math.min(bp.done,bp.target)+' / '+bp.target+' 本日の有効選択';$('#batchProgressBar').style.width=Math.min(100,Math.round(bp.done/bp.target*100))+'%';$('#batchComplete').classList.add('hidden');btn.disabled=false;btn.classList.remove('hidden');
}
function buildCompare(){const t=current();if(!t)return;const prior=state.sessions.filter(x=>x.testId===t.id && isCurrentRunSession(x) && x.status!=='aborted'),la=prior.filter(x=>x.leftVariant==='A').length,lb=prior.filter(x=>x.leftVariant==='B').length;const swap=la<lb?false:lb<la?true:Math.random()<.5;sideMap=swap?{left:'B',right:'A'}:{left:'A',right:'B'};const mk=(v,side)=>`<div class="variant ${v==='A'?'themeA':'themeB'}" data-variant="${v}" data-side="${side}">${cardContent(t.type,v)}</div>`;$('#compare').innerHTML=mk(sideMap.left,'left')+mk(sideMap.right,'right');$$('.variant').forEach(v=>{v.addEventListener('pointerdown',()=>touch(v.dataset.variant),{passive:true});v.addEventListener('click',e=>{if(runnerLocked||!v.isConnected||!document.body.classList.contains('runner-active'))return;if(startedAt&&performance.now()-startedAt>=RUNNER_LIMIT){completeRunner('timeout');return}if(e.detail===0)touch(v.dataset.variant);const success=e.target.closest('[data-success="1"]'),mis=e.target.closest('[data-mis="1"]');if(mis){misclicks++;return}if(!success){misclicks++;return}if(success){if(!firstActionAt){firstActionAt=performance.now();firstTouch=v.dataset.variant}if(performance.now()-startedAt>=RUNNER_LIMIT){completeRunner('timeout');return}selected=v.dataset.variant;completeRunner('completed')}})})}
function touch(v){if(runnerLocked||!startedAt||!document.body.classList.contains('runner-active'))return;const now=performance.now();if(startedAt&&now-startedAt>=RUNNER_LIMIT){completeRunner('timeout');return}taps++;if(!firstActionAt)firstActionAt=now;if(lastActionAt)maxIdle=Math.max(maxIdle,now-lastActionAt);lastActionAt=now;if(!firstTouch)firstTouch=v;const el=$(`.variant[data-variant="${v}"]`);if(el)el.classList.add('touched')}
function runnerDoneCount(){return runnerBatchCount}
let runnerBatchCount=0;
function updateRunnerClock(){if(!startedAt||runnerLocked)return;const elapsed=performance.now()-startedAt,remain=Math.max(0,RUNNER_LIMIT-elapsed);$('#runnerTime').textContent='';$('#runnerTimeBar').style.transform=`scaleX(${remain/RUNNER_LIMIT})`;const remainingSeconds=Math.ceil(remain/1000);if($('#runnerProgress').getAttribute('aria-valuenow')!==String(remainingSeconds))$('#runnerProgress').setAttribute('aria-valuenow',String(remainingSeconds));if(remain<=0){completeRunner('timeout');return}runnerRaf=requestAnimationFrame(updateRunnerClock)}
function start(){if(pendingRecovery||!current()||document.body.classList.contains('runner-active'))return;runnerGeneration++;runnerBatchCount=0;selected=pref=firstTouch=null;taps=misclicks=0;maxIdle=0;firstActionAt=0;runnerLocked=false;window.scrollTo(0,0);document.body.classList.add('runner-active');$('#testStage').classList.remove('hidden');$('#testStage').inert=false;$('#batchComplete').classList.add('hidden');const t=current();$('#runnerTask').textContent=t.task.replace(/[。！!？?]+$/,'');$('#runnerCount').textContent=(runnerDoneCount()+1)+' / '+RUNNER_BATCH;buildCompare();startedAt=lastActionAt=performance.now();cancelAnimationFrame(runnerRaf);runnerRaf=requestAnimationFrame(updateRunnerClock)}
function completeRunner(status){if(runnerLocked||!startedAt)return;runnerLocked=true;if(status!=='completed')selected=null;cancelAnimationFrame(runnerRaf);clearTimeout(runnerTimer);const elapsed=Math.min(RUNNER_LIMIT,Math.max(1,Math.round(performance.now()-startedAt)));if(status==='completed'&&performance.now()-startedAt>=RUNNER_LIMIT){status='timeout';selected=null;}const rec={id:'S-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),testId:currentTestId,ts:new Date().toISOString(),status,selected:selected||null,pref:null,firstTouch,elapsed,taps,misclicks,hesitation:Math.round(maxIdle),firstActionMs:firstActionAt>0?Math.round(firstActionAt-startedAt):null,postFirstDecisionMs:firstActionAt?Math.round(performance.now()-firstActionAt):null,confidence:null,agree:null,leftVariant:sideMap.left,rightVariant:sideMap.right,chosenSide:selected?(selected===sideMap.left?'left':'right'):null,experience:(state.profile&&state.profile.experience)||'standard',device:(state.profile&&state.profile.device)||detectDevice(),runnerVersion:91,runEpoch:state.tests.find(t=>t.id===currentTestId)?.runEpoch||null,participantId:state.participantId,within10s:status==='completed',timeout:status==='timeout'};const q=sessionQuality(rec);rec.qualityScore=q.score;rec.qualityValid=q.valid;rec.qualityReasons=q.reasons;state.sessions.push(rec);if(status==='completed')normalizeAllStatuses();journalRecovery(state);const persisted=save(true);if(persisted)clearRecoveryJournal();startedAt=0;if(!persisted){pendingRecovery=JSON.parse(JSON.stringify(state));journalRecovery(pendingRecovery);state.sessions=state.sessions.filter(x=>x.id!==rec.id);runnerGeneration++;runnerLocked=true;showSaveFailure();return;}if(status==='completed'||status==='timeout')runnerBatchCount++;$$('.variant').forEach(x=>{x.style.opacity=selected&&x.dataset.variant!==selected?'.35':'1';x.style.pointerEvents='none'});const generation=runnerGeneration;runnerTimer=setTimeout(()=>{if(generation!==runnerGeneration)return;(status==='aborted'?endRunner:advanceRunner)()},180)}
function advanceRunner(){if(pendingRecovery||!document.body.classList.contains('runner-active')||!runnerLocked||startedAt>0)return;const done=runnerDoneCount();if(done>=RUNNER_BATCH){endRunner();return}currentTestId=(chooseNextTest()||{}).id||currentTestId;selected=firstTouch=null;taps=misclicks=0;maxIdle=0;firstActionAt=0;runnerLocked=false;const t=current();if(!t){endRunner();return}$('#runnerTask').textContent=t.task.replace(/[。！!？?]+$/,'');$('#runnerCount').textContent=(done+1)+' / '+RUNNER_BATCH;buildCompare();startedAt=lastActionAt=performance.now();runnerRaf=requestAnimationFrame(updateRunnerClock)}
function endRunner(){const finished=runnerBatchCount>=RUNNER_BATCH;runnerGeneration++;runnerBatchCount=0;cancelAnimationFrame(runnerRaf);clearTimeout(runnerTimer);startedAt=0;runnerLocked=false;document.body.classList.remove('runner-active');$('#testStage').classList.add('hidden');$('#testStage').inert=true;$('#batchComplete').classList.toggle('hidden',!finished);refreshAll();if(finished)$('#batchComplete').classList.remove('hidden')}
function finish(){if(selected&&!runnerLocked&&startedAt>0)completeRunner('completed')}
function refreshStats(){const own=state.sessions.filter(x=>x.participantId===state.participantId);const s=own.filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B') && (!x.runnerVersion || Number(x.elapsed)<RUNNER_LIMIT));$('#participantId').textContent=state.participantId;$('#myCount').textContent=s.length;const qs=s.length?Math.round(s.reduce((a,x)=>a+(x.qualityScore===undefined?sessionQuality(x).score:x.qualityScore),0)/s.length):0;$('#participantQuality').textContent=s.length?qs+'/100':'—';if(!s.length){['avgTime','agreeRate','misclickAvg','hesitationAvg','firstActionAvg','behaviorConfidence'].forEach(id=>$('#'+id).textContent='—');$('#behaviorNote').textContent='まだデータがありません';return}const times=s.map(x=>x.elapsed||0).sort((a,b)=>a-b),avg=times.reduce((a,x)=>a+x,0)/times.length,median=times[Math.floor(times.length/2)],within=100*s.length/Math.max(1,own.filter(x=>x.status==='completed'||x.status==='timeout').length),mis=s.reduce((a,x)=>a+(x.misclicks||0),0)/s.length,hes=s.reduce((a,x)=>a+(x.hesitation||0),0)/s.length,firstActions=s.filter(x=>Number.isFinite(x.firstActionMs)).map(x=>x.firstActionMs),fa=firstActions.length?firstActions.reduce((a,x)=>a+x,0)/firstActions.length:null;$('#avgTime').textContent=(avg/1000).toFixed(1)+'s';$('#agreeRate').textContent=Math.round(within)+'%';$('#misclickAvg').textContent=mis.toFixed(1);$('#hesitationAvg').textContent=(hes/1000).toFixed(1)+'s';$('#firstActionAvg').textContent=fa===null?'—':(fa/1000).toFixed(1)+'s';$('#behaviorConfidence').textContent=(median/1000).toFixed(1)+'s';$('#behaviorNote').textContent=within>=90?'10秒以内の完了率が高い状態です':within>=70?'一部で判断時間が伸びています':'10秒以内に収まらない回答が多めです'}
function isCurrentRunSession(x){
  const t=state.tests.find(t=>t.id===x.testId);
  return !!t && (!t.runEpoch || x.runEpoch===t.runEpoch);
}
function completedSessionsFor(id){
  return state.sessions.filter(x=>x.testId===id && isCurrentRunSession(x) && x.status==='completed' && (x.selected==='A'||x.selected==='B'));
}
function normalizeTestStatus(t){
  if(!t.version)t.version=1;if(!t.successMetric)t.successMetric='selection';if(!t.targetResponses)t.targetResponses=30;if(!t.minimumDetectableEffect)t.minimumDetectableEffect=15;if(!t.guardrailMetric)t.guardrailMetric='misclick';if(!Array.isArray(t.tags))t.tags=tagList(t);
  if(!Array.isArray(t.history))t.history=[];
  if(!t.status){
    t.status=t.published?'running':'draft';
  }
  const n=completedSessionsFor(t.id).filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B')).length;
  const target=Math.max(10,Number(t.targetResponses||30));
  if(t.status==='running' && n>=target){
    t.status='completed';
    t.published=false;
    const a=completedSessionsFor(t.id).filter(x=>x.status==='completed'&&x.selected==='A').length;
    const b=completedSessionsFor(t.id).filter(x=>x.status==='completed'&&x.selected==='B').length;
    t.winner=a===b?'draw':(a>b?'A':'B');
    t.completedAt=t.completedAt||new Date().toISOString();
    logTestEvent(t,'auto_completed',`Winner ${t.winner} / n=${n}`);
    appendDecisionLog(t.id,'自動完了',`Winner ${t.winner} / n=${n}`);
  }
  return t;
}
function normalizeAllStatuses(){
  state.tests.forEach(normalizeTestStatus);
}

function logTestEvent(t,event,detail){
  if(!t)return;
  if(!Array.isArray(t.history))t.history=[];
  t.history.push({ts:new Date().toISOString(),event,detail:detail||''});
  if(t.history.length>50)t.history=t.history.slice(-50);
}

function statusLabel(t){
  if(t.status==='running')return '配信中';
  if(t.status==='completed')return '完了';
  if(t.status==='archived')return 'アーカイブ';
  return '下書き';
}
function deriveAdminAction(){
  normalizeAllStatuses();
  const running=state.tests.filter(t=>t.status==='running');
  const drafts=state.tests.filter(t=>t.status==='draft');
  const completed=state.tests.filter(t=>t.status==='completed');
  if(!running.length && drafts.length){
    return {kind:'publish',title:'次のテストを公開',text:`下書きが ${drafts.length} 件あります。まず1件を配信開始します。`,testId:drafts[0].id,short:'公開'};
  }
  if(running.length){
    const t=running.slice().sort((a,b)=>completedSessionsFor(b.id).length-completedSessionsFor(a.id).length)[0];
    const n=completedSessionsFor(t.id).filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B')).length;
    const target=Math.max(10,Number(t.targetResponses||30));
    return {kind:'inspect',title:'配信中テストを確認',text:`「${t.name}」は ${n}/${target} 回答です。完了まであと ${Math.max(0,target-n)} 件です。`,testId:t.id,short:'確認'};
  }
  if(completed.length){
    const latest=completed.slice().sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||''))[0];
    return {kind:'suggest',title:'勝者から次実験を作成',text:`「${latest.name}」の勝者 ${latest.winner||'—'} をベースに次の比較案を作ります。`,testId:latest.id,short:'派生'};
  }
  return {kind:'create',title:'最初のテストを作成',text:'比較したいUIテーマを1つ作成します。',short:'作成'};
}
function experimentQueueItems(){
  const items=[];
  const running=state.tests.filter(t=>t.status==='running');
  running.forEach(t=>{
    const n=completedSessionsFor(t.id).filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B')).length;
    const target=Math.max(10,Number(t.targetResponses||30));items.push({priority:100-Math.min(100,n/target*100),title:`${t.name} を継続`,detail:`${n}/${target}回答`,kind:'wait'});
  });
  const completed=state.tests.filter(t=>t.status==='completed').slice(-3).reverse();
  completed.forEach(t=>{
    items.push({priority:80,title:`${t.name} の勝者派生`,detail:`Winner: ${t.winner||'—'}`,kind:'derive',testId:t.id});
  });
  state.tests.filter(t=>t.status==='draft').slice(0,3).forEach(t=>{
    items.push({priority:60,title:`${t.name} を公開`,detail:'下書き',kind:'publish',testId:t.id});
  });
  return items.sort((a,b)=>b.priority-a.priority).slice(0,5);
}
function renderExperimentQueue(){
  const box=$('#experimentQueue');
  if(!box)return;
  const items=experimentQueueItems();
  box.innerHTML=items.length?items.map((it,i)=>`<div class="listitem">
    <div class="option"><div><b>${i+1}. ${esc(it.title)}</b><div class="small">${esc(it.detail)}</div></div><span class="status">${it.kind==='derive'?'次案':it.kind==='publish'?'公開':'進行中'}</span></div>
  </div>`).join(''):'<div class="empty">キューは空です</div>';
}
function renderAdminDashboard(){
  normalizeAllStatuses();
  const running=state.tests.filter(t=>t.status==='running').length;
  const completed=state.tests.filter(t=>t.status==='completed').length;
  const total=state.sessions.filter(x=>x.status!=='aborted').length;
  $('#runningCount').textContent=running;
  $('#completedCount').textContent=completed;
  $('#adminTotalResponses').textContent=total;
  const a=deriveAdminAction();
  $('#nextActionShort').textContent=a.short||'—';
  $('#adminNextActionTitle').textContent=a.title;
  $('#adminNextActionText').textContent=a.text;
  const btn=$('#adminNextActionBtn');
  btn.disabled=false;
  btn.dataset.kind=a.kind||'';
  btn.dataset.testId=a.testId||'';
  btn.textContent=a.kind==='publish'?'公開する':a.kind==='inspect'?'分析を見る':a.kind==='suggest'?'次案を作る':'テストを作る';
}

function renderAdminTests(){
 normalizeAllStatuses();
 renderAdminDashboard();
 const box=$('#adminTestList');$('#testCount').textContent=state.tests.length;
 box.innerHTML=state.tests.length?state.tests.map(t=>`<div class="listitem"><div class="option"><div><b>${esc(t.name)}</b><div class="small">${esc(t.metric)} · v${t.version||1} · ${completedSessionsFor(t.id).length}回答 / ${t.targetResponses||30} · ${esc(t.type)}${t.winner?` · Winner ${t.winner}`:''}</div>${t.hypothesis?`<div class="small">仮説: ${esc(t.hypothesis)}</div>`:''}<div class="small">主指標: ${esc(metricLabel(t.successMetric))} · MDE ${t.minimumDetectableEffect||15}pt · Guardrail ${esc(t.guardrailMetric||'misclick')}</div>${tagList(t).length?`<div class="meta" style="margin-top:6px">${tagList(t).map(x=>`<span class="badge">${esc(x)}</span>`).join('')}</div>`:''}</div><span class="status">${statusLabel(t)}</span></div><div class="inline-actions"><button class="secondary toggle" data-id="${esc(t.id)}" type="button">${t.status==='running'?'停止':t.status==='completed'?'再開':'公開'}</button><button class="secondary archive" data-id="${esc(t.id)}" type="button">${t.status==='archived'?'戻す':'保管'}</button>${t.winner && t.winner!=='draw'?`<button class="secondary adopt" data-id="${esc(t.id)}" type="button">${t.adoptedWinner?'採用済み':'勝者を採用'}</button>`:''}<button class="secondary clone" data-id="${esc(t.id)}" type="button">複製</button><button class="danger del" data-id="${esc(t.id)}" type="button">削除</button></div></div>`).join(''):'<div class="empty">テストがありません</div>';
 $$('.toggle').forEach(b=>b.onclick=()=>{const t=state.tests.find(x=>x.id===b.dataset.id);if(!t)return;
 if(t.status!=='running'){const r=publishReadiness(t);if(!r.ok&&!confirm('公開前チェックに未達があります：\n・'+r.issues.join('\n・')+'\n\nこのまま公開しますか？'))return;}
   const before=JSON.stringify(state);
   if(t.status==='running'){t.status='draft';t.published=false;t.pausedRun=true;logTestEvent(t,'stopped');}
   else {const resume=t.pausedRun===true;t.status='running';t.published=true;t.pausedRun=false;if(!resume){t.winner=null;t.completedAt=null;t.adoptedWinner=null;t.adoptedAt=null;t.adoptionBasis=null;t.runEpoch='R-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);t.version=(t.version||1)+1;}logTestEvent(t,'published',resume?'resumed':'v'+t.version);}
   if(!save()){state=JSON.parse(before);return;}renderAdminTests();renderParticipant();renderExperimentQueue();toast(t.published?'公開しました':'停止しました')
 });
 
 
 $$('.archive').forEach(b=>b.onclick=()=>{
   const t=state.tests.find(x=>x.id===b.dataset.id);if(!t)return;
   const before=JSON.stringify(state);
   if(t.status==='archived'){t.status='draft';t.published=false;logTestEvent(t,'restored');appendDecisionLog(t.id,'再開準備','アーカイブから下書きへ戻した');}
   else {t.status='archived';t.published=false;logTestEvent(t,'archived');appendDecisionLog(t.id,'アーカイブ','検証を保管した');}
   if(!save()){state=JSON.parse(before);return;}renderAdminTests();renderParticipant();renderExperimentQueue();toast(t.status==='archived'?'保管しました':'下書きへ戻しました');
 });

 
 $$('.adopt').forEach(b=>b.onclick=()=>{
   const t=state.tests.find(x=>x.id===b.dataset.id);if(!t||!t.winner||t.winner==='draw')return;
   const before=JSON.stringify(state);
   t.adoptedWinner=t.winner;t.adoptedAt=new Date().toISOString();
   const sm=testSummary(t),h=testHealth(t);
   t.adoptionBasis={responses:sm.n,aRate:sm.aRate,bRate:sm.bRate,score:sm.avgScore,health:h.score,ts:new Date().toISOString()};
   logTestEvent(t,'adopted',`Winner ${t.winner}`);
   appendDecisionLog(t.id,'採用確定',`Winner ${t.winner} を採用 / n=${sm.n} / health=${h.score}`);
   if(!save()){state=JSON.parse(before);return;}renderAdminTests();renderLibrary();renderAdoptedPatterns();toast('勝者を採用パターンに登録しました');
 });

 $$('.clone').forEach(b=>b.onclick=()=>{
   const t=state.tests.find(x=>x.id===b.dataset.id); if(!t)return;
   const before=JSON.stringify(state);
   state.tests.push({...t,id:tid(),name:t.name+' コピー',published:false,status:'draft',winner:null,completedAt:null,adoptedWinner:null,adoptedAt:null,adoptionBasis:null,runEpoch:null,pausedRun:false,version:1,history:[{ts:new Date().toISOString(),event:'cloned',detail:'from '+t.id}]});
   if(!save()){state=JSON.parse(before);return;}renderAdminTests();renderLibrary();renderEloBoard();$('#testCount').textContent=state.tests.length;toast('複製しました');
 });

 $$('.del').forEach(b=>b.onclick=()=>{const t=state.tests.find(x=>x.id===b.dataset.id);if(!t||!confirm('削除しますか？'))return;const before=JSON.stringify(state);backupState('before test delete');state.tests=state.tests.filter(x=>x.id!==t.id);if(!save()){state=JSON.parse(before);return;}renderAdminTests();renderParticipant();toast('削除しました')});
}

function sessionQuality(x){
  let score=100;
  const reasons=[];
  const e=x.elapsed||0, fa=x.firstActionMs||0, mis=x.misclicks||0, taps=x.taps||0;
  if(e>0 && e<450){score-=45;reasons.push('速すぎる');}
  if(e>60000){score-=25;reasons.push('長時間');}
  if(fa>0 && fa<120){score-=25;reasons.push('初動が不自然');}
  if(mis>=5){score-=25;reasons.push('誤操作多い');}
  if(taps>=12){score-=15;reasons.push('連打傾向');}
  if(x.confidence!=null && (x.confidence||3)===1 && x.agree===false)score-=5;
  score=Math.max(0,score);
  return {score,valid:score>=60,reasons};
}
function weightedBRate(ss){
  if(!ss.length)return null;
  let b=0,total=0;
  ss.forEach(x=>{const w=Math.max(1,Math.min(5,Number(x.confidence||3)));total+=w;if(x.selected==='B')b+=w;});
  return total?Math.round(b/total*100):null;
}
function effectSizeRate(a,b){const n=a+b;return n?Math.round(Math.abs(a-b)/n*100):null;}
function appendDecisionLog(testId,label,detail){
  state.decisionLog=Array.isArray(state.decisionLog)?state.decisionLog:[];
  state.decisionLog.push({id:'D-'+Date.now().toString(36),testId,label,detail,ts:new Date().toISOString()});
  if(state.decisionLog.length>100)state.decisionLog=state.decisionLog.slice(-100);
}

function backupState(reason){
  state.backups=Array.isArray(state.backups)?state.backups:[];
  const payload={
    ts:new Date().toISOString(),
    reason,
    tests:JSON.parse(JSON.stringify(state.tests||[])),
    sessions:JSON.parse(JSON.stringify(state.sessions||[])),
    decisionLog:JSON.parse(JSON.stringify(state.decisionLog||[])),
    snapshots:JSON.parse(JSON.stringify(state.snapshots||[]))
  };
  state.backups.push(payload);
  if(state.backups.length>10)state.backups=state.backups.slice(-10);
}

function metricLabel(v){
  return ({selection:'選択率',speed:'決定時間',misclick:'誤操作',hesitation:'迷い時間',confidence:'行動確信度'})[v]||v||'選択率';
}
function testReportLine(t){
  const sm=testSummary(t),h=testHealth(t),d=decisionFor(sm,t);
  if(!sm.n)return `- ${t.name}: データ待ち`;
  const win=sm.a===sm.b?'互角':(sm.a>sm.b?'A':'B');
  const g=guardrailStatus(t);
  return `- ${t.name}: ${win} / A ${sm.aRate}%・B ${sm.bRate}% / n=${sm.n} / Health ${h.score}/100 / ${d.label} / Guardrail ${g.label}`;
}
function buildReportMarkdown(){
  const completed=state.sessions.filter(x=>x.status!=='aborted');
  const valid=completed.filter(x=>x.qualityValid===undefined?sessionQuality(x).valid:x.qualityValid);
  const adopted=state.tests.filter(t=>t.adoptedWinner);
  const lines=[];
  lines.push('# UX ARENA 実験レポート');
  lines.push('');
  lines.push(`生成日時: ${new Date().toLocaleString('ja-JP')}`);
  lines.push(`完了回答: ${completed.length} / 品質OK: ${valid.length}`);
  lines.push('');
  lines.push('## 結果');
  state.tests.filter(t=>t.status!=='archived').forEach(t=>lines.push(testReportLine(t)));
  lines.push('');
  lines.push('## 採用パターン');
  if(adopted.length) adopted.forEach(t=>lines.push(`- ${t.name}: ${t.adoptedWinner} を採用`));
  else lines.push('- まだありません');
  lines.push('');
  lines.push('## ベンチマーク');
  const bm=benchmarkRows();
  if(bm.length) lines.push(`- Best: ${bm[0].t.name} / Score ${bm[0].score} / Health ${bm[0].health}`);
  else lines.push('- データ待ち');
  lines.push('');
  lines.push('## 次アクション');
  const a=deriveAdminAction();
  lines.push(`- ${a.title}: ${a.text}`);
  return lines.join('\n');
}
function renderReport(){
  const box=$('#reportPreview');if(!box)return;
  const completed=state.sessions.filter(x=>x.status==='completed').length;
  if(!completed){box.textContent='データがたまると自動生成されます。';return;}
  const adopted=state.tests.filter(t=>t.adoptedWinner).length;
  const action=deriveAdminAction();
  box.innerHTML=`<b>${completed}回答 / 採用 ${adopted}件</b><div class="small" style="margin-top:6px">${esc(action.title)} — ${esc(action.text)}</div>`;
}

function currentAnalysisSnapshot(){
  const tests=state.tests.map(t=>{
    const sm=testSummary(t),h=testHealth(t),d=decisionFor(sm,t);
    return {
      id:t.id,name:t.name,status:t.status,metric:t.metric,hypothesis:t.hypothesis||'',successMetric:t.successMetric||'selection',targetResponses:t.targetResponses||30,minimumDetectableEffect:t.minimumDetectableEffect||15,guardrailMetric:t.guardrailMetric||'misclick',tags:tagList(t),
      responses:sm.n||0,aRate:sm.aRate??null,bRate:sm.bRate??null,medianMs:sm.medianMs??null,
      score:sm.avgScore??null,health:h.score??null,decision:d.label||'',winner:t.winner||null,
      adoptedWinner:t.adoptedWinner||null
    };
  });
  return {ts:new Date().toISOString(),qualityFilter,analysisFilter,tests};
}
function renderSnapshots(){
  const box=$('#snapshotList');if(!box)return;
  const rows=(state.snapshots||[]).slice(-5).reverse();
  box.innerHTML=rows.length?rows.map(s=>`<div class="listitem"><b>${esc((s.ts||'').slice(0,16).replace('T',' '))}</b><div class="small">${s.tests.length} tests · filter ${esc(s.analysisFilter||'all')} / ${esc(s.qualityFilter||'valid')}</div></div>`).join(''):'<div class="small">まだ保存されていません。</div>';
}

function renderDecisionLog(){
  const box=$('#decisionLog');if(!box)return;
  const rows=(state.decisionLog||[]).slice(-8).reverse();
  box.innerHTML=rows.length?rows.map(r=>{const t=state.tests.find(x=>x.id===r.testId);return `<div class="listitem"><b>${esc(r.label)}</b><div class="small">${esc(t?t.name:'全体')} · ${esc(r.detail||'')} · ${esc((r.ts||'').slice(0,16).replace('T',' '))}</div></div>`;}).join(''):'<div class="small">まだ判断履歴はありません。</div>';
}
function scoreSession(x){
  const speed=Math.max(0,100-Math.min(100,(x.elapsed||0)/80));
  const accuracy=Math.max(0,100-Math.min(100,(x.misclicks||0)*20));
  const decisiveness=Math.max(0,100-Math.min(100,(x.hesitation||0)/60));
  const confidence=Math.max(0,Math.min(100,((x.confidence||3)-1)/4*100));
  const consistency=x.agree?100:35;
  return Math.round(speed*.30+accuracy*.25+decisiveness*.20+consistency*.15+confidence*.10);
}
function median(arr){
  if(!arr.length)return 0;
  const a=[...arr].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function sideBias(ss){
  if(!ss.length)return null;
  const left=ss.filter(x=>x.chosenSide==='left').length;
  return Math.round(left/ss.length*100);
}
function testSummary(t){
  const ss=filteredTestSessions(t.id).filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B'));
  if(!ss.length)return {n:0};
  const a=ss.filter(x=>x.selected==='A').length,b=ss.length-a;
  const aSS=ss.filter(x=>x.selected==='A'),bSS=ss.filter(x=>x.selected==='B');
  const avgScore=Math.round(ss.reduce((s,x)=>s+scoreSession(x),0)/ss.length);
  const med=Math.round(median(ss.map(x=>x.elapsed||0)));
  return {
    n:ss.length,a,b,
    aRate:Math.round(a/ss.length*100),bRate:Math.round(b/ss.length*100),
    avgScore,medianMs:med,
    leftRate:sideBias(ss),
    agree:Math.round(100*ss.filter(x=>x.agree).length/ss.length),
    avgMis:(ss.reduce((s,x)=>s+(x.misclicks||0),0)/ss.length).toFixed(1),
    avgHes:Math.round(ss.reduce((s,x)=>s+(x.hesitation||0),0)/ss.length)
  };
}


function nextExperimentSuggestion(){
  const summaries=state.tests.map(t=>({t,sm:testSummary(t)})).filter(x=>x.sm.n>0);
  if(!summaries.length) return null;

  summaries.sort((a,b)=>b.sm.n-a.sm.n);
  const top=summaries[0], sm=top.sm, t=top.t;
  const elo=eloRatings();
  const rated=[];
  state.tests.forEach(tt=>{
    const rr=elo[tt.id]||{A:1500,B:1500};
    rated.push({test:tt,variant:'A',rating:rr.A});
    rated.push({test:tt,variant:'B',rating:rr.B});
  });
  rated.sort((a,b)=>b.rating-a.rating);
  const gap=Math.abs(sm.aRate-sm.bRate);
  const bias=Math.abs((sm.leftRate||50)-50);

  
  if(summaries.length>=2 && rated.length>=4 && summaries.reduce((z,x)=>z+x.sm.n,0)>=20){
    const r1=rated[0], r2=rated.find(x=>x.test.id!==r1.test.id) || rated[1];
    return {
      source:r1.test,
      name:'上位パターン決勝',
      task:r1.test.task,
      metric:'総合',
      type:r1.test.type,
      reason:`Elo上位の ${r1.test.name}/${r1.variant} と ${r2.test.name}/${r2.variant} を決勝比較し、集合知の上位を絞ります。`
    };
  }

  if(bias>=15){
    return {
      source:t,
      name:t.name+' 再検証',
      task:t.task,
      metric:t.metric,
      type:t.type,
      reason:`左右バイアスが ${sm.leftRate}% / ${100-sm.leftRate}% と大きいため、まず同条件で再検証します。`
    };
  }
  if(sm.n<10){
    return {
      source:t,
      name:t.name+' サンプル追加',
      task:t.task,
      metric:t.metric,
      type:t.type,
      reason:`回答数が ${sm.n} 件なので、結論を出す前にサンプルを増やします。`
    };
  }
  if(gap<10){
    const nextType=t.type==='cta'?'density':(t.type==='density'?'nav':'cta');
    const nextMetric=nextType==='cta'?'発見性':(nextType==='density'?'理解度':'操作速度');
    return {
      source:t,
      name:t.name+' 別軸検証',
      task:t.task,
      metric:nextMetric,
      type:nextType,
      reason:`A/B差が ${gap}pt と小さいため、同じ見た目を詰めるより別の設計軸を検証します。`
    };
  }
  const winner=sm.aRate>sm.bRate?'A':'B';
  return {
    source:t,
    name:t.name+' 勝者派生 '+winner,
    task:t.task,
    metric:t.metric,
    type:t.type,
    reason:`${winner} が ${Math.max(sm.aRate,sm.bRate)}% で優勢です。勝者を基準に、1要素だけ変えた派生案で次の検証を行います。`
  };
}


let analysisFilter='all';
let qualityFilter='valid';
function filteredSessions({includeTimeout=false}={}){
  let s=state.sessions.filter(x=>isCurrentRunSession(x) && ((includeTimeout && x.status==='timeout') || (x.status==='completed' && (x.selected==='A'||x.selected==='B') && (!x.runnerVersion || Number(x.elapsed)<=RUNNER_LIMIT))));
  if(qualityFilter==='valid')s=s.filter(x=>x.qualityValid===undefined?sessionQuality(x).valid:x.qualityValid);
  return analysisFilter==='all'?s:s.filter(x=>(x.experience||'standard')===analysisFilter);
}
function filteredTestSessions(id){
  return filteredSessions().filter(s=>s.testId===id);
}


function wilsonInterval(success,total,z=1.96){
  if(!total)return null;
  const p=success/total, z2=z*z;
  const center=(p+z2/(2*total))/(1+z2/total);
  const margin=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/(1+z2/total);
  return {low:Math.max(0,center-margin),high:Math.min(1,center+margin)};
}
function significanceLabel(sm){
  if(!sm.n || sm.n<10)return 'サンプル不足';
  const win=Math.max(sm.a,sm.b);
  const ci=wilsonInterval(win,sm.n);
  if(!ci)return '判定保留';
  if(ci.low>0.5)return '優勢傾向あり';
  return '差はまだ不明確';
}
function placementBalance(ss){
  if(!ss.length)return {leftA:0,leftB:0,diff:0};
  const leftA=ss.filter(x=>x.leftVariant==='A').length;
  const leftB=ss.filter(x=>x.leftVariant==='B').length;
  return {leftA,leftB,diff:Math.abs(leftA-leftB)};
}
function renderHistory(){
  const box=$('#historyList');
  const rows=state.sessions.filter(x=>x.status!=='aborted').slice(-5).reverse();
  if(!rows.length){box.innerHTML='<div class="empty">まだ回答がありません</div>';return}
  box.innerHTML=rows.map(s=>{
    const t=state.tests.find(x=>x.id===s.testId);
    return `<div class="listitem"><b>${esc(t?t.name:'削除済みテスト')}</b><div class="small">${s.selected||'—'}選択 · ${((s.elapsed||0)/1000).toFixed(1)}s · ${s.agree?'主観一致':'主観不一致'}</div></div>`;
  }).join('');
}


function effectSize(sm){
  if(!sm || !sm.n)return 0;
  return Math.abs((sm.aRate||50)-(sm.bRate||50));
}


function estimateSampleSize(mdePt){
  const d=Math.max(0.05,Math.min(0.40,Number(mdePt||15)/100));
  // two-proportion approximation around p=.5, alpha .05 / power .80
  const zAlpha=1.96,zBeta=0.84,p=.5;
  const n=(2*Math.pow(zAlpha*Math.sqrt(2*p*(1-p))+zBeta*Math.sqrt(p*(1-p)+p*(1-p)),2))/Math.pow(d,2);
  return Math.max(20,Math.min(500,Math.ceil(n)));
}
function guardrailStatus(t){
  const ss=completedSessionsFor(t.id);
  if(ss.length<4 || !t.guardrailMetric || t.guardrailMetric==='none')return {label:'データ待ち',ok:null};
  const a=ss.filter(x=>x.selected==='A'),b=ss.filter(x=>x.selected==='B');
  if(!a.length||!b.length)return {label:'データ待ち',ok:null};
  const avg=(arr,key)=>arr.reduce((s,x)=>s+(x[key]||0),0)/arr.length;
  let av,bv,unit='';
  if(t.guardrailMetric==='misclick'){av=avg(a,'misclicks');bv=avg(b,'misclicks');unit='';}
  else if(t.guardrailMetric==='speed'){av=avg(a,'elapsed');bv=avg(b,'elapsed');unit='ms';}
  else {av=avg(a,'hesitation');bv=avg(b,'hesitation');unit='ms';}
  const winner=(a.length>b.length)?'A':(b.length>a.length?'B':null);
  if(!winner)return {label:'勝者未確定',ok:null};
  const wv=winner==='A'?av:bv,lv=winner==='A'?bv:av;
  const ok=wv<=lv*1.10;
  return {label:ok?'問題なし':'悪化注意',ok,detail:`A ${Math.round(av)}${unit} / B ${Math.round(bv)}${unit}`};
}
function experimentDesignIssues(t){
  const issues=[];
  if(!t.hypothesis)issues.push('仮説未設定');
  if(!t.successMetric)issues.push('主評価指標なし');
  if(!t.targetResponses || t.targetResponses<10)issues.push('終了条件が弱い');
  const recommended=estimateSampleSize(t.minimumDetectableEffect||15);
  if((t.targetResponses||30)<recommended)issues.push(`必要目安 ${recommended}回答に未達`);
  if(!t.guardrailMetric || t.guardrailMetric==='none')issues.push('ガードレール未設定');
  return {issues,recommended};
}
function renderDesignCheck(){
  const box=$('#designCheck');if(!box)return;
  const rows=state.tests.filter(t=>t.status!=='archived');
  box.innerHTML=rows.length?rows.map(t=>{
    const c=experimentDesignIssues(t),g=guardrailStatus(t);
    return `<div class="listitem">
      <div class="option"><div><b>${esc(t.name)}</b><div class="small">${c.issues.length?esc(c.issues.join(' / ')):'設計OK'} · 推奨 ${c.recommended}回答</div></div><span class="status">${g.label}</span></div>
      ${g.detail?`<div class="small">Guardrail: ${esc(g.detail)}</div>`:''}
    </div>`;
  }).join(''):'<div class="small">テストがありません。</div>';
}
function renderCohortMatrix(){
  const box=$('#cohortMatrix');if(!box)return;
  const tests=state.tests.filter(t=>t.status!=='archived').slice(0,6);
  if(!tests.length){box.innerHTML='<div class="small">データ待ち</div>';return;}
  const labels=[['beginner','初心者'],['standard','ふつう'],['advanced','慣れている']];
  let html='<div class="matrix"><div class="head">テスト</div>'+labels.map(x=>`<div class="head">${x[1]}</div>`).join('');
  tests.forEach(t=>{
    html+=`<div><b>${esc(t.name)}</b></div>`;
    labels.forEach(([key])=>{
      const ss=completedSessionsFor(t.id).filter(x=>(x.experience||'standard')===key);
      if(!ss.length){html+='<div>—</div>';return;}
      const a=ss.filter(x=>x.selected==='A').length,b=ss.length-a;
      const win=a===b?'draw':(a>b?'winA':'winB');
      const label=a===b?'互角':(a>b?`A ${Math.round(a/ss.length*100)}%`:`B ${Math.round(b/ss.length*100)}%`);
      html+=`<div class="${win}">${label}<div class="small">n=${ss.length}</div></div>`;
    });
  });
  html+='</div>';
  box.innerHTML=html;
}

function testHealth(t){
  const ss=completedSessionsFor(t.id);
  const n=ss.length;
  if(!n)return {score:0,label:'データ待ち',issues:['回答なし']};
  const completionBase=Math.min(100,n/30*100);
  const side=sideBias(ss);
  const sidePenalty=Math.min(100,Math.abs((side||50)-50)*4);
  const placement=placementBalance(ss);
  const placementPenalty=Math.min(100,placement.diff*8);
  const aborts=state.sessions.filter(x=>x.testId===t.id && isCurrentRunSession(x) && x.status==='aborted').length;
  const completionRate=n+aborts? n/(n+aborts)*100:100;
  const score=Math.max(0,Math.round(
    completionBase*.35 +
    completionRate*.30 +
    (100-sidePenalty)*.20 +
    (100-placementPenalty)*.15
  ));
  const issues=[];
  if(n<10)issues.push('サンプル不足');
  if(completionRate<80)issues.push('中断多め');
  if(Math.abs((side||50)-50)>=15)issues.push('位置バイアス');
  if(placement.diff>=3)issues.push('配置偏り');
  return {score,label:score>=80?'良好':score>=60?'要観察':'要改善',issues,completionRate:Math.round(completionRate)};
}
function segmentSummaryForTest(t){
  const ss=completedSessionsFor(t.id);
  const groups={beginner:[],standard:[],advanced:[]};
  ss.forEach(x=>(groups[x.experience||'standard']||groups.standard).push(x));
  const rate=g=>{
    if(!g.length)return null;
    return Math.round(g.filter(x=>x.selected==='B').length/g.length*100);
  };
  return {beginner:rate(groups.beginner),standard:rate(groups.standard),advanced:rate(groups.advanced),
          counts:{beginner:groups.beginner.length,standard:groups.standard.length,advanced:groups.advanced.length}};
}
function personalizationInsight(t){
  const s=segmentSummaryForTest(t);
  const pairs=[
    ['初心者',s.beginner,s.counts.beginner],
    ['ふつう',s.standard,s.counts.standard],
    ['慣れている',s.advanced,s.counts.advanced]
  ].filter(x=>x[1]!==null && x[2]>=3);
  if(pairs.length<2)return null;
  let min=pairs[0],max=pairs[0];
  pairs.forEach(p=>{if(p[1]<min[1])min=p;if(p[1]>max[1])max=p;});
  const gap=max[1]-min[1];
  if(gap<20)return null;
  return {gap,text:`${max[0]}はBを${max[1]}%選択、${min[0]}は${min[1]}%。${gap}pt差があり、UIの出し分け候補です。`};
}
function behavioralConfidenceSession(x){
  const speed=Math.max(0,100-Math.min(100,(x.elapsed||0)/80));
  const hesitation=Math.max(0,100-Math.min(100,(x.hesitation||0)/60));
  const first=Math.max(0,100-Math.min(100,(x.firstActionMs||0)/40));
  const consistency=x.agree?100:45;
  return Math.round(speed*.25+hesitation*.25+first*.20+consistency*.30);
}
function renderHealth(){
  const box=$('#healthSummary'); if(!box)return;
  const rows=state.tests.filter(t=>t.status!=='archived').map(t=>({t,h:testHealth(t)}))
    .sort((a,b)=>a.h.score-b.h.score);
  box.innerHTML=rows.length?rows.map(({t,h})=>`<div class="listitem">
    <div class="option"><div><b>${esc(t.name)}</b><div class="small">${h.issues.length?esc(h.issues.join(' / ')):'問題なし'} · 完了率 ${h.completionRate??'—'}%</div></div><span class="status">${h.score} / 100</span></div>
    <div class="bar"><i style="width:${h.score}%"></i></div>
  </div>`).join(''):'<div class="empty">データ待ち</div>';
}
function renderSegmentInsights(){
  const box=$('#segmentInsights'); if(!box)return;
  const insights=state.tests.map(t=>({t,ins:personalizationInsight(t)})).filter(x=>x.ins).sort((a,b)=>b.ins.gap-a.ins.gap);
  box.innerHTML=insights.length?insights.map(({t,ins})=>`<div class="listitem"><b>${esc(t.name)}</b><div class="small">${esc(ins.text)}</div></div>`).join(''):'<div class="small">十分なセグメント差はまだ確認できません。</div>';
}

function tagList(t){
  if(Array.isArray(t.tags))return t.tags;
  if(typeof t.tags==='string')return t.tags.split(',').map(x=>x.trim()).filter(Boolean);
  return [];
}
function benchmarkRows(){
  return state.tests.filter(t=>t.status!=='archived').map(t=>{
    const sm=testSummary(t),h=testHealth(t);
    return {t,n:sm.n||0,score:sm.avgScore||0,health:h.score||0,speed:sm.medianMs||0,winner:sm.a===sm.b?'draw':(sm.a>sm.b?'A':'B')};
  }).filter(x=>x.n>0).sort((a,b)=>(b.score+b.health)-(a.score+a.health));
}
function renderBenchmark(){
  const box=$('#benchmarkPanel');if(!box)return;
  const rows=benchmarkRows();
  if(!rows.length){box.innerHTML='<div class="small">データ待ち</div>';return;}
  const best=rows[0];
  box.innerHTML=rows.slice(0,5).map((r,i)=>{
    const deltaScore=r.score-best.score;
    const deltaSpeed=(best.speed&&r.speed)?Math.round((r.speed-best.speed)/100)/10:null;
    return `<div class="listitem"><div class="option"><div><b>${i+1}. ${esc(r.t.name)}</b><div class="small">Score ${r.score} · Health ${r.health} · Winner ${r.winner}</div></div><span class="status">${i===0?'BEST':(deltaScore===0?'±0':deltaScore)}</span></div>${deltaSpeed!==null?`<div class="small">Best比 決定時間 ${deltaSpeed>0?'+':''}${deltaSpeed}s</div>`:''}</div>`;
  }).join('');
}
function renderTemplateLibrary(){
  const box=$('#templateLibrary');if(!box)return;
  const rows=state.tests.filter(t=>t.adoptedWinner);
  if(!rows.length){box.innerHTML='<div class="small">採用パターンがたまると再利用テンプレートになります。</div>';return;}
  box.innerHTML=rows.map(t=>{
    const sm=testSummary(t),h=testHealth(t),tags=tagList(t);
    return `<div class="listitem"><div class="option"><div><b>${esc(t.name)} / ${esc(t.adoptedWinner)}</b><div class="small">${esc(t.metric)} · Score ${sm.avgScore||0} · Health ${h.score||0}</div></div><button class="secondary reuseTemplate" data-id="${esc(t.id)}" type="button" style="width:auto">再利用</button></div><div class="meta" style="margin-top:8px">${tags.length?tags.map(x=>`<span class="badge">${esc(x)}</span>`).join(''):'<span class="badge">未タグ</span>'}</div></div>`;
  }).join('');
  $$('.reuseTemplate').forEach(b=>b.onclick=()=>{
    const src=state.tests.find(x=>x.id===b.dataset.id);if(!src)return;
    state.tests.push({...src,id:tid(),name:src.name+' 派生',published:false,status:'draft',winner:null,completedAt:null,adoptedWinner:null,adoptedAt:null,adoptionBasis:null,runEpoch:null,pausedRun:false,version:1,history:[{ts:new Date().toISOString(),event:'template_reuse',detail:'from '+src.id}]});
    save();renderAdminTests();renderTemplateLibrary();toast('再利用テストを下書き作成しました');
  });
}

function renderAdoptedPatterns(){
  const box=$('#adoptedPatterns'); if(!box)return;
  const rows=state.tests.filter(t=>t.adoptedWinner);
  box.innerHTML=rows.length?rows.map(t=>`<div class="listitem"><div class="option"><div><b>${esc(t.name)} / ${esc(t.adoptedWinner)}</b><div class="small">${esc(t.metric)} · 採用 ${esc((t.adoptedAt||'').slice(0,10))}</div></div><span class="status">採用済み</span></div></div>`).join(''):'<div class="small">まだ採用確定したパターンはありません。</div>';
}

function decisionFor(sm,t){
  if(!sm || !sm.n)return {label:'データ待ち',cls:'quality-warn',text:'回答を集めてから判断します。'};
  if(t){
    const h=testHealth(t);
    if(h.score<55)return {label:'品質改善',cls:'quality-bad',text:`テスト健全度が ${h.score}/100 です。勝敗判断より実験条件の改善を優先します。`};
  }
  const gap=effectSize(sm), bias=Math.abs((sm.leftRate||50)-50);
  if(bias>=15)return {label:'再検証',cls:'quality-bad',text:`位置バイアスが ${bias}pt あります。勝敗判定より先に再検証が必要です。`};
  if(sm.n<10)return {label:'継続',cls:'quality-warn',text:`${sm.n}回答です。最低10回答までは結論を保留します。`};
  const sig=significanceLabel(sm);
  if(sig==='優勢傾向あり')return {label:'採用候補',cls:'quality-good',text:`差 ${gap}pt。優勢傾向が確認できるため、勝者を次ラウンドへ進められます。`};
  if(gap<10)return {label:'別軸検証',cls:'quality-warn',text:`差は ${gap}pt。ほぼ互角なので、別の設計軸を試す方が有効です。`};
  return {label:'継続',cls:'quality-warn',text:`差は ${gap}pt ありますが信頼区間が重なります。サンプル追加を推奨します。`};
}
function renderDecisionSummary(ranked){
  const box=$('#decisionSummary'); if(!box)return;
  const top=(ranked||[]).find(x=>x.sm&&x.sm.n);
  if(!top){box.className='callout quality-warn';box.textContent='データ待ちです。';return;}
  const d=decisionFor(top.sm,top.t);
  box.className='callout '+d.cls;
  box.innerHTML=`<b>${esc(top.t.name)}：${d.label}</b><div class="small">${esc(d.text)}</div>`;
}
function generateDemoData(){
  const experiences=['beginner','standard','advanced'];
  const now=Date.now();
  state.tests.forEach((t,ti)=>{
    const existing=completedSessionsFor(t.id).length;
    const add=Math.max(0,18-existing);
    for(let i=0;i<add;i++){
      const preferB = t.type==='cta' ? 0.68 : t.type==='density' ? 0.56 : 0.62;
      const sel=Math.random()<preferB?'B':'A';
      const leftA=Math.random()<0.5;
      const leftVariant=leftA?'A':'B', rightVariant=leftA?'B':'A';
      const elapsed=Math.round(1500+Math.random()*2800+(sel==='A'?250:0));
      const mis=Math.random()<0.72?0:(Math.random()<0.8?1:2);
      const hes=Math.round(250+Math.random()*1600);
      state.sessions.push({id:'D-'+ti+'-'+i+'-'+Math.random().toString(36).slice(2,6),testId:t.id,ts:new Date(now-(add-i)*60000).toISOString(),status:'completed',runEpoch:t.runEpoch||null,selected:sel,pref:Math.random()<0.78?sel:(sel==='A'?'B':'A'),firstTouch:Math.random()<0.54?sel:(sel==='A'?'B':'A'),elapsed,taps:1+mis,misclicks:mis,hesitation:hes,firstActionMs:400+Math.floor(Math.random()*1200),postFirstDecisionMs:Math.max(300,elapsed-800),confidence:3+Math.floor(Math.random()*3),agree:Math.random()<0.78,leftVariant,rightVariant,chosenSide:sel===leftVariant?'left':'right',experience:experiences[Math.floor(Math.random()*experiences.length)],device:'mobile'});
    }
  });
  save();refreshAll();renderParticipant();toast('デモデータを生成しました');
}


// v25: never pool unrelated experiments into a single convergence claim.
function intuitionMetrics(rows){
 const ss=rows.filter(x=>x.runnerVersion>=22 && (x.status==='completed'||x.status==='timeout')).slice().sort((a,b)=>String(a.ts||'').localeCompare(String(b.ts||'')) || String(a.id||'').localeCompare(String(b.id||'')));
 const complete=ss.filter(x=>x.status==='completed' && (x.selected==='A'||x.selected==='B') && Number(x.elapsed)>0 && Number(x.elapsed)<=10000);
 const n=ss.length,valid=complete.length; const participants=new Set(complete.map(x=>x.participantId).filter(Boolean)).size; const unknownParticipants=complete.filter(x=>!x.participantId).length;
 const med=arr=>{if(!arr.length)return null;const a=arr.slice().sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2};
 const windows=[];for(let i=0;i+16<=valid;i+=16){const part=complete.slice(i,i+16);windows.push(part.filter(x=>x.selected==='B').length/16)}
 const recent=windows.slice(-3),drift=recent.length===3?Math.max(...recent)-Math.min(...recent):null;
 const early=windows.length>=6?windows.slice(0,3).reduce((a,b)=>a+b,0)/3:null;
 const late=recent.length===3?recent.reduce((a,b)=>a+b,0)/3:null;
 const reversed=early!==null&&late!==null&&Math.abs(early-.5)>=.2&&Math.abs(late-.5)>=.2&&(early-.5)*(late-.5)<0;
 const sideCount=complete.filter(x=>x.chosenSide==='left'||x.chosenSide==='right');
 const leftRate=sideCount.length?sideCount.filter(x=>x.chosenSide==='left').length/sideCount.length:null;
 const leftA=complete.filter(x=>x.leftVariant==='A').length,imbalance=valid?Math.abs(2*leftA-valid)/valid:null;
 // A left-choice preference is not automatically a position effect: compare conditional rates.
 const aLeft=complete.filter(x=>x.leftVariant==='A'),bLeft=complete.filter(x=>x.leftVariant==='B');
 const aRate=aLeft.length?aLeft.filter(x=>x.chosenSide==='left').length/aLeft.length:null;
 const bRate=bLeft.length?bLeft.filter(x=>x.chosenSide==='left').length/bLeft.length:null;
 const positionEffect=aRate!==null&&bRate!==null?(aRate+bRate-1):null;
 const biased=positionEffect!==null&&aLeft.length>=8&&bLeft.length>=8&&Math.abs(positionEffect)>.2;
 const participantCounts=Object.values(complete.reduce((acc,x)=>{if(x.participantId)acc[x.participantId]=(acc[x.participantId]||0)+1;return acc},{}));
 const maxParticipantShare=valid&&participantCounts.length?Math.max(...participantCounts)/valid:1;
 const participantGroups=Object.values(complete.reduce((acc,x)=>{if(x.participantId)(acc[x.participantId]??=[]).push(x);return acc},{}));
 const participantBRate=participantGroups.length?participantGroups.reduce((sum,g)=>sum+g.filter(x=>x.selected==='B').length/g.length,0)/participantGroups.length:null;
 const participantRateDetails=participantGroups.map(g=>g.filter(x=>x.selected==='B').length/g.length);
 const participantDispersion=participantRateDetails.length>=2?Math.sqrt(participantRateDetails.reduce((sum,p)=>sum+(p-participantBRate)**2,0)/(participantRateDetails.length-1)):null;
 const participantSpread=participantGroups.length>=2?Math.max(...participantGroups.map(g=>g.filter(x=>x.selected==='B').length/g.length))-Math.min(...participantGroups.map(g=>g.filter(x=>x.selected==='B').length/g.length)):null;
 const globalDrift=windows.length>=6?Math.abs(windows.slice(0,3).reduce((a,b)=>a+b,0)/3-late):null;
 const leftover=valid%16; // A partial latest window must not silently count as stability evidence.
 const trailing=leftover?complete.slice(-leftover):[];
 const trailingRate=trailing.length?trailing.filter(x=>x.selected==='B').length/trailing.length:null;
 const trailingShift=trailing.length>=8&&late!==null?Math.abs(trailingRate-late):null;
 // A descriptive signal is separate from the conservative convergence decision.
 const tendency=valid>=48&&participants>=8&&unknownParticipants===0&&maxParticipantShare<=.25&&late!==null&&Math.abs(late-.5)>=.2&&participantBRate!==null&&Math.abs(participantBRate-.5)>=.2&&Math.sign(participantBRate-.5)===Math.sign(late-.5)&&!reversed&&!biased&&imbalance!==null&&imbalance<=.2;
 // Conservative, participant-aware Wilson lower bound is descriptive evidence, not a significance test.
 const z=1.96;
 const participantVotes=participantGroups.map(g=>g.filter(x=>x.selected==='B').length/g.length);
 const effectiveN=participantVotes.length;
 const participantMean=effectiveN?participantVotes.reduce((a,b)=>a+b,0)/effectiveN:null;
 const wilsonLower=(p,n)=>{if(!n)return null;const d=1+z*z/n;return (p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/d};
 const wilsonUpper=(p,n)=>{if(!n)return null;const d=1+z*z/n;return (p+z*z/(2*n)+z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/d};
 const evidence=participantMean===null?'insufficient':wilsonLower(participantMean,effectiveN)>.5?'B':wilsonUpper(participantMean,effectiveN)<.5?'A':'uncertain';
 // Allow small natural window fluctuations; require a consistent long-run direction.
 const stable=globalDrift!==null&&globalDrift<=.19&&valid>=96&&participants>=8&&maxParticipantShare<=.25&&unknownParticipants===0&&drift!==null&&drift<=.19&&Math.abs(late-.5)>=.2&&participantBRate!==null&&Math.abs(participantBRate-.5)>=.2&&Math.sign(participantBRate-.5)===Math.sign(late-.5)&&!reversed&&!biased&&imbalance<=.2&&n-valid<=n*.2&&aLeft.length>=16&&bLeft.length>=16&&(trailingShift===null||trailingShift<=.2);

 return {participantDispersion,remainingToReview:Math.max(0,96-valid),n,valid,participants,unknownParticipants,maxParticipantShare,median:med(complete.map(x=>Number(x.elapsed)||0)),timeout:ss.filter(x=>x.status==='timeout').length,within:n?valid/n:null,leftRate,positionEffect,imbalance,reversed,biased,stable,tendency,drift,windowCount:windows.length,late,globalDrift,participantBRate,participantSpread,leftover,trailingRate,trailingShift,evidence,effectiveN};
}
function renderIntuitionPanel(){
 const el=$('#intuitionPanel');if(!el)return;
 const rows=filteredSessions({includeTimeout:true}).filter(x=>x.runnerVersion>=22 && (x.status==='completed'||x.status==='timeout'));
 const ids=(state.tests||[]).filter(t=>t.status!=='archived').map(t=>String(t.id));
 const query=String($('#intuitionSearch')?.value||'').trim().toLocaleLowerCase();
 const statusFilter=$('#intuitionStatus')?.value||'all';
 const fmt=v=>v===null||!Number.isFinite(v)?'—':Math.round(v*100)+'%';
 const overview={tests:0,stable:0,warnings:0,valid:0};
 const panels=ids.map(id=>{
   const test=(state.tests||[]).find(x=>String(x.id)===id);
   const m=intuitionMetrics(rows.filter(x=>String(x.testId||'')===id));
   overview.tests++;overview.valid+=m.valid;
   if(m.stable)overview.stable++;
   if(m.reversed||m.biased||(m.imbalance!==null&&m.imbalance>.2))overview.warnings++;
   if(query&&!([test?.name,test?.title,...(Array.isArray(test?.tags)?test.tags:[])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)))return null;
   const warning=m.reversed||m.biased||(m.imbalance!==null&&m.imbalance>.2);
   if(statusFilter==='warning'&&!warning)return null;
   if(statusFilter==='stable'&&!m.stable)return null;
   if(statusFilter==='observing'&&(warning||m.stable))return null;
   const status=m.reversed?'選好反転を検出':m.biased?'左右バイアス要確認':m.imbalance!==null&&m.imbalance>.2?'左右配置が不均衡':m.stable?'暫定的に安定':m.tendency?'選好傾向あり・追試':'観測中';
   const primary=[['判定',status],['有効選択',m.valid+'件'],['反応時間中央値',m.median===null?'—':(m.median/1000).toFixed(2)+'秒'],['有効選択率',fmt(m.within)]];
   const secondary=[['識別できる参加者',m.participants+'人'],['最多参加者の回答比率',fmt(m.maxParticipantShare)],['10秒超過 / 無選択',m.timeout+'件'],['参加者均等B選択率',fmt(m.participantBRate)],['参加者間の選択率幅',fmt(m.participantSpread)],['参加者間の選択率標準偏差',fmt(m.participantDispersion)],['暫定安定の必要数まで',m.remainingToReview+'件'],['推定位置効果',fmt(m.positionEffect)],['前後の選択率変化',fmt(m.globalDrift)],['端数区間の回答数',m.leftover+'件'],['端数区間の選択率変化',fmt(m.trailingShift)]];
   const note=m.valid<96?'96件以上の有効選択が必要です（16件×6区間）。':m.unknownParticipants>0?'参加者IDのない旧回答を含むため、収束確定を保留します。':m.participants<8?'8人以上の参加者が必要です。':m.maxParticipantShare>.25?'一人の回答が25%を超えています。':m.participantBRate!==null&&m.late!==null&&Math.sign(m.participantBRate-.5)!==Math.sign(m.late-.5)?'回答単位と参加者単位で選択傾向が異なります。':m.trailingShift!==null&&m.trailingShift>.2?'直近の端数回答で傾向が変化しています。':m.reversed?'選択傾向が反転しています。':m.biased?'左右の位置効果を再検証してください。':m.stable?'探索的な安定傾向です。参加者間のばらつきと追試結果を確認してください。':m.tendency?'選好方向は見えていますが、収束条件を満たしていません。回答を追加してください。':'回答と配置条件を継続観測してください。';
   const urgency=warning?0:m.valid<96?1:m.stable?3:2;
   const metric=items=>items.map(([k,v])=>'<div class="insight-metric"><span>'+esc(k)+'</span><strong>'+esc(String(v))+'</strong></div>').join('');
   return {urgency,html:'<section class="intuition-experiment"><h3>'+esc(test?.name||test?.title||id)+'</h3><div class="insight-grid">'+metric(primary)+'</div><p class="insight-note">'+esc(note)+'</p><details><summary>計測品質と補助指標</summary><div class="insight-grid">'+metric(secondary)+'</div></details></section>'};
 }).filter(Boolean).sort((a,b)=>a.urgency-b.urgency).map(x=>x.html);
 const stats=$('#analysisOverviewStats');if(stats)stats.innerHTML=[['対象実験',overview.tests],['有効選択',overview.valid],['暫定安定',overview.stable],['要確認',overview.warnings]].map(([label,value])=>'<div class="overview-metric"><span>'+label+'</span><strong>'+value+'</strong></div>').join('');
 el.innerHTML='<b>実験別の直感選択</b><p class="small">要確認 → 回答不足 → 観測中 → 暫定安定の順に表示。勝者確定ではありません。</p>'+(panels.length?panels.join(''):'<p class="small">該当する実験がありません。</p>');
}
function renderAnalysis(){
 renderIntuitionPanel();
 const s=filteredSessions();
 const completedAll=state.sessions.filter(x=>x.status==='completed').length;
 const abortedAll=state.sessions.filter(x=>x.status==='aborted'||x.status==='timeout').length;
 const completionRate=(completedAll+abortedAll)?Math.round(completedAll/(completedAll+abortedAll)*100):0;
 const bias=sideBias(s);
 const placement=placementBalance(s);
 $('#qualitySummary').innerHTML=s.length
   ? `<b>${completionRate}% 完了</b><div class="small">左選択 ${bias}% · 左配置 A/B ${placement.leftA}/${placement.leftB} · 配置差 ${placement.diff}</div>`
   : '<div class="small">データ待ち</div>';
 $('#totalResponses').textContent=s.length;
 if(s.length){
   $('#globalAvg').textContent=(s.reduce((a,x)=>a+x.elapsed,0)/s.length/1000).toFixed(1)+'s';
   $('#globalMisclick').textContent=(s.reduce((a,x)=>a+(x.misclicks||0),0)/s.length).toFixed(1);
   $('#globalAgree').textContent=Math.round(100*s.filter(x=>x.agree).length/s.length)+'%';
   $('#leftRate').textContent=Math.round(100*s.filter(x=>x.chosenSide==='left').length/s.length)+'%';
   $('#globalScore').textContent=Math.round(s.reduce((a,x)=>a+scoreSession(x),0)/s.length);$('#weightedBRate').textContent=weightedBRate(s)+'%';$('#outlierCount').textContent=state.sessions.filter(x=>x.status!=='aborted' && !(x.qualityValid===undefined?sessionQuality(x).valid:x.qualityValid)).length;
 }else{
   $('#globalAvg').textContent=$('#globalMisclick').textContent=$('#globalAgree').textContent=$('#leftRate').textContent=$('#globalScore').textContent=$('#weightedBRate').textContent='—';$('#outlierCount').textContent=state.sessions.filter(x=>x.status!=='aborted' && !(x.qualityValid===undefined?sessionQuality(x).valid:x.qualityValid)).length;
 }
 const ranked=state.tests.map(t=>{
   const ss=filteredTestSessions(t.id);
   let sm={n:0};
   if(ss.length){
     const a=ss.filter(x=>x.selected==='A').length,b=ss.length-a;
     sm={n:ss.length,a,b,aRate:Math.round(a/ss.length*100),bRate:Math.round(b/ss.length*100),
       avgScore:Math.round(ss.reduce((z,x)=>z+scoreSession(x),0)/ss.length),
       medianMs:Math.round(median(ss.map(x=>x.elapsed||0))),
       leftRate:sideBias(ss),
       agree:Math.round(100*ss.filter(x=>x.agree).length/ss.length),
       avgMis:(ss.reduce((z,x)=>z+(x.misclicks||0),0)/ss.length).toFixed(1),
       avgHes:Math.round(ss.reduce((z,x)=>z+(x.hesitation||0),0)/ss.length)};
   }
   return {t,sm};
 }).sort((x,y)=>(y.sm.avgScore||0)-(x.sm.avgScore||0));
 $('#analysisList').innerHTML=ranked.map((o,i)=>{
   const t=o.t,sm=o.sm;
   if(!sm.n) return `<div class="listitem"><div class="rank"><div class="ranknum">${i+1}</div><div><b>${esc(t.name)}</b><div class="small">データ待ち</div></div></div></div>`;
   const bias=Math.abs((sm.leftRate||50)-50)>=15?'位置バイアス注意':'位置バイアス小';
   const winnerCount=Math.max(sm.a,sm.b);
   const ci=wilsonInterval(winnerCount,sm.n);
   const ciText=ci?`${Math.round(ci.low*100)}–${Math.round(ci.high*100)}%`:'—';
   const sig=significanceLabel(sm);
   return `<div class="listitem"><div class="rank"><div class="ranknum">${i+1}</div><div style="flex:1;min-width:0">
     <b>${esc(t.name)} <span class="status">Score ${sm.avgScore}</span></b>
     <div class="small">${sm.n}回答 · A ${sm.aRate}% / B ${sm.bRate}% · 中央値 ${(sm.medianMs/1000).toFixed(1)}s</div>
     <div class="small">勝者95%CI ${ciText} · ${sig} · 効果差 ${effectSize(sm)}pt</div>
     <div class="small">誤操作 ${sm.avgMis} · 主観一致 ${sm.agree}% · 左選択 ${sm.leftRate}% · ${bias}</div>
     <div class="bar"><i style="width:${Math.max(sm.aRate,sm.bRate)}%"></i></div>
   </div></div></div>`;
 }).join('')||'<div class="empty">データなし</div>';
 renderDecisionSummary(ranked);
 const sug=nextExperimentSuggestion();
 if(sug){
   $('#nextExperimentTitle').textContent=sug.name;
   $('#nextExperimentText').textContent=sug.reason;
   $('#createSuggestedTest').disabled=false;
   $('#createSuggestedTest').dataset.name=sug.name;
   $('#createSuggestedTest').dataset.task=sug.task;
   $('#createSuggestedTest').dataset.metric=sug.metric;
   $('#createSuggestedTest').dataset.type=sug.type;
 }else{
   $('#nextExperimentTitle').textContent='次の検証候補';
   $('#nextExperimentText').textContent='データがたまると、次に比較すべき案を自動提案します。';
   $('#createSuggestedTest').disabled=true;
 }
}

function eloRatings(){
  const ratings={};
  state.tests.forEach(t=>{ratings[t.id]={A:1500,B:1500};});
  const sessions=state.sessions.filter(x=>isCurrentRunSession(x) && x.status!=='aborted' && x.selected && ratings[x.testId]);
  sessions.forEach(s=>{
    const r=ratings[s.testId];
    const winner=s.selected, loser=winner==='A'?'B':'A';
    const rw=r[winner], rl=r[loser];
    const ew=1/(1+Math.pow(10,(rl-rw)/400));
    const k=24;
    r[winner]=Math.round(rw+k*(1-ew));
    r[loser]=Math.round(rl+k*(0-(1-ew)));
  });
  return ratings;
}
function renderEloBoard(){
  const ratings=eloRatings();
  const rows=[];
  state.tests.forEach(t=>{
    const r=ratings[t.id]||{A:1500,B:1500};
    rows.push({name:t.name+' / A',rating:r.A,test:t});
    rows.push({name:t.name+' / B',rating:r.B,test:t});
  });
  rows.sort((a,b)=>b.rating-a.rating);
  const box=$('#eloBoard');
  if(!box)return;
  box.innerHTML=rows.slice(0,8).map((r,i)=>`<div class="listitem"><div class="rank"><div class="ranknum">${i+1}</div><div style="flex:1"><b>${esc(r.name)}</b><div class="small">Elo ${r.rating}</div><div class="bar"><i style="width:${Math.max(5,Math.min(100,(r.rating-1300)/4))}%"></i></div></div></div></div>`).join('');
}
function batchProgress(){
  const todayKey=new Date().toLocaleDateString('sv-SE');
  const done=state.sessions.filter(x=>isCurrentRunSession(x) && x.status==='completed' && (x.selected==='A'||x.selected==='B') && (!x.runnerVersion || Number(x.elapsed)<RUNNER_LIMIT) && x.participantId===state.participantId && x.ts && !Number.isNaN(new Date(x.ts).getTime()) && new Date(x.ts).toLocaleDateString('sv-SE')===todayKey).length;
  return {done,target:5};
}

function renderLibrary(){
 const entries=state.tests.map(t=>({t,sm:testSummary(t)}));
 $('#libraryList').innerHTML=entries.map(o=>{
   const t=o.t,sm=o.sm;
   if(!sm.n)return `<div class="listitem"><b>${esc(t.name)}</b><div class="small">${esc(t.metric)} · データ待ち</div></div>`;
   const winner=sm.a===sm.b?'互角':(sm.a>sm.b?'A':'B');
   const confidence=sm.n>=30?'高':sm.n>=10?'中':'低';
   return `<div class="listitem">
     <b>${esc(t.name)}：${winner}${winner==='互角'?'':'優勢'}</b>
     <div class="small">${esc(t.metric)} · A ${sm.aRate}% / B ${sm.bRate}% · Score ${sm.avgScore}</div>
     <div class="small">サンプル ${sm.n} · 信頼度 ${confidence} · 左選択 ${sm.leftRate}%</div>
   </div>`;
 }).join('')||'<div class="empty">データなし</div>';
}
function refreshAll(){
  refreshStats();renderHistory();
  if(!IS_ADMIN)return;
  renderAdminTests();renderAnalysis();renderLibrary();renderEloBoard();renderExperimentQueue();renderHealth();renderSegmentInsights();renderCohortMatrix();renderDesignCheck();renderBenchmark();renderAdoptedPatterns();renderTemplateLibrary();renderDecisionLog();renderSnapshots();renderReport();
  const aborted=state.sessions.filter(x=>x.status==='aborted').length;
  const completed=state.sessions.filter(x=>x.status==='completed').length;
  $('#abortCount').textContent=aborted;
  const total=aborted+completed;
  const q=total===0?'—':Math.round(completed/total*100)+'%';
  $('#dataQuality').textContent=q;
  const lb=(state.backups||[]).slice(-1)[0];
  $('#lastBackupAt').textContent=lb?(lb.ts||'').slice(0,16).replace('T',' '):'—';
}
$$('.nav button,.topnav button').forEach(b=>b.onclick=()=>show(b.dataset.target));if(IS_ADMIN)$('#participantMode').onclick=()=>setMode('participant');

$$('#qualityFilters button').forEach(b=>b.onclick=()=>{
  qualityFilter=b.dataset.quality;
  $$('#qualityFilters button').forEach(x=>x.classList.toggle('active',x===b));
  renderAnalysis();renderHealth();renderSegmentInsights();renderCohortMatrix();
});
$$('#analysisFilters button').forEach(b=>b.onclick=()=>{
  analysisFilter=b.dataset.filter;
  $$('#analysisFilters button').forEach(x=>x.classList.toggle('active',x===b));
  renderAnalysis();renderHealth();renderSegmentInsights();renderCohortMatrix();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&document.body.classList.contains('runner-active')&&!runnerLocked&&startedAt){completeRunner('aborted');}});
if(IS_ADMIN){
$('#intuitionSearch').addEventListener('input',renderIntuitionPanel);
$('#intuitionStatus').addEventListener('change',renderIntuitionPanel);
$('#exportIntuition').addEventListener('click',()=>{
 const rows=filteredSessions({includeTimeout:true}).filter(x=>x.runnerVersion>=22&&(x.status==='completed'||x.status==='timeout'));
 const report={schema:'ux-arena-intuition-v2',generatedAt:new Date().toISOString(),experiments:(state.tests||[]).filter(t=>t.status!=='archived').map(t=>({testId:t.id,name:t.name||t.title||'',metrics:intuitionMetrics(rows.filter(x=>String(x.testId||'')===String(t.id)))}))};
 const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ux-arena-intuition.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('#adminMode').onclick=()=>setMode('admin');
}
$('#startTest').onclick=start;

state.profile=state.profile||{experience:'standard',device:detectDevice()};
state.profile.device=detectDevice();
$('#experienceSelect').value=state.profile.experience||'standard';
$('#deviceType').textContent=state.profile.device==='mobile'?'スマホ':'PC';
$('#experienceLevel').textContent=state.profile.experience==='beginner'?'初心者':state.profile.experience==='advanced'?'慣れている':'ふつう';
try{if(localStorage.getItem(STORAGE)) $('#profileSetup').classList.add('hidden');}catch(e){console.warn('Storage unavailable',e)}
$('#saveProfile').onclick=()=>{
  const previousProfile={...state.profile};
  state.profile.experience=$('#experienceSelect').value;
  state.profile.device=detectDevice();
  if(!save()){state.profile=previousProfile;return;}
  $('#profileSetup').classList.add('hidden');
  $('#deviceType').textContent=state.profile.device==='mobile'?'スマホ':'PC';
  $('#experienceLevel').textContent=state.profile.experience==='beginner'?'初心者':state.profile.experience==='advanced'?'慣れている':'ふつう';
  toast('設定を保存しました');
};

$('#restartBatch').onclick=()=>{ $('#batchComplete').classList.add('hidden'); start(); };


if(IS_ADMIN){
$('#generateDemo').onclick=()=>{ if(confirm('分析確認用のデモ回答を生成しますか？')) generateDemoData(); };
$('#resetAll').onclick=()=>{
  if(pendingRecovery){showSaveFailure();return;}
  if(!confirm('テスト・回答・設定をすべて初期化しますか？'))return;
  try{localStorage.removeItem(STORAGE);}catch(e){}
  state={participantId:uid(),tests:defaults(),sessions:[],profile:{experience:'standard',device:detectDevice()}};
  currentTestId=null;if(!save())return;refreshAll();renderParticipant();toast('初期化しました');
};

}
$('#clearData').onclick=()=>{if(pendingRecovery){showSaveFailure();return;}if(confirm('回答データを削除しますか？')){backupState('before session clear');const previousSessions=state.sessions;state.sessions=[];if(!save()){state.sessions=previousSessions;return;}refreshAll();renderParticipant();toast('削除しました')}};

if(IS_ADMIN){
$('#adminNextActionBtn').onclick=()=>{
  const b=$('#adminNextActionBtn'),kind=b.dataset.kind,id=b.dataset.testId;
  if(kind==='publish'){
    const t=state.tests.find(x=>x.id===id);if(t){t.status='running';t.published=true;save();refreshAll();renderParticipant();toast('公開しました');}
    return;
  }
  if(kind==='inspect'){show('a-analysis');return;}
  if(kind==='suggest'){
    const source=state.tests.find(x=>x.id===id);
    if(source){
      state.tests.push({...source,id:tid(),name:source.name+' 勝者派生',published:false,status:'draft',winner:null,completedAt:null,runEpoch:null,adoptedWinner:null,adoptedAt:null,adoptionBasis:null});
      save();refreshAll();toast('派生テストを作成しました');
    }
    return;
  }
  $('#createForm').classList.remove('hidden');
};

$('#openCreate').onclick=()=>{const f=$('#createForm');f.classList.toggle('hidden');if(!f.classList.contains('hidden'))setTimeout(()=>$('#testName').focus(),0)};

}
function renderCreatePreflight(){
  const name=$('#testName').value.trim(),task=$('#testTask').value.trim(),hyp=$('#testHypothesis').value.trim();
  const target=Number($('#targetResponses').value||0),mde=Number($('#minimumDetectableEffect').value||15),need=estimateSampleSize(mde);
  const checks=[
    ['お題が具体的',task.length>=8],['仮説が設定済み',hyp.length>=8],['主評価指標が設定済み',!!$('#successMetric').value],
    ['回答数が検出目安以上',target>=need],['ガードレール設定済み',$('#guardrailMetric').value!=='none']
  ];
  const ok=checks.filter(x=>x[1]).length;
  $('#createPreflight').innerHTML=`<b>公開前チェック ${ok} / ${checks.length}</b><div class="small">下書き保存は可能です。公開前に不足項目を確認します。</div>`+checks.map(x=>`<div class="check"><span>${x[0]}</span><b class="${x[1]?'ok':'warn'}">${x[1]?'OK':'要確認'}</b></div>`).join('');
}
function publishReadiness(t){
  const design=experimentDesignIssues(t);
  return {ok:design.issues.length===0,issues:design.issues,recommended:design.recommended};
}
function updateSampleEstimate(){
  const mde=Number($('#minimumDetectableEffect').value||15);
  const est=estimateSampleSize(mde);
  $('#sampleEstimate').textContent=`最小差 ${mde}pt を検出する目安: 約 ${est}回答`;
  renderCreatePreflight();
}
if(IS_ADMIN){
['testName','testTask','testHypothesis','successMetric','targetResponses','minimumDetectableEffect','guardrailMetric'].forEach(id=>$('#'+id).addEventListener('input',updateSampleEstimate));
updateSampleEstimate();


$('#saveTest').onclick=()=>{const name=$('#testName').value.trim(),task=$('#testTask').value.trim();const err=$('#createError');if(!name||!task){err.textContent='テスト名とお題は必須です。未入力の項目を確認してください。';err.classList.remove('hidden');(!name?$('#testName'):$('#testTask')).focus();toast('必須項目を確認してください');return}err.classList.add('hidden');state.tests.push({
      id:tid(),name,task,metric:$('#metricType').value,type:$('#testType').value,
      hypothesis:$('#testHypothesis').value.trim(),
      successMetric:$('#successMetric').value,
      targetResponses:Math.max(10,Math.min(500,Number($('#targetResponses').value||30))),
      minimumDetectableEffect:Math.max(5,Math.min(40,Number($('#minimumDetectableEffect').value||15))),
      guardrailMetric:$('#guardrailMetric').value,
      tags:$('#patternTags').value.split(',').map(x=>x.trim()).filter(Boolean),
      published:false,status:'draft',version:1,
      history:[{ts:new Date().toISOString(),event:'created'}]
    });if(!save())return;$('#testName').value='';$('#testTask').value='';$('#testHypothesis').value='';$('#successMetric').value='selection';$('#targetResponses').value='30';$('#minimumDetectableEffect').value='15';$('#patternTags').value='';$('#guardrailMetric').value='misclick';$('#createForm').classList.add('hidden');renderAdminTests();$('#testCount').textContent=state.tests.length;toast('テストを作成しました')};

$('#createSuggestedTest').onclick=()=>{
  const b=$('#createSuggestedTest');
  if(b.disabled)return;
  state.tests.push({
    id:tid(),
    name:b.dataset.name||'次の検証',
    task:b.dataset.task||'同じタスクを実行してください。',
    metric:b.dataset.metric||'発見性',
    type:b.dataset.type||'cta',
    published:false,
    status:'draft'
  });
  if(!save())return;
  renderAdminTests();
  renderAnalysis();
  renderLibrary();
  $('#testCount').textContent=state.tests.length;
  toast('次の検証を下書き作成しました');
};


$('#importDataBtn').onclick=()=>$('#importDataFile').click();
$('#importDataFile').onchange=async(e)=>{
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  try{
    const text=await file.text();
    const parsed=JSON.parse(text);
    if(!parsed || !Array.isArray(parsed.tests) || !Array.isArray(parsed.sessions)){
      toast('UX ARENA形式のJSONではありません');
      return;
    }
    const currentId=state.participantId;
    state={
      participantId:currentId||parsed.participantId||uid(),
      profile:state.profile||parsed.profile||{experience:'standard',device:detectDevice()},
      tests:parsed.tests,
      sessions:parsed.sessions,
      decisionLog:Array.isArray(parsed.decisionLog)?parsed.decisionLog:[],snapshots:Array.isArray(parsed.snapshots)?parsed.snapshots:[],backups:Array.isArray(parsed.backups)?parsed.backups:[]
    };
    save();
    currentTestId=null;
    refreshAll();
    renderParticipant();
    toast('データを読み込みました');
  }catch(err){
    toast('JSONの読み込みに失敗しました');
  }finally{
    e.target.value='';
  }
};


$('#exportCsv').onclick=()=>{
  const rows=[['session_id','test_id','timestamp','status','selected','pref','first_touch','elapsed_ms','taps','misclicks','hesitation_ms','confidence','agree','left_variant','right_variant','chosen_side','experience','device']];
  state.sessions.forEach(s=>rows.push([
    s.id||'',s.testId||'',s.ts||'',s.status||'completed',s.selected||'',s.pref||'',s.firstTouch||'',
    s.elapsed||0,s.taps||0,s.misclicks||0,s.hesitation||0,s.confidence||'',s.agree===true?'1':s.agree===false?'0':'',
    s.leftVariant||'',s.rightVariant||'',s.chosenSide||'',s.experience||'',s.device||''
  ]));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\\n');
  const blob=new Blob(["\\uFEFF"+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='ux-arena-sessions.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};


$('#exportSummaryCsv').onclick=()=>{
  const rows=[['test','status','metric','responses','winner','a_rate','b_rate','median_ms','score','health','completion_rate','left_rate','decision','adopted']];
  state.tests.forEach(t=>{
    const sm=testSummary(t),h=testHealth(t),d=decisionFor(sm,t);
    rows.push([
      t.name||'',t.status||'',t.metric||'',sm.n||0,t.winner||'',
      sm.aRate??'',sm.bRate??'',sm.medianMs??'',sm.avgScore??'',h.score??'',h.completionRate??'',sm.leftRate??'',
      d.label||'',t.adoptedWinner||''
    ]);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(["\uFEFF"+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='ux-arena-summary.csv';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};



$('#copyReport').onclick=async()=>{
  const text=buildReportMarkdown();
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      toast('結果サマリーをコピーしました');
    }else throw new Error('clipboard unavailable');
  }catch(e){
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');toast('結果サマリーをコピーしました');}catch(_){toast('コピーに失敗しました');}
    ta.remove();
  }
};
$('#exportReport').onclick=()=>{
  const blob=new Blob([buildReportMarkdown()],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='ux-arena-report.md';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

$('#saveSnapshot').onclick=()=>{
  state.snapshots=Array.isArray(state.snapshots)?state.snapshots:[];
  state.snapshots.push(currentAnalysisSnapshot());
  if(state.snapshots.length>30)state.snapshots=state.snapshots.slice(-30);
  save();renderSnapshots();toast('分析スナップショットを保存しました');
};
$('#exportSnapshots').onclick=()=>{
  const blob=new Blob([JSON.stringify(state.snapshots||[],null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='ux-arena-snapshots.json';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

$('#exportData').onclick=()=>{const blob=new Blob([JSON.stringify(pendingRecovery||state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ux-arena-v79-data.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};
}
restoreRecoveryJournal();
refreshAll();renderParticipant();
if(IS_ADMIN&&!pendingRecovery)setMode('admin');
})();
