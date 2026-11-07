import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fixture} from '../fixtures/intuition.mjs';
for(const viewport of [{width:390,height:844},{width:320,height:568}]){
 test(`convergence screen and downloaded JSON ${viewport.width}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const saved=fixture();
  await page.addInitScript(data=>localStorage.setItem('ux_arena_v6',JSON.stringify(data)),saved);
  await page.goto('/admin.html');
  // Exercise the actual filter handlers before opening the admin screen.
  await page.locator('#analysisFilters [data-filter="standard"]').dispatchEvent('click');
  await page.locator('#adminTopNav [data-target="a-analysis"]').click();
  const panel=(name:string)=>page.locator('.intuition-experiment').filter({has:page.getByRole('heading',{name,exact:true})});
  const value=(name:string,label:string)=>panel(name).locator('.insight-metric').filter({has:page.locator('span',{hasText:new RegExp('^'+label+'$')})}).locator('strong');
  await expect(value('stable','有効選択率')).toHaveText('89%');
  await expect(value('slow','有効選択率')).toHaveText('67%');
  await expect(value('stable','判定')).toHaveText('暫定的に安定');
  await expect(value('slow','判定')).not.toHaveText('暫定的に安定');
  await expect(value('biased','判定')).toHaveText('左右バイアス要確認');
  await expect(value('reverse','判定')).toHaveText('選好反転を検出');
  await expect(value('stable','10秒超過 / 無選択')).toHaveText('16件');
  await expect(value('stable','識別できる参加者')).toHaveText('16人');
  const download=page.waitForEvent('download');
  await page.locator('#exportIntuition').click();
  const file=await download;
  const report=JSON.parse(await readFile((await file.path())!,'utf8'));
  for(const {testId,metrics:m} of report.experiments){
   expect(m.valid).toBe(128);expect(m.participants).toBe(16);
   expect(m.timeout).toBe(testId==='slow'?64:16);
   expect(m.n).toBe(128+m.timeout);expect(m.within).toBe(128/m.n);
   expect(m.stable).toBe(testId==='stable');
   expect(m.biased).toBe(testId==='biased');expect(m.reversed).toBe(testId==='reverse');
   expect(m.positionEffect).toBe(testId==='biased'?1:0);
  }
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ux_arena_v6')!).sessions)).toEqual(saved.sessions);
  await page.screenshot({path:testInfo.outputPath('convergence.png'),fullPage:true});
 });
}
