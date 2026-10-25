import './style.css';
import { SECTIONS, emptyItem, aggregate, fmt, validateProject, number, norm, buildStructure, selectReportGroups, reportSections } from './core.js';
import { importPDF } from './reader.js';
import { exportWord } from './word.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE='vedomost-project-v2';
let assemblies=[], selected=0, busy=false, abortController, installedPrompt, tab='sections';
let selectedSections=[...SECTIONS], sectionFilter='', treeRoot=null, treeMode='default';
const treeClosed=new Set(),treeOpened=new Set(),previews=new Map();
try {const saved=JSON.parse(localStorage.getItem(STORE));if(saved){assemblies=validateProject(saved);selectedSections=reportSections(saved);}} catch { /* Do not overwrite unreadable storage before user interaction. */ }
$('app').innerHTML=`
<header class="top"><a class="brand" href="./"><img src="./icon.svg" alt="">Ведомость<span>PDF → WORD</span></a><div class="top-right"><span id="offline" class="badge">Подготовка офлайн-режима…</span><button id="install" class="quiet" hidden>Установить</button><button id="help" class="quiet">Как это работает</button></div></header>
<main><section class="intro"><div><p class="eyebrow">ОТ СПЕЦИФИКАЦИЙ К КОМПЛЕКТАЦИИ</p><h1>Состав изделия.<br><em>Вся структура перед вами.</em></h1><p class="lead">Загрузите PDF, проверьте состав и выберите,<br>какие разделы включить в ведомость Word.</p></div><div class="privacy"><span class="privacy-icon">⌘</span><strong>Документы остаются на компьютере</strong><p>Распознавание, раскрытие сборок и создание Word работают локально, в том числе без интернета.</p><small>Результаты OCR нужно сверить с исходниками.</small></div></section>
<section class="workspace workspace-v3"><div class="toolbar"><div><h2>Рабочий проект</h2><span id="stats">Добавьте первые спецификации</span></div><div class="actions"><button id="load">Открыть проект</button><button id="save">Сохранить проект</button><button id="add" class="primary">＋ Добавить PDF</button></div></div>
<div id="progress" hidden><span id="progress-text"></span><button id="cancel">Отменить</button></div>
<div class="workgrid"><aside class="spec-sidebar"><div class="aside-label">СПЕЦИФИКАЦИИ <span id="count">0</span></div><div id="assemblies"></div><button id="sidebar-add">＋ Вставить PDF</button><p class="aside-note">Выберите спецификацию, чтобы проверить её разделы. Справа — структура всего изделия.</p></aside><div class="content"><div class="tabs"><button id="sections-tab" class="active">По разделам</button><button id="items-tab">Таблица</button><button id="summary-tab">Общая ведомость</button></div><div id="content"></div></div><div class="right-column"><section class="structure-panel"><div class="panel-heading"><h2>Структура изделия</h2><span class="small-label">ВХОДИМОСТЬ</span></div><label class="tree-root-label">Показать в дереве<select id="tree-root"></select></label><div class="tree-tools"><button id="expand-tree">Раскрыть всё</button><button id="collapse-tree">Свернуть всё</button></div><p class="tree-explanation">В строке: <b>на одну сборку → всего</b> с учётом вложенности. Нажмите позицию для исправления.</p><div id="tree-warnings"></div><div id="structure" aria-label="Структура изделия"></div></section><section class="report-panel"><div class="panel-heading"><h2>Сформировать ТВК</h2><span id="section-count" class="small-label"></span></div><p>Какие разделы включить в Word</p><div id="report-sections"></div><button id="select-all-sections" class="quiet">Выбрать все</button><p class="report-note">Сборки раскрываются полностью. Эти флажки меняют только состав отчёта.</p><button id="export" class="primary">Сформировать Word ↗</button><small>Рамка и штампы из вашего шаблона</small></section></div></div></section>
<p class="footnote">Проект сохраняется в этом браузере. Скачивайте JSON для резервной копии и переноса между версиями. Исходные PDF храните отдельно.</p>
</main><div id="toast" role="status" hidden></div>
<input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple hidden><input id="project-input" type="file" accept=".json,application/json" hidden>
<dialog id="export-dialog"><form id="export-form"><p class="eyebrow">ГОТОВО К ВЫГРУЗКЕ</p><h2>Основная надпись</h2><p id="export-selection"></p><label>Наименование изделия<input name="title" value="Изделие" maxlength="100" required></label><label>Обозначение ведомости<input name="designation" value="Ведомость ТВК" maxlength="80" required></label><div class="form-row"><label>Версия<input name="version" value="Версия 0" maxlength="25"></label><label>Дата<input name="date" type="date"></label></div><label class="check"><input name="changeSheet" type="checkbox" checked>Добавить лист регистрации изменений из шаблона</label><p id="export-warnings" class="warning" hidden></p><label id="incomplete-label" class="check" hidden><input name="incomplete" type="checkbox">Я понимаю, что ведомость неполная: перечисленные сборки не раскрыты.</label><p id="export-error" class="warning" role="alert" hidden></p><div class="dialog-actions"><button type="button" id="export-cancel">Отмена</button><button type="submit" class="primary">Скачать .docx</button></div></form></dialog>
<dialog id="help-dialog"><h2>От PDF до ведомости</h2><ol><li>Слева добавьте PDF и выберите спецификацию.</li><li>В центре проверьте её разделы. Нажатие на позицию открывает соответствующую строку таблицы для исправления.</li><li>Справа раскройте структуру изделия. Например, три детали в двух сборках — это шесть деталей всего.</li><li>Сверьте обозначения сборок, все позиции и единицы, затем подтвердите проверку каждой спецификации.</li><li>Отметьте нужные разделы для ТВК и сформируйте Word.</li></ol><p>Дерево показывает предварительные данные даже при ошибках OCR. «Нет спецификации» означает, что содержимое сборки ещё неизвестно. Циклы и неоднозначные связи помечаются и не раскрываются.</p><p>Количество головных изделий задаётся в карточке. Выбор отдельной спецификации в дереве — только режим просмотра; он не меняет расчёт всего проекта. Флажки разделов также не отключают раскрытие вложенных сборок.</p><p>Для запуска в браузере без хостинга используйте Open-browser.cmd из Windows-пакета. Отдельный веб-архив нужно разместить на HTTPS-сайте: двойной щелчок по index.html не запускает приложение.</p><p>Перед выпуском проверьте результат в Word. OCR может ошибаться или пропускать строки; нестандартные и повернутые листы требуют ручной проверки.</p><button id="help-close" class="primary">Понятно</button></dialog>`;

