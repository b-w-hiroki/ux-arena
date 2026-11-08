import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function download(page:any,selector:string){
 const pending=page.waitForEvent('download');await page.locator(selector).click();const file=await pending;return JSON.parse(await readFile((await file.path())!,'utf8'));
}
async function upload(page:any,packet:any){
 await page.locator('#handoffFile').setInputFiles({name:'handoff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});
}
test('two browsers: distribute, answer, collect and deduplicate',async({page,browser},info)=>{
 await page.goto('/admin.html');const study=await download(page,'#exportStudyBtn');
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const participant=await context.newPage();await participant.goto('/');
 await participant.locator('#participantTopNav [data-target="p-mine"]').click();
 await upload(participant,study);await expect(participant.locator('#handoffStatus')).toContainText('準備しました');
 await participant.locator('#participantTopNav [data-target="p-test"]').click();await participant.locator('#startTest').click();
 for(let i=0;i<5;i++){await participant.locator('.variant [data-success="1"]').first().click();await participant.waitForTimeout(250);}
 await expect(participant.locator('#batchComplete')).toBeVisible();
 await participant.locator('#participantTopNav [data-target="p-mine"]').click();
 const answers=await download(participant,'#exportAnswersBtn');expect(answers.sessions).toHaveLength(5);expect(answers.profile).toBeUndefined();
 await upload(page,answers);await expect(page.locator('#handoffStatus')).toContainText('回答 5件を追加');
 await upload(page,answers);await expect(page.locator('#handoffStatus')).toContainText('回答 0件を追加、重複 5件');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!).sessions.length)).toBe(5);
 for(const width of [390,320]){
  await participant.setViewportSize({width,height:width===390?844:568});
  expect(await participant.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await participant.screenshot({path:info.outputPath('handoff-'+width+'.png'),fullPage:true});
 }
 await context.close();
});
test('conflicts and save failure leave persisted state unchanged',async({page})=>{
 await page.goto('/admin.html');const study=await download(page,'#exportStudyBtn');
 await page.goto('/');await page.locator('#participantTopNav [data-target="p-mine"]').click();
 await upload(page,study);await expect(page.locator('#handoffStatus')).toContainText('準備しました');
 const saved=await page.evaluate(()=>localStorage.getItem('ux_arena_v6'));
 study.tests[0].task='違うタスク';await upload(page,study);
 await expect(page.locator('#handoffStatus')).toContainText('同じID');
 expect(await page.evaluate(()=>localStorage.getItem('ux_arena_v6'))).toBe(saved);
 study.tests[0].id='NEW-STUDY';
 await page.evaluate(()=>{const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='ux_arena_v6')throw Error('quota');return orig.call(this,k,v);};});
 await upload(page,study);await expect(page.locator('#handoffStatus')).toContainText('追加していません');
 expect(await page.evaluate(()=>localStorage.getItem('ux_arena_v6'))).toBe(saved);
});
