import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const output=path.resolve('test-results');await fs.mkdir(output,{recursive:true});
const base=process.env.VEDOMOST_TEST_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
const page=await context.newPage(),errors=[],external=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR:',e.message);});
page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(base))external.push(req.url());});
page.on('dialog',dialog=>dialog.accept());
async function downloadFrom(action,filename){
  const promise=page.waitForEvent('download');await action();const download=await promise;const saved=path.join(output,filename);await download.saveAs(saved);
  if(filename.endsWith('.docx')) {
    const zip=await JSZip.loadAsync(await fs.readFile(saved));
    for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.xml'))){
      const text=await zip.file(name).async('string');
      assert.equal(await page.evaluate(s=>new DOMParser().parseFromString(s,'application/xml').getElementsByTagName('parsererror').length,text),0,`Valid XML: ${name}`);
    }
    assert.ok((await zip.file('word/footer2.xml').async('string')).includes('Подп. и дата'),'Original side inventory fields retained');
  }
}
try {
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#offline')?.textContent.includes('Готово'),{},{timeout:120000});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.screenshot({path:path.join(output,'browser-start.png'),fullPage:true});
  const cached=await page.evaluate(async()=>{const names=await caches.keys();const c=await caches.open(names.at(-1));return(await c.keys()).length;});
  assert.ok(cached>100,'OCR, PDF assets and template cached');
  await context.setOffline(true);await page.reload();await page.locator('#add').waitFor();
  console.log('PASS offline reload; cached assets:',cached);
  const fixtureDir=process.env.VEDOMOST_FIXTURES;
  if(fixtureDir){
    async function find(dir){const files=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await find(p));else if(p.endsWith('.pdf'))files.push(p);}return files;}
    const files=(await find(fixtureDir)).sort();
    assert.equal(files.length,2,'Expected the two supplied PDF fixtures');
    await page.locator('#pdf-input').setInputFiles(files);
    await page.waitForFunction(()=>!document.querySelector('#progress').hidden);
    let last='';
    for(let i=0;i<360;i++) {
      const state=await page.evaluate(()=>({done:document.querySelector('#progress').hidden,text:document.querySelector('#progress-text').textContent}));
      if(state.text!==last){console.log(state.text);last=state.text;}
      if(state.done)break;
      await page.waitForTimeout(1000);
    }
    assert.equal(await page.locator('#progress').isHidden(),true,'Import completed within six minutes');
    const imported=await page.evaluate(()=>JSON.parse(localStorage.getItem('vedomost-project-v2')));
    await fs.writeFile(path.join(output,'browser-import.json'),JSON.stringify(imported,null,2));
    console.log('Imported record counts:',imported?.assemblies.map(a=>a.items.length));
    assert.deepEqual(imported.assemblies.map(a=>a.items.length).sort((a,b)=>a-b),[3,11]);
    await page.locator('#export').click();assert.match(await page.locator('#toast').innerText(),/подтвердите проверку/);
    console.log('PASS real PDF text and scan import fully offline; unreviewed export blocked');
    await page.screenshot({path:path.join(output,'browser-import.png'),fullPage:true});
  }
  if(process.env.VEDOMOST_REVIEWED_PROJECT){
    await page.locator('#project-input').setInputFiles(process.env.VEDOMOST_REVIEWED_PROJECT);
    await page.waitForFunction(()=>document.querySelector('#stats').textContent.includes('2 проверено'));
    await page.locator('#export').click();
    await page.locator('[name="designation"]').fill('ПРИМЕР ТВК');
    await page.locator('[name="title"]').fill('Пробная ведомость');
    await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'sample-template.docx');
    console.log('PASS original-template DOCX export offline');
  }
  const item=(code,quantity,section='Детали',name='Контакт')=>({section,code,name,quantity,unit:'шт.',supplier:'',note:'',position:'1',page:1});
  const a=(code,items,count='1')=>({code,name:code,source:'',items,reviewed:true,root_quantity:count,warnings:[]});
  const synthetic={version:1,assemblies:[a('R',[item('S','4','Сборочные единицы','Сборка')],'2'),a('S',[item('D','3')]),a('B',[item('D','1')])]};
  await page.locator('#project-input').setInputFiles({name:'nested.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))});
  await page.waitForFunction(()=>document.querySelector('#count').textContent==='3');
  await page.locator('#summary-tab').click();
  assert.match(await page.locator('#content').innerText(),/25 шт\./);
  assert.match(await page.locator('#content').innerText(),/R → S/);
  await downloadFrom(()=>page.locator('#save').click(),'saved-project.json');
  await page.reload();await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/25 шт\./);
  await page.locator('#items-tab').click();await page.locator('#assembly-quantity').fill('3');await page.locator('#assembly-quantity').blur();
  assert.equal(await page.locator('#reviewed').isChecked(),false,'Editing invalidates review');
  await page.locator('#reviewed').check();await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/37 шт\./);
  await page.locator('#export').click();await page.locator('[name="changeSheet"]').uncheck();
  await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'nested-template.docx');
  await page.screenshot({path:path.join(output,'browser-summary.png'),fullPage:true});
  console.log('PASS nested quantities, project persistence, download and one-section Word');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS no browser errors or external requests');
} finally {await browser.close();}
