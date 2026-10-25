import './style.css';
import { SECTIONS, emptyItem, aggregate, fmt, validateProject, number } from './core.js';
import { importPDF } from './reader.js';
import { exportWord } from './word.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE='vedomost-project-v2';
let assemblies=[], selected=0, busy=false, abortController, installedPrompt, tab='items';
const previews=new Map();
try { const saved=localStorage.getItem(STORE); if(saved)assemblies=validateProject(JSON.parse(saved)); } catch { /* Retain malformed storage until the user saves a new project. */ }
$('app').innerHTML=`
<header class="top"><a class="brand" href="./"><img src="./icon.svg" alt="">Ведомость<span>PDF → WORD</span></a><div class="top-right"><span id="offline" class="badge">Подготовка офлайн-режима…</span><button id="install" class="quiet" hidden>Установить</button><button id="help" class="quiet">Как это работает</button></div></header>
<main><section class="intro"><div><p class="eyebrow">КОМПЛЕКТАЦИЯ БЕЗ РУЧНОГО СВЕДЕНИЯ</p><h1>Все спецификации.<br><em>Одна ведомость.</em></h1><p class="lead">Раскройте сборки, объедините одинаковые позиции<br>и сохраните результат в вашей форме Word.</p></div><div class="privacy"><span class="privacy-icon">⌘</span><strong>Ваши документы остаются у вас</strong><p>Распознавание и расчёты выполняются на этом компьютере. Файлы не отправляются на сервер.</p><small>Сканы требуют проверки перед выгрузкой.</small></div></section>
<section class="workspace"><div class="toolbar"><div><h2>Рабочий проект</h2><span id="stats">Добавьте первые спецификации</span></div><div class="actions"><button id="load">Открыть проект</button><button id="save">Сохранить проект</button><button id="add" class="primary">＋ Добавить PDF</button></div></div>
<div id="progress" hidden><span id="progress-text"></span><button id="cancel">Отменить</button></div>
<div class="workgrid"><aside><div class="aside-label">СПЕЦИФИКАЦИИ <span id="count">0</span></div><div id="assemblies"></div><p class="aside-note">Головные изделия определяются по связям сборок. Их количество задаётся в карточке.</p></aside><div class="content"><div class="tabs"><button id="items-tab" class="active">Позиции и проверка</button><button id="summary-tab">Общая ведомость</button></div><div id="content"></div></div></div>
<div class="export-bar"><div><strong>Форма из вашего Word-шаблона</strong><small>Рамка, боковые графы и основные надписи сохранены в DOCX.</small></div><button id="export" class="primary">Выгрузить Word ↗</button></div></section>
<p class="footnote">Проект сохраняется в этом браузере. Для резервной копии скачивайте файл проекта. Очистка данных браузера удаляет локальную копию и офлайн-компоненты.</p>
</main><div id="toast" role="status" hidden></div>
<input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple hidden><input id="project-input" type="file" accept=".json,application/json" hidden>
<dialog id="export-dialog"><form id="export-form"><p class="eyebrow">ГОТОВО К ВЫГРУЗКЕ</p><h2>Основная надпись</h2><label>Наименование изделия<input name="title" value="Изделие" maxlength="100" required></label><label>Обозначение ведомости<input name="designation" value="Ведомость ТВК" maxlength="80" required></label><div class="form-row"><label>Версия<input name="version" value="Версия 0" maxlength="25"></label><label>Дата<input name="date" type="date"></label></div><label class="check"><input name="changeSheet" type="checkbox" checked>Добавить лист регистрации изменений из шаблона</label><p id="export-warnings" class="warning" hidden></p><label id="incomplete-label" class="check" hidden><input name="incomplete" type="checkbox">Я понимаю, что ведомость неполная: перечисленные сборки не раскрыты.</label><div class="dialog-actions"><button type="button" id="export-cancel">Отмена</button><button type="submit" class="primary">Скачать .docx</button></div></form></dialog>
<dialog id="help-dialog"><h2>От PDF до ведомости</h2><ol><li>Добавьте PDF. Текст читается напрямую, сканы распознаются локально.</li><li>Сверьте обозначение каждой сборки с основной надписью. Для раскрытия оно должно совпасть с обозначением позиции в другой сборке.</li><li>Проверьте все страницы, названия, количества и единицы. Исправьте ошибки в таблице и подтвердите проверку.</li><li>На вкладке «Общая ведомость» проверьте пути входимости и суммы. Выгрузите Word.</li></ol><p>Укажите количество головных изделий. Например, две сборки по три контакта дадут шесть контактов. Сборки сохраняются в своём разделе, а их содержимое раскрывается отдельно.</p><p>Рамка перенесена из исходного Word. Перед выпуском документа проверьте его в Microsoft Word: шрифты и переносы могут отличаться между редакторами.</p><p>Не все форматы спецификаций распознаются одинаково. Повернутые, плохо отсканированные и нестандартные листы могут потребовать ручного ввода.</p><button id="help-close" class="primary">Понятно</button></dialog>`;

