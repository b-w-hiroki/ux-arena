// Fixed, participant-balanced data; timeout and abort rows deliberately carry
// selections so accidental inclusion in preference/position metrics is visible.
export function fixture() {
 const tests=['stable','slow','biased','reverse'].map(id=>({id,name:id,status:'completed',runEpoch:'current',targetResponses:999}));
 const sessions=[];
 for(const t of tests){
  for(let i=0;i<128;i++){
   const leftVariant=i%2?'A':'B';
   const selected=t.id==='biased'?leftVariant:t.id==='reverse'?(i<64?'A':'B'):(i%16<2?'A':'B');
   sessions.push({id:`${t.id}-${i}`,testId:t.id,runEpoch:'current',runnerVersion:91,status:'completed',selected,leftVariant,chosenSide:selected===leftVariant?'left':'right',participantId:'P'+(i%16),elapsed:1100,qualityValid:true,experience:'standard',ts:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});
  }
  for(let i=0;i<(t.id==='slow'?64:16);i++)sessions.push({...sessions[0],id:`${t.id}-timeout-${i}`,testId:t.id,status:'timeout',elapsed:10000,selected:'A',chosenSide:'left'});
  for(let i=0;i<32;i++)sessions.push({...sessions[0],id:`${t.id}-abort-${i}`,testId:t.id,status:'aborted'});
  for(const extra of [{runEpoch:'old'},{qualityValid:false},{runnerVersion:21},{experience:'beginner'}]){
   sessions.push({...sessions[0],id:`${t.id}-excluded-${sessions.length}`,testId:t.id,status:'timeout',...extra});
  }
 }
 return {participantId:'viewer',tests,sessions,profile:{experience:'standard',device:'mobile'},decisionLog:[],snapshots:[],backups:[]};
}
