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
    async function find(dir){const files=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await find(p));else if(/111145\.(111|115)\.pdf$/.test(p))files.push(p);}return files;}
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
    const imported=await page.evaluate(()=>(()=>{const library=JSON.parse(localStorage.getItem('vedomost-projects-v1'));return library.projects.find(p=>p.id===library.activeId).data;})());
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
  await page.locator('#sections-tab').click();
  assert.equal(await page.locator('.section-card').count(),6,'All six specification sections are visible');
  assert.match(await page.locator('#structure').innerText(),/3 → 24 шт\./);
  await page.locator('#collapse-tree').click();assert.equal(await page.locator('#structure details[open]').count(),0);
  await page.locator('#expand-tree').click();assert.ok(await page.locator('#structure details[open]').count()>0);
  await page.locator('#structure .tree-position[data-assembly="1"][data-item="0"]').click();
  assert.equal(await page.locator('#assembly-code').inputValue(),'S','Tree click opens the source specification');
  assert.equal(await page.locator('tr[data-item="0"] [data-key="name"]').inputValue(),'Контакт');
  await page.locator('#assemblies [data-index="0"]').click();
  for(const input of await page.locator('#report-sections input').all())await input.uncheck();
  await page.locator('#report-sections input[data-section="1"]').check();
  await page.locator('#summary-tab').click();
  assert.match(await page.locator('#content').innerText(),/25 шт\./);
  assert.ok(!(await page.locator('#content').innerText()).includes('R → S'),'Applicability shows only direct parent');
  await downloadFrom(()=>page.locator('#save').click(),'saved-project.json');
  const savedProject=JSON.parse(await fs.readFile(path.join(output,'saved-project.json'),'utf8'));
  assert.deepEqual(savedProject.report_sections,['Детали'],'Section selection survives project export');
  await page.reload();await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/25 шт\./);
  await page.locator('#items-tab').click();await page.locator('#assembly-quantity').fill('3');await page.locator('#assembly-quantity').blur();
  assert.equal(await page.locator('#reviewed').isChecked(),false,'Editing invalidates review');
  await page.locator('#reviewed').check();await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/37 шт\./);
  await page.locator('#export').click();await page.locator('[name="changeSheet"]').uncheck();
  await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'nested-template.docx');
  const filtered=await JSZip.loadAsync(await fs.readFile(path.join(output,'nested-template.docx')));
  const documentXML=await filtered.file('word/document.xml').async('string');
  assert.ok(documentXML.includes('Контакт'));assert.ok(!documentXML.includes('Сборочные единицы'),'Assembly rows excluded only from the output');
  await page.locator('#report-sections input[data-section="1"]').uncheck();
  await page.locator('#export').click();assert.match(await page.locator('#toast').innerText(),/Выберите хотя бы один раздел/);
  await page.locator('#report-sections input[data-section="1"]').check();
  await page.screenshot({path:path.join(output,'browser-summary.png'),fullPage:true});
  await page.locator('#sections-tab').click();await page.screenshot({path:path.join(output,'browser-workspace.png'),fullPage:true});
  console.log('PASS section lists, tree navigation, output filtering, nested quantities, editing and project persistence');
  const variants={version:1,assemblies:[a('A',[{...item(' XX . 123 . 456','2'),supplier:'Завод A',note:'Примечание A'},{...item('-01','1'),name:''}]),a('B',[{...item('XX.123.456','3','Детали','Контакт другой'),supplier:'Завод B',note:'Примечание B'}])]};
  await page.locator('#project-input').setInputFiles({name:'variants.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(variants))});
  await page.locator('#summary-tab').click();
  assert.match(await page.locator('#content').innerText(),/5 шт\./);
  assert.match(await page.locator('#content').innerText(),/Завод B/);
  assert.match(await page.locator('#content').innerText(),/XX\.123\.456-01/);
  await page.locator('#export').click();
  await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'variants-template.docx');
  const variantZip=await JSZip.loadAsync(await fs.readFile(path.join(output,'variants-template.docx')));
  const variantXML=await variantZip.file('word/document.xml').async('string');
  for(const text of ['Контакт другой','Завод A','Завод B','Примечание A','Примечание B','XX.123.456-01'])assert.ok(variantXML.includes(text),text+' retained in Word');
  await page.locator('#items-tab').click();
  await page.locator('tr[data-item="1"] [data-key="code"]').fill(' - 02 ');
  await page.locator('tr[data-item="1"] [data-key="code"]').blur();
  assert.equal(await page.locator('tr[data-item="1"] [data-key="code"]').inputValue(),'XX.123.456-02');
  assert.equal(await page.locator('#reviewed').isChecked(),false);
  // Small original test PDF, independent of private fixtures and OCR quality.
  function smallPDF(){
    const stream='BT /F1 10 Tf 30 770 Td ('+Array(30).fill('header').join(' ')+') Tj ET\nBT /F1 10 Tf 105 500 Td (1) Tj ET\nBT /F1 10 Tf 150 500 Td (DD.123.456) Tj ET\nBT /F1 10 Tf 330 500 Td (Part) Tj ET\nBT /F1 10 Tf 495 500 Td (2) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf='%PDF-1.4\n';const offsets=[0];
    objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
    const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
    return Buffer.from(pdf);
  }
  const missing={version:1,assemblies:[a('ROOT',[item(' S . 001','2','Сборочные единицы','Сборка')])]};
  for(const location of ['#structure','#content','#export-warnings']){
    await page.locator('#project-input').setInputFiles({name:'missing.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(missing))});
    if(location==='#content')await page.locator('#summary-tab').click();
    if(location==='#export-warnings')await page.locator('#export').click();
    const chooserPromise=page.waitForEvent('filechooser');
    await page.locator(location+' .add-missing').click();
    const chooser=await chooserPromise;
    await chooser.setFiles({name:'arbitrary-name.pdf',mimeType:'application/pdf',buffer:smallPDF()});
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='2');
    await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    const saved=await page.evaluate(()=>(()=>{const library=JSON.parse(localStorage.getItem('vedomost-projects-v1'));return library.projects.find(p=>p.id===library.activeId).data;})());
    assert.equal(saved.assemblies[1].code,'S.001');assert.equal(saved.assemblies[1].reviewed,false);
    assert.equal(saved.assemblies[1].items.length,1);
    assert.equal(await page.locator('#structure .add-missing').count(),0);
    await page.locator('#reviewed').check();await page.locator('#summary-tab').click();
    assert.match(await page.locator('#content').innerText(),/4 шт\./);
  }
  console.log('PASS compact codes, edition editing, metadata-preserving Word export and PDF upload from all missing-specification warnings offline');
  const grouped={version:1,assemblies:[a('R',[item('S-01','2','Сборочные единицы','Сборка'),item('S-02','3','Сборочные единицы','Сборка')]),{...a('S',[{...item('WIRE','','Материалы','Провод'),unit:'м',quantities:{'-':'17','01':'17','02':'12'}}]),executions:['-','01','02'],root_execution:'-'}]};
  await page.locator('#project-input').setInputFiles({name:'grouped.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(grouped))});
  await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/70 м/);assert.ok(!(await page.locator('#content').innerText()).includes(' → '));
  assert.equal(await page.locator('#structure .add-missing').count(),0,'One shared PDF resolves both executions');
  await page.locator('#assemblies [data-index="1"]').click();await page.locator('#items-tab').click();
  assert.equal(await page.locator('[data-execution="02"]').inputValue(),'12');
  await page.locator('[data-execution="02"]').fill('13');await page.locator('[data-execution="02"]').blur();
  assert.equal(await page.locator('#reviewed').isChecked(),false);await page.locator('#reviewed').check();
  await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/73 м/);
  await page.reload();await page.locator('#summary-tab').click();assert.match(await page.locator('#content').innerText(),/73 м/);
  await page.locator('#export').click();await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'execution-template.docx');
  const groupZip=await JSZip.loadAsync(await fs.readFile(path.join(output,'execution-template.docx'))),groupXML=await groupZip.file('word/document.xml').async('string');
  assert.ok(groupXML.includes('S-01')&&groupXML.includes('S-02')&&groupXML.includes('=73'));assert.ok(!groupXML.includes(' → '));
  console.log('PASS shared specification executions, matrix editing, persistence, direct-parent applicability and Word');
  if(process.env.VEDOMOST_LANDSCAPE){
    await page.locator('#project-input').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,assemblies:[]}))});
    await page.locator('#pdf-input').setInputFiles(process.env.VEDOMOST_LANDSCAPE);
    await page.waitForFunction(()=>document.querySelector('#count').textContent==='1',{}, {timeout:180000});
    await page.waitForFunction(()=>document.querySelector('#progress').hidden);
    const loaded=await page.evaluate(()=>(()=>{const library=JSON.parse(localStorage.getItem('vedomost-projects-v1'));return library.projects.find(p=>p.id===library.activeId).data;})()),spec=loaded.assemblies[0];
    await fs.writeFile(path.join(output,'landscape-project.json'),JSON.stringify(loaded,null,2));
    assert.deepEqual(spec.executions,['-','01','02','03','04','05']);assert.equal(spec.items.length,14);
    const wire=spec.items.find(i=>i.position==='16');assert.deepEqual(wire.quantities,{'-':'17','01':'17','02':'12','03':'12','04':'12','05':'12'});assert.equal(wire.unit,'м');
    const braid=spec.items.find(i=>i.position==='17');assert.equal(braid.quantities['-'],'6,9');assert.equal(braid.quantities['02'],'4,8');
    await page.locator('#items-tab').click();assert.equal(await page.locator('[data-execution]').count(),84);
    await page.locator('#executions-tab').click();await page.screenshot({path:path.join(output,'landscape-matrix.png'),fullPage:true});
    await page.locator('#root-execution').selectOption('02');await page.locator('#reviewed').check();
    assert.equal(await page.locator('#reviewed').isChecked(),true);
    await page.locator('#summary-tab').click();assert.match(await page.locator('.summary-table tr').filter({hasText:'16-505.437-82'}).innerText(),/12 м/);
    await page.locator('#export').click();await downloadFrom(()=>page.locator('#export-form button[type="submit"]').click(),'landscape-template.docx');
    console.log('PASS supplied landscape PDF: 14 rows, 6 executions, exact wire/braid quantities, matrix review and Word offline');
  }
  const longProject={version:1,assemblies:[a('LONG',Array.from({length:100},(_,i)=>({...item('D.'+i,'1'),position:String(i+1)})))]};
  await page.locator('#project-input').setInputFiles({name:'long.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(longProject))});
  await page.locator('#items-tab').click();
  const row=page.locator('tr[data-item="90"]');
  await row.locator('[data-key="code"]').fill(' D . 90 ');
  const scrollBefore=await page.locator('#content .table-scroll').evaluate(el=>el.scrollTop);
  const originalRow=await row.elementHandle();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'name','Tab advances after designation normalization');
  assert.ok(await originalRow.evaluate(el=>el.isConnected),'Editing preserves row DOM');
  const scrollAfter=await page.locator('#content .table-scroll').evaluate(el=>el.scrollTop);
  assert.ok(Math.abs(scrollAfter-scrollBefore)<16,'Tab keeps the edited row in view (small native focus adjustment allowed)');
  assert.equal(await row.locator('[data-key="code"]').inputValue(),'D.90');
  await row.locator('[data-key="section"]').focus();await row.locator('[data-key="section"]').selectOption('Прочие изделия');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'position','Section change preserves Tab order');
  await page.locator('#section-filter').selectOption('Детали');
  for(let n=100;n<102;n++){
    await page.locator('#add-item').click();
    assert.equal(await page.locator('#section-filter').inputValue(),'Детали','Adding retains section filter');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('tr')?.dataset.item),String(n),'New row receives focus');
    const visible=await page.evaluate(()=>{const input=document.activeElement,r=input.getBoundingClientRect(),t=input.closest('.table-scroll').getBoundingClientRect();return r.top>=t.top&&r.bottom<=t.bottom&&r.left>=t.left&&r.right<=t.right;});
    assert.equal(visible,true,'New input is visible in both scroll axes');
    await page.keyboard.type(String(n+1));await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'code');
    await page.keyboard.type(' D . '+n);await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'name');
    await page.keyboard.type('Новая деталь');await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'quantity');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.key),'name');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('tr')?.dataset.item),String(n));
  }
  console.log('PASS long-table scrolling, repeated row addition, normalized codes, section changes, Tab and Shift+Tab');
  const firstId=await page.locator('#project-select').inputValue();
  const firstCount=await page.locator('#count').innerText();
  await page.locator('#new-project').click();await page.locator('#project-name').fill('Вторая ведомость');await page.locator('#project-form button[type="submit"]').click();
  const secondId=await page.locator('#project-select').inputValue();assert.notEqual(firstId,secondId);assert.equal(await page.locator('#count').innerText(),'0');
  assert.equal(await page.locator('#report-sections input:checked').count(),6,'New project has independent settings');
  await page.locator('#report-sections input[data-section="0"]').uncheck();
  await page.locator('#project-select').selectOption(firstId);assert.equal(await page.locator('#count').innerText(),firstCount);
  assert.equal(await page.locator('#section-count').innerText(),'6 ИЗ 6');
  await page.locator('#project-select').selectOption(secondId);assert.equal(await page.locator('#report-sections input[data-section="0"]').isChecked(),false);
  await page.locator('#rename-project').click();await page.locator('#project-name').fill('Ведомость Б');await page.locator('#project-form button[type="submit"]').click();
  await page.reload();assert.equal(await page.locator('#project-select').inputValue(),secondId);assert.equal(await page.locator('#project-select option:checked').innerText(),'Ведомость Б');assert.equal(await page.locator('#count').innerText(),'0');
  const countBeforeImport=await page.locator('#project-select option').count();
  await page.locator('#project-input').setInputFiles({name:'separate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,project_name:'Из файла',assemblies:[a('SEPARATE',[item('D','1')])],export_settings:{title:'Изделие из файла',designation:'ТВК Б'},change_sheet:false}))});
  await page.waitForFunction(n=>document.querySelector('#project-select').options.length===n+1,countBeforeImport);
  assert.equal(await page.locator('#project-select option:checked').innerText(),'Из файла');
  await page.locator('#export').click();assert.equal(await page.locator('[name="title"]').inputValue(),'Изделие из файла');assert.equal(await page.locator('[name="changeSheet"]').isChecked(),false);
  await page.locator('[name="title"]').fill('Изменённое изделие');await page.locator('#export-cancel').click();const importedId=await page.locator('#project-select').inputValue();
  await page.locator('#project-select').selectOption(firstId);assert.equal(await page.locator('[name="title"]').inputValue(),'Изделие');
  await page.locator('#project-select').selectOption(importedId);assert.equal(await page.locator('[name="title"]').inputValue(),'Изменённое изделие');
  await downloadFrom(()=>page.locator('#save').click(),'named-project.json');assert.equal(JSON.parse(await fs.readFile(path.join(output,'named-project.json'),'utf8')).project_name,'Из файла');
  // A separate browser profile simulates upgrading from the old single-project app.
  const migrationContext=await browser.newContext();await migrationContext.addInitScript(value=>{if(!localStorage.getItem('seeded')){localStorage.setItem('vedomost-project-v2',JSON.stringify(value));localStorage.setItem('seeded','1');}},{version:1,assemblies:[a('LEGACY',[item('D','2')])],report_sections:['Детали']});
  const migration=await migrationContext.newPage();await migration.goto(base);await migration.locator('#project-select').waitFor();assert.equal(await migration.locator('#count').innerText(),'1');assert.match(await migration.locator('#assemblies').innerText(),/LEGACY/);
  await migration.reload();assert.equal(await migration.locator('#project-select option').count(),1);assert.equal(await migration.locator('#report-sections input:checked').count(),1);assert.ok(await migration.evaluate(()=>localStorage.getItem('vedomost-project-v2')));await migrationContext.close();
  console.log('PASS independent projects, switching, creation, renaming, JSON import/export, Word settings, restart and legacy migration');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS no browser errors or external requests');
} finally {await browser.close();}