function toast(text,error=false) { const el=$('toast');el.textContent=text;el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,error?14000:5000); }
function saveLocal() {try {localStorage.setItem(STORE,JSON.stringify({version:1,assemblies}));}catch {toast('Не удалось сохранить в браузере. Скачайте проект кнопкой «Сохранить проект».',true);}}
function download(blob,name) {const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function selectedAssembly(){return assemblies[selected];}
function invalidate(a) {a.reviewed=false;saveLocal();renderList();}
function renderList() {
  $('count').textContent=assemblies.length;
  $('stats').textContent=assemblies.length?`${assemblies.length} спецификаций · ${assemblies.reduce((s,a)=>s+a.items.length,0)} позиций · ${assemblies.filter(a=>a.reviewed).length} проверено`:'Добавьте первые спецификации';
  $('assemblies').innerHTML=assemblies.length?assemblies.map((a,i)=>`<button class="assembly ${selected===i?'selected':''}" data-index="${i}"><span class="assembly-top"><span class="file-icon">PDF</span><span class="dot ${a.reviewed?'done':''}"></span></span><strong>${escape(a.code)}</strong><small>${a.items.length} позиций · ${a.reviewed?'Проверено':'Нужна проверка'}</small></button>`).join(''):'<div class="aside-empty">Здесь появятся<br>ваши спецификации</div>';
  $('assemblies').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{selected=Number(btn.dataset.index);render();});
}
function render(){renderList();renderContent();}
function renderContent(){
  $('items-tab').classList.toggle('active',tab==='items');$('summary-tab').classList.toggle('active',tab==='summary');
  if(!assemblies.length){$('content').innerHTML='<div class="empty"><div class="empty-icon">＋</div><h3>Начните с ваших PDF</h3><p>Добавьте спецификации изделий и вложенных сборок.<br>Можно выбрать сразу несколько файлов.</p><button id="empty-add" class="primary">Выбрать спецификации</button><small>PDF с текстом и сканы · обработка на вашем компьютере</small></div>';$('empty-add').onclick=()=>!busy&&$('pdf-input').click();return;}
  if(tab==='summary'){renderSummary();return;}
  const a=selectedAssembly();
  $('content').innerHTML=`<div class="assembly-details"><label>Обозначение сборки<input id="assembly-code" value="${escape(a.code)}"></label><label>Наименование<input id="assembly-name" value="${escape(a.name)}"></label><label class="quantity-label">Кол-во изделий<input id="assembly-quantity" value="${escape(a.root_quantity)}" inputmode="decimal"></label></div><div class="source-row"><button id="source">Открыть исходный PDF ↗</button><button id="remove-assembly" class="danger">Удалить спецификацию</button></div><details class="warnings"><summary>Что проверить перед расчётом</summary><ul>${a.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></details><div class="table-scroll"><table class="positions"><thead><tr><th>Раздел</th><th>Поз.</th><th>Обозначение / ГОСТ</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Поставщик</th><th>Примечание</th><th>Лист</th><th></th></tr></thead><tbody>${a.items.map((item,i)=>`<tr data-item="${i}">${['section','position','code','name','quantity','unit','supplier','note','page'].map(key=>`<td>${key==='section'?`<select data-key="section" aria-label="Раздел позиции ${i+1}">${SECTIONS.map(s=>`<option ${s===item.section?'selected':''}>${s}</option>`).join('')}</select>`:`<input data-key="${key}" aria-label="${key}, позиция ${i+1}" value="${escape(item[key])}" ${['quantity','page'].includes(key)?'inputmode="decimal"':''}>`}</td>`).join('')}<td><button class="remove-item" title="Удалить позицию" aria-label="Удалить позицию ${i+1}">×</button></td></tr>`).join('')}</tbody></table></div><div class="table-bottom"><button id="add-item">＋ Добавить позицию</button><label class="check"><input id="reviewed" type="checkbox" ${a.reviewed?'checked':''}>Все страницы и количества сверены с PDF</label></div>`;
  for(const [id,key] of [['assembly-code','code'],['assembly-name','name'],['assembly-quantity','root_quantity']])$(id).onchange=e=>{a[key]=e.target.value.trim();invalidate(a);$('reviewed').checked=false;};
  document.querySelectorAll('tr[data-item]').forEach(row=>{
    row.querySelectorAll('[data-key]').forEach(input=>input.onchange=()=>{const key=input.dataset.key;a.items[Number(row.dataset.item)][key]=key==='page'?Math.max(1,Number(input.value)||1):input.value.trim();invalidate(a);$('reviewed').checked=false;});
    row.querySelector('.remove-item').onclick=()=>{if(confirm('Удалить эту позицию из проекта?')){a.items.splice(Number(row.dataset.item),1);invalidate(a);renderContent();}};
  });
  $('add-item').onclick=()=>{a.items.push(emptyItem());invalidate(a);renderContent();};
  $('remove-assembly').onclick=()=>{if(confirm('Удалить спецификацию из проекта? Исходный PDF останется у вас.')){assemblies.splice(selected,1);selected=Math.max(0,Math.min(selected,assemblies.length-1));saveLocal();render();}};
  $('source').onclick=()=>{const url=previews.get(a.source);if(url)window.open(url,'_blank','noopener');else toast('Исходный PDF не хранится в файле проекта. Откройте его на компьютере для сверки.',true);};
  $('reviewed').onchange=e=>{try{if(e.target.checked){if(!a.items.length)throw Error('Добавьте позиции спецификации.');for(const i of a.items){number(i.quantity);if(!i.name.trim())throw Error('Заполните наименования всех позиций.');if(i.section!=='Документация'&&!i.unit.trim())throw Error('Укажите единицы измерения: некоторые не удалось распознать.');}}a.reviewed=e.target.checked;saveLocal();renderList();}catch(err){e.target.checked=false;toast(err.message,true);}};
}
function renderSummary(){try{const result=aggregate(assemblies);$('content').innerHTML=`<div class="summary-info"><strong>${result.groups.length} уникальных позиций</strong><p>Головные изделия: ${result.roots.map(escape).join(', ')}. Количества учитывают вложенность. Непроверенные данные дают предварительный результат.</p>${result.warnings.length?`<p class="warning">${result.warnings.map(escape).join('<br>')}</p>`:''}</div><div class="table-scroll"><table class="summary-table"><thead><tr><th>Наименование</th><th>Обозначение</th><th>Применяемость и количество</th><th>Всего</th></tr></thead><tbody>${result.groups.map(g=>`<tr><td><small>${escape(g.item.section)}</small>${escape(g.item.name)}</td><td>${escape(g.item.code)}</td><td>${[...g.usages].map(([p,q])=>`<div>${escape(p)} <b>${g.item.section==='Документация'?'':escape(fmt(q))+' '+escape(g.item.unit)}</b></div>`).join('')}</td><td><strong>${g.item.section==='Документация'?'—':escape(fmt(g.total))+' '+escape(g.item.unit)}</strong></td></tr>`).join('')}</tbody></table></div>`;}catch(err){$('content').innerHTML=`<div class="summary-info"><h3>Нужно уточнить данные</h3><p class="warning">${escape(err.message)}</p></div>`;}}

