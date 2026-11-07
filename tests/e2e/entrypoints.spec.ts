import {test,expect} from '@playwright/test';
for(const viewport of [{width:390,height:844},{width:320,height:568}]){
 test(`participant entry and five-trial compatibility ${viewport.width}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#adminMode, #adminNav, #adminTopNav, [id^="a-"]')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'管理',exact:true})).toHaveCount(0);
  await page.locator('#startTest').click();
  for(let i=0;i<5;i++){
   await expect(page.locator('#runnerCount')).toHaveText(`${i+1} / 5`);
   await expect(page.locator('#p-results')).not.toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBeTruthy();
   if(i===0)await page.screenshot({path:testInfo.outputPath('participant-runner.png'),fullPage:true});
   await page.locator('.variant [data-success="1"]').first().click();
   await page.waitForTimeout(250);
  }
  await expect(page.locator('#batchComplete')).toBeVisible();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!));
  expect(saved.sessions).toHaveLength(5);
  await page.goto('/admin.html');
  await expect(page.locator('#a-tests')).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!).sessions)).toEqual(saved.sessions);
  await page.getByRole('link',{name:'参加者用ページ'}).click();
  await expect(page.locator('#p-test')).toBeVisible();
  await page.goBack();await expect(page.locator('#a-tests')).toBeVisible();
  expect(errors).toEqual([]);
 });
}
test('participant timeout and failed-save recovery',async({page})=>{
 await page.goto('/');
 await page.clock.install();
 await page.locator('#startTest').click();
 await page.clock.runFor(10100);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!).sessions[0].status)).toBe('timeout');
 await page.clock.runFor(300);
 await page.evaluate(()=>{const original=Storage.prototype.setItem;(window as any).restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(key,value){if(key==='ux_arena_v6')throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,key,value);};});
 await page.locator('.variant [data-success="1"]').first().click();
 await expect(page.locator('#saveFailure')).toBeVisible();
 await expect(page.locator('#batchComplete')).not.toBeVisible();
 await page.evaluate(()=>(window as any).restoreStorage());
 await page.locator('#retrySave').click();
 await expect(page.locator('#saveFailure')).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!).sessions.map((s:any)=>s.status))).toEqual(['timeout','completed']);
 await expect(page.locator('body')).not.toHaveClass(/runner-active/);
});