function toast(text,error=false) {const el=$('toast');el.textContent=text;el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,error?14000:5000);}
function project(){return {version:1,assemblies,report_sections:selectedSections};}
function saveLocal(){try{localStorage.setItem(STORE,JSON.stringify(project()));}catch{toast('Не удалось сохранить в браузере. Скачайте проект кнопкой «Сохранить проект».',true);}}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function selectedAssembly(){return assemblies[selected];}
function invalidate(a){a.reviewed=false;saveLocal();renderList();renderRight();}
function renderList(){
  document.body.classList.toggle('has-data',!!assemblies.length);
  $('count').textContent=assemblies.length;
  $('stats').textContent=assemblies.length?`${assemblies.length} спецификаций · ${assemblies.reduce((s,a)=>s+a.items.length,0)} позиций · ${assemblies.filter(a=>a.reviewed).length} проверено`:'Добавьте первые спецификации';
  $('assemblies').innerHTML=assemblies.length?assemblies.map((a,i)=>`<button class="assembly ${selected===i?'selected':''}" data-index="${i}"><span class="assembly-top"><span class="file-icon">PDF</span><span class="dot ${a.reviewed?'done':''}"></span></span><strong>${escape(a.code)}</strong><small>${a.items.length} позиций · ${a.reviewed?'Проверено':'Нужна проверка'}</small></button>`).join(''):'<div class="aside-empty">Здесь появятся<br>ваши спецификации</div>';
  $('assemblies').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{selected=Number(btn.dataset.index);sectionFilter='';if(tab==='summary')tab='sections';render();});
}
function render(){renderList();renderContent();renderRight();}
function assemblyHeading(a){return `<div class="assembly-details"><label>Обозначение сборки<input id="assembly-code" value="${escape(a.code)}"></label><label>Наименование<input id="assembly-name" value="${escape(a.name)}"></label><label class="quantity-label">Кол-во изделий<input id="assembly-quantity" value="${escape(a.root_quantity)}" inputmode="decimal"></label></div><div class="source-row"><button id="source">Открыть исходный PDF ↗</button><button id="remove-assembly" class="danger">Удалить спецификацию</button></div><details class="warnings"><summary>Что проверить перед расчётом</summary><ul>${a.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></details>`;}
function reviewFooter(a){return `<div class="table-bottom"><button id="add-item">＋ Добавить позицию</button><label class="check"><input id="reviewed" type="checkbox" ${a.reviewed?'checked':''}>Все страницы и количества сверены с PDF</label></div>`;}
function openItem(assemblyIndex,itemIndex){
  selected=assemblyIndex;sectionFilter='';tab=itemIndex===null?'sections':'items';render();
  if(itemIndex!==null){const row=document.querySelector(`tr[data-item="${itemIndex}"]`);row?.classList.add('highlight-row');row?.scrollIntoView({block:'nearest',inline:'nearest'});row?.querySelector('[data-key="name"]')?.focus({preventScroll:true});}
}
function bindAssembly(a){
  for(const [id,key] of [['assembly-code','code'],['assembly-name','name'],['assembly-quantity','root_quantity']])$(id).onchange=e=>{a[key]=e.target.value.trim();invalidate(a);$('reviewed').checked=false;};
  $('remove-assembly').onclick=()=>{if(confirm('Удалить спецификацию из проекта? Исходный PDF останется у вас.')){assemblies.splice(selected,1);selected=Math.max(0,Math.min(selected,assemblies.length-1));treeRoot=null;treeClosed.clear();treeOpened.clear();saveLocal();render();}};
  $('source').onclick=()=>{const url=previews.get(a.source);if(url)window.open(url,'_blank','noopener');else toast('Исходный PDF не хранится в JSON. Откройте сохранённый PDF на компьютере для сверки.',true);};
  $('reviewed').onchange=e=>{try{if(e.target.checked){if(!a.items.length)throw Error('Добавьте позиции спецификации.');for(const i of a.items){number(i.quantity);if(!i.name.trim())throw Error('Заполните наименования всех позиций.');if(i.section!=='Документация'&&!i.unit.trim())throw Error('Укажите единицы измерения: некоторые не удалось распознать.');}}a.reviewed=e.target.checked;saveLocal();renderList();}catch(err){e.target.checked=false;toast(err.message,true);}};
  $('add-item').onclick=()=>{const i={...emptyItem(),section:sectionFilter||'Детали'};a.items.push(i);invalidate(a);openItem(selected,a.items.length-1);};
}
function renderContent(){
  for(const name of ['sections','items','summary'])$(name+'-tab').classList.toggle('active',tab===name);
  if(!assemblies.length){$('content').innerHTML='<div class="empty"><div class="empty-icon">＋</div><h3>Начните с ваших PDF</h3><p>Добавьте спецификации изделия и вложенных сборок.<br>Разделы и структура появятся автоматически.</p><button id="empty-add" class="primary">Выбрать спецификации</button><small>PDF с текстом и сканы · обработка на вашем компьютере</small></div>';$('empty-add').onclick=()=>!busy&&$('pdf-input').click();return;}
  if(tab==='summary'){renderSummary();return;}
  const a=selectedAssembly();
  if(tab==='sections'){
    $('content').innerHTML=assemblyHeading(a)+`<div class="section-cards">${SECTIONS.map((section,si)=>{const items=a.items.map((item,index)=>({item,index})).filter(entry=>entry.item.section===section);return `<section class="section-card"><div class="section-heading"><h3>${escape(section)}</h3><span>${items.length}</span><button class="section-add" data-section="${si}" title="Добавить позицию: ${escape(section)}" aria-label="Добавить позицию: ${escape(section)}">＋</button></div><div class="section-items">${items.length?items.map(({item,index})=>`<button class="section-item" data-item="${index}"><span><strong>${escape(item.code||item.name||'Без наименования')}</strong>${item.code?`<small>${escape(item.name)}</small>`:''}</span><span class="item-quantity">${section==='Документация'?'—':escape(item.quantity||'?')+' '+escape(item.unit||'?')}</span></button>`).join(''):'<p class="section-empty">Нет позиций</p>'}</div><button class="section-table" data-section="${si}">Открыть раздел в таблице →</button></section>`;}).join('')}</div>`+reviewFooter(a);
    document.querySelectorAll('.section-item').forEach(btn=>btn.onclick=()=>openItem(selected,Number(btn.dataset.item)));
    document.querySelectorAll('.section-table').forEach(btn=>btn.onclick=()=>{sectionFilter=SECTIONS[Number(btn.dataset.section)];tab='items';renderContent();});
    document.querySelectorAll('.section-add').forEach(btn=>btn.onclick=()=>{a.items.push({...emptyItem(),section:SECTIONS[Number(btn.dataset.section)]});invalidate(a);openItem(selected,a.items.length-1);});
    bindAssembly(a);return;
  }
  const items=a.items.map((item,index)=>({item,index})).filter(entry=>!sectionFilter||entry.item.section===sectionFilter);
  $('content').innerHTML=assemblyHeading(a)+`<div class="table-filter"><label>Раздел<select id="section-filter"><option value="">Все разделы</option>${SECTIONS.map(s=>`<option ${s===sectionFilter?'selected':''}>${s}</option>`).join('')}</select></label><span>${items.length} позиций</span></div><div class="table-scroll"><table class="positions"><thead><tr><th>Раздел</th><th>Поз.</th><th>Обозначение / ГОСТ</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Поставщик</th><th>Примечание</th><th>Лист</th><th></th></tr></thead><tbody>${items.map(({item,index})=>`<tr data-item="${index}">${['section','position','code','name','quantity','unit','supplier','note','page'].map(key=>`<td>${key==='section'?`<select data-key="section" aria-label="Раздел позиции ${index+1}">${SECTIONS.map(s=>`<option ${s===item.section?'selected':''}>${s}</option>`).join('')}</select>`:`<input data-key="${key}" class="${['quantity','unit','name'].includes(key)&&!item[key]?'needs-value':''}" aria-label="${key}, позиция ${index+1}" value="${escape(item[key])}" ${['quantity','page'].includes(key)?'inputmode="decimal"':''}>`}</td>`).join('')}<td><button class="remove-item" title="Удалить позицию" aria-label="Удалить позицию ${index+1}">×</button></td></tr>`).join('')}</tbody></table>${!items.length?'<p class="no-items">В этом разделе пока нет позиций. Добавьте строку ниже.</p>':''}</div>`+reviewFooter(a);
  $('section-filter').onchange=e=>{sectionFilter=e.target.value;renderContent();};
  document.querySelectorAll('tr[data-item]').forEach(row=>{
    row.querySelectorAll('[data-key]').forEach(input=>input.onchange=()=>{const key=input.dataset.key;a.items[Number(row.dataset.item)][key]=key==='page'?Math.max(1,Number(input.value)||1):input.value.trim();input.classList.toggle('needs-value',['quantity','unit','name'].includes(key)&&!input.value.trim());invalidate(a);$('reviewed').checked=false;if(key==='section')renderContent();});
    row.querySelector('.remove-item').onclick=()=>{if(confirm('Удалить эту позицию из проекта?')){a.items.splice(Number(row.dataset.item),1);invalidate(a);renderContent();}};
  });bindAssembly(a);
}
function currentReport(){const result=aggregate(assemblies);return {...result,groups:selectReportGroups(result.groups,selectedSections)};}
function renderSummary(){try{const result=currentReport();$('content').innerHTML=`<div class="summary-info"><strong>${result.groups.length} уникальных позиций в выбранных разделах</strong><p>Головные изделия: ${result.roots.map(escape).join(', ')}. Непроверенные данные дают предварительный результат. Флажки справа определяют разделы отчёта.</p>${result.warnings.length?`<p class="warning">${result.warnings.map(escape).join('<br>')}</p>`:''}</div><div class="table-scroll"><table class="summary-table"><thead><tr><th>Наименование</th><th>Обозначение</th><th>Применяемость и количество</th><th>Всего</th></tr></thead><tbody>${result.groups.map(g=>`<tr><td><small>${escape(g.item.section)}</small>${escape(g.item.name)}</td><td>${escape(g.item.code)}</td><td>${[...g.usages].map(([p,q])=>`<div>${escape(p)} <b>${g.item.section==='Документация'?'':escape(fmt(q))+' '+escape(g.item.unit)}</b></div>`).join('')}</td><td><strong>${g.item.section==='Документация'?'—':escape(fmt(g.total))+' '+escape(g.item.unit)}</strong></td></tr>`).join('')}</tbody></table></div>`;}catch(err){$('content').innerHTML=`<div class="summary-info"><h3>Нужно уточнить данные</h3><p class="warning">${escape(err.message)}</p></div>`;}}
function renderTree(){
  if(treeRoot!==null&&!assemblies[treeRoot])treeRoot=null;
  $('tree-root').innerHTML='<option value="">Все головные изделия</option>'+assemblies.map((a,i)=>`<option value="${i}" ${treeRoot===i?'selected':''}>${escape(a.code||'Без обозначения')}</option>`).join('');
  if(!assemblies.length){$('structure').innerHTML='<p class="tree-empty">Здесь появится дерево изделия<br>с вложенными сборками и деталями.</p>';$('tree-warnings').innerHTML='';return;}
  const result=buildStructure(assemblies,treeRoot);
  $('tree-warnings').innerHTML=result.warnings.map(w=>`<p class="warning">${escape(w)}</p>`).join('');
  function nodeHTML(node){
    const q=node.section==='Документация'?'—':`${node.quantity===null?'?':fmt(node.quantity)} → ${node.total===null?'?':fmt(node.total)} ${escape(node.unit||'?')}`;
    const edit=`data-assembly="${node.assemblyIndex}" data-item="${node.itemIndex===null?'':node.itemIndex}"`;
    const row=`<span class="tree-line"><span class="tree-number">${node.id}</span><button class="tree-position" ${edit} title="Открыть в спецификации ${escape(assemblies[node.assemblyIndex].code)}"><strong>${escape(node.code||node.name||'Без наименования')}</strong>${node.code?`<small>${escape(node.name)}</small>`:''}</button><span class="tree-quantity">${q}</span></span>${node.message?`<span class="tree-issue">${escape(node.message)}</span>`:''}`;
    if(!node.children.length)return `<li class="tree-leaf status-${node.status}">${row}</li>`;
    const opened=treeMode==='open'||(treeMode==='default'&&node.id.split('.').length<=2)||treeOpened.has(node.id);
    return `<li class="tree-branch"><details data-node="${node.id}" ${opened&&!treeClosed.has(node.id)?'open':''}><summary>${row}</summary><ul>${node.children.map(nodeHTML).join('')}</ul></details></li>`;
  }
  $('structure').innerHTML=`<ul class="tree-root-list">${result.roots.map(nodeHTML).join('')}</ul>`;
  $('structure').querySelectorAll('.tree-position').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();openItem(Number(btn.dataset.assembly),btn.dataset.item===''?null:Number(btn.dataset.item));});
  $('structure').querySelectorAll('details').forEach(details=>details.ontoggle=()=>{if(!details.isConnected)return;if(details.open){treeOpened.add(details.dataset.node);treeClosed.delete(details.dataset.node);}else{treeClosed.add(details.dataset.node);treeOpened.delete(details.dataset.node);}});
}
function renderReportControls(){
  $('section-count').textContent=`${selectedSections.length} ИЗ ${SECTIONS.length}`;
  $('report-sections').innerHTML=SECTIONS.map((section,index)=>`<label class="check report-section"><input type="checkbox" data-section="${index}" ${selectedSections.includes(section)?'checked':''}><span>${escape(section)}</span><small title="Строк во входных спецификациях">${assemblies.reduce((sum,a)=>sum+a.items.filter(i=>i.section===section).length,0)}</small></label>`).join('');
  $('report-sections').querySelectorAll('input').forEach(input=>input.onchange=()=>{const section=SECTIONS[Number(input.dataset.section)];selectedSections=SECTIONS.filter(s=>s===section?input.checked:selectedSections.includes(s));saveLocal();renderReportControls();if(tab==='summary')renderSummary();});
}
function renderRight(){renderTree();renderReportControls();}
$('tree-root').onchange=e=>{treeRoot=e.target.value===''?null:Number(e.target.value);treeClosed.clear();treeOpened.clear();renderTree();};
$('expand-tree').onclick=()=>{treeMode='open';treeClosed.clear();renderTree();};$('collapse-tree').onclick=()=>{treeMode='closed';treeOpened.clear();treeClosed.clear();renderTree();};
$('select-all-sections').onclick=()=>{selectedSections=[...SECTIONS];saveLocal();renderReportControls();if(tab==='summary')renderSummary();};
function setBusy(value){busy=value;for(const id of ['add','load','sidebar-add'])$(id).disabled=value;$('progress').hidden=!value;document.querySelector('.workgrid').inert=value;}
for(const id of ['add','sidebar-add'])$(id).onclick=()=>$('pdf-input').click();
$('pdf-input').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length||busy)return;
  setBusy(true);abortController=new AbortController();
  try{for(const file of files){if(abortController.signal.aborted)break;try{
    const a=await importPDF(file,text=>$('progress-text').textContent=text,abortController.signal);
    if(previews.has(a.source))URL.revokeObjectURL(previews.get(a.source));previews.set(a.source,URL.createObjectURL(file));assemblies.push(a);selected=assemblies.length-1;tab='sections';saveLocal();render();
  }catch(err){toast(`${file.name}: ${abortController.signal.aborted?'импорт отменён':err.message}`,true);}}}finally{setBusy(false);render();}
};
$('cancel').onclick=()=>abortController?.abort();
$('save').onclick=()=>download(new Blob([JSON.stringify(project(),null,2)],{type:'application/json'}),'Ведомость-проект.json');
$('load').onclick=()=>$('project-input').click();
$('project-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>30*1024*1024)throw Error('Проект больше 30 МБ. Разделите его на несколько изделий.');const data=JSON.parse(await file.text()),loaded=validateProject(data);if(assemblies.length&&!confirm('Заменить текущий проект? Сохраните его копию перед заменой.'))return;assemblies=loaded;selectedSections=reportSections(data);selected=0;sectionFilter='';treeRoot=null;treeClosed.clear();treeOpened.clear();saveLocal();render();}catch(err){toast(err.message,true);}};
for(const name of ['sections','items','summary'])$(name+'-tab').onclick=()=>{tab=name;renderContent();};
$('help').onclick=()=>$('help-dialog').showModal();$('help-close').onclick=()=>$('help-dialog').close();
$('export').onclick=()=>{try{if(assemblies.some(a=>!a.reviewed))throw Error('Сначала сверьте каждую спецификацию с PDF и подтвердите проверку.');const {warnings,groups}=currentReport();$('export-selection').textContent=`${groups.length} позиций · ${selectedSections.join(', ')}`;$('export-warnings').textContent=warnings.join('\n');$('export-warnings').hidden=!warnings.length;$('incomplete-label').hidden=!warnings.length;$('export-form').elements.incomplete.checked=false;$('export-error').hidden=true;$('export-dialog').showModal();}catch(err){toast(err.message,true);}};
$('export-cancel').onclick=()=>$('export-dialog').close();
$('export-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const {groups,warnings}=currentReport(),data=new FormData(e.target);if(warnings.length&&!data.has('incomplete'))throw Error('Подтвердите выгрузку неполной ведомости или добавьте недостающие спецификации.');const meta=Object.fromEntries(data);meta.changeSheet=data.has('changeSheet');if(meta.date)meta.date=meta.date.split('-').reverse().join('.');const blob=await exportWord(groups,meta);download(blob,'Сводная-ведомость.docx');if(warnings.length)download(new Blob([warnings.join('\n')],{type:'text/plain;charset=utf-8'}),'Нераскрытые-сборки.txt');$('export-dialog').close();toast('Word сохранён. Проверьте оформление и переносы перед выпуском.');}catch(err){$('export-error').textContent=err.message;$('export-error').hidden=false;}finally{button.disabled=false;}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installedPrompt=e;$('install').hidden=false;});
window.addEventListener('beforeunload',()=>document.activeElement?.blur());
$('install').onclick=async()=>{await installedPrompt?.prompt();installedPrompt=null;$('install').hidden=true;};
async function offlineSetup(){
  if(!('serviceWorker' in navigator)){$('offline').textContent='Для офлайн-режима откройте через HTTPS или Windows-пакет';return;}
  try{await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'});await navigator.serviceWorker.ready;$('offline').textContent='● Готово к работе офлайн';$('offline').classList.add('ready');if(navigator.storage?.persist)await navigator.storage.persist();}
  catch{$('offline').textContent='Офлайн-компоненты не сохранены. Проверьте подключение и место на диске.';}
}
render();offlineSetup();