function setBusy(value){busy=value;for(const id of ['add','load','export','items-tab','summary-tab'])$(id).disabled=value;$('progress').hidden=!value;document.querySelector('.workgrid').inert=value;}
$('add').onclick=()=>$('pdf-input').click();
$('pdf-input').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length||busy)return;
  setBusy(true);abortController=new AbortController();
  try {for(const file of files){if(abortController.signal.aborted)break;try{
    const a=await importPDF(file,text=>$('progress-text').textContent=text,abortController.signal);
    if(previews.has(a.source))URL.revokeObjectURL(previews.get(a.source));previews.set(a.source,URL.createObjectURL(file));assemblies.push(a);selected=assemblies.length-1;saveLocal();render();
  }catch(err){toast(`${file.name}: ${abortController.signal.aborted?'импорт отменён':err.message}`,true);}}}
  finally{setBusy(false);render();}
};
$('cancel').onclick=()=>abortController?.abort();
$('save').onclick=()=>download(new Blob([JSON.stringify({version:1,assemblies},null,2)],{type:'application/json'}),'Ведомость-проект.json');
$('load').onclick=()=>$('project-input').click();
$('project-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>30*1024*1024)throw Error('Проект больше 30 МБ. Разделите его на несколько изделий.');const loaded=validateProject(JSON.parse(await file.text()));if(assemblies.length&&!confirm('Заменить текущий проект? Сохраните его копию перед заменой.'))return;assemblies=loaded;selected=0;saveLocal();render();}catch(err){toast(err.message,true);}};
$('items-tab').onclick=()=>{tab='items';renderContent();};$('summary-tab').onclick=()=>{tab='summary';renderContent();};
$('help').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
$('export').onclick=()=>{try{if(assemblies.some(a=>!a.reviewed))throw Error('Сначала сверьте каждую спецификацию с PDF и подтвердите проверку.');const {warnings}=aggregate(assemblies);$('export-warnings').textContent=warnings.join('\n');$('export-warnings').hidden=!warnings.length;$('incomplete-label').hidden=!warnings.length;$('export-form').elements.incomplete.checked=false;$('export-dialog').showModal();}catch(err){toast(err.message,true);}};
$('export-cancel').onclick=()=>$('export-dialog').close();
$('export-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const {groups,warnings}=aggregate(assemblies),data=new FormData(e.target);if(warnings.length&&!data.has('incomplete'))throw Error('Подтвердите выгрузку неполной ведомости или добавьте недостающие спецификации.');const meta=Object.fromEntries(data);meta.changeSheet=data.has('changeSheet');if(meta.date)meta.date=meta.date.split('-').reverse().join('.');const blob=await exportWord(groups,meta);download(blob,'Сводная-ведомость.docx');if(warnings.length)download(new Blob([warnings.join('\n')],{type:'text/plain;charset=utf-8'}),'Нераскрытые-сборки.txt');$('export-dialog').close();toast('Word сохранён. Проверьте оформление и переносы перед выпуском.');}catch(err){toast(err.message,true);}finally{button.disabled=false;}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installedPrompt=e;$('install').hidden=false;});
window.addEventListener('beforeunload',()=>document.activeElement?.blur());
$('install').onclick=async()=>{await installedPrompt?.prompt();installedPrompt=null;$('install').hidden=true;};
async function offlineSetup(){
  if(!('serviceWorker' in navigator)){ $('offline').textContent='Для офлайн-режима откройте через HTTPS или Windows-пакет';return;}
  try{
    await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'});
    await navigator.serviceWorker.ready;
    $('offline').textContent='● Готово к работе офлайн';$('offline').classList.add('ready');
    if(navigator.storage?.persist)await navigator.storage.persist();
  }catch{$('offline').textContent='Офлайн-компоненты не сохранены. Проверьте подключение и место на диске.';}
}
render();offlineSetup();
