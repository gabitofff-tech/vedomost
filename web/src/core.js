import Decimal from 'decimal.js';
export const SECTIONS = ['Сборочные единицы', 'Детали', 'Документация', 'Стандартные изделия', 'Материалы', 'Прочие изделия'];
export const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replaceAll('ё', 'е');
export const compactCode = value => String(value ?? '').replace(/\s+/gu, '').replace(/[−–—]/g, '-');
const isPart = item => ['Детали','Сборочные единицы'].includes(item.section);
export function normalizeAssembly(assembly) {
  let previous = null;
  const items = assembly.items.map(source => {
    const item = {...source};
    if (isPart(item)) {
      item.code = compactCode(item.code);
      if (/^-\d+$/.test(item.code) && previous?.section === item.section && previous.code && !previous.code.startsWith('-')) {
        item.code = previous.code.replace(/-\d+$/, '') + item.code;
        if (!String(item.name ?? '').trim()) item.name = previous.name;
      }
    }
    previous = item;
    return item;
  });
  return {...assembly, code:compactCode(assembly.code), items};
}
export function number(value) {
  let q;
  try { q = new Decimal(String(value).trim().replace(',', '.')); } catch { throw Error(`Неверное количество: «${value}»`); }
  if (!q.isFinite() || q.isNegative()) throw Error(`Количество должно быть конечным и неотрицательным: ${value}`);
  return q;
}
export const fmt = n => new Decimal(n).toFixed().replace('.', ',');
export const emptyItem = () => ({section:'Детали', position:'', code:'', name:'', quantity:'1', unit:'шт.', supplier:'', note:'', page:1});
export function validateProject(value) {
  if (value?.version !== 1 || !Array.isArray(value.assemblies) || value.assemblies.length > 2000) throw Error('Неверный формат проекта или слишком много сборок.');
  return value.assemblies.map(a => {
    if (!Array.isArray(a.items) || a.items.length > 50000) throw Error('Неверный список позиций.');
    const copy = {code:String(a.code ?? ''), name:String(a.name ?? ''), source:String(a.source ?? ''), root_quantity:String(a.root_quantity ?? '1'), reviewed:a.reviewed === true, warnings:Array.isArray(a.warnings) ? a.warnings.map(String) : []};
    copy.items = a.items.map(item => Object.fromEntries(Object.entries(emptyItem()).map(([key, initial]) => [key, key === 'page' ? Math.max(1, Number(item[key]) || 1) : String(item[key] ?? initial)])));
    return normalizeAssembly(copy);
  });
}
export function aggregate(assemblies, roots) {
  assemblies = assemblies.map(normalizeAssembly);
  if (!assemblies.length) throw Error('Добавьте спецификации.');
  const lookup = new Map();
  for (const a of assemblies) {
    if (!norm(a.code)) throw Error('Введите обозначение каждой сборки.');
    if (lookup.has(norm(a.code))) throw Error(`Две спецификации с одним обозначением: ${a.code}`);
    if (!a.items.length) throw Error(`${a.code}: нет позиций. Сверьте PDF и добавьте пропущенные строки.`);
    lookup.set(norm(a.code), a);
    for (const i of a.items) {
      if (isPart(i) && /^-\d+$/.test(i.code)) throw Error(`${a.code}: исполнение ${i.code} не имеет предыдущего полного обозначения. Введите его вручную.`);
      if (!SECTIONS.includes(i.section) || !norm(i.name)) throw Error(`${a.code}: проверьте раздел и наименование позиции ${i.position}.`);
      if (number(i.quantity).isZero() && i.section !== 'Документация') throw Error(`${a.code}: нулевое количество позиции ${i.position}.`);
      if (i.section !== 'Документация' && !norm(i.unit)) throw Error(`${a.code}: укажите единицу измерения позиции ${i.position}.`);
    }
  }
  const seen = new Set();
  function validate(a, path) {
    const key = norm(a.code);
    if (path.includes(key)) throw Error(`Циклическая входимость: ${[...path,key].join(' → ')}`);
    if (seen.has(key)) return;
    if (path.length > 100) throw Error('Вложенность больше 100 уровней. Проверьте связи сборок.');
    for (const i of a.items) if (i.section === 'Сборочные единицы' && lookup.has(norm(i.code))) validate(lookup.get(norm(i.code)), [...path,key]);
    seen.add(key);
  }
  assemblies.forEach(a => validate(a, []));
  const referenced = new Set(assemblies.flatMap(a => a.items.filter(i => i.section === 'Сборочные единицы').map(i => norm(i.code))));
  const top = roots ?? assemblies.filter(a => !referenced.has(norm(a.code))).map(a => a.code);
  if (!top.length) throw Error('Не найдено головное изделие.');
  const groups = new Map(), warnings = new Set();
  let visits = 0;
  function walk(a, multiplier, path) {
    if (++visits > 100000) throw Error('Слишком много путей входимости. Разделите проект на несколько изделий.');
    for (const i of a.items) {
      const parts = ['Детали','Сборочные единицы'].includes(i.section) && norm(i.code) ? [i.section,i.code,i.unit] : [i.section,i.code,i.name,i.unit];
      const key = JSON.stringify(parts.map(norm));
      const previous = groups.get(key);
      const group = previous ?? {item:i, usages:new Map(), usageDetails:new Map(), variants:false, total:new Decimal(0)};
      const amount = number(i.quantity).times(multiplier), usage = path.join(' → ');
      group.usages.set(usage, (group.usages.get(usage) ?? new Decimal(0)).plus(amount));
      const detailKey = JSON.stringify([usage, ...['name','supplier','note'].map(k => norm(i[k]))]);
      const detail = group.usageDetails.get(detailKey) ?? {path:usage,item:i,quantity:new Decimal(0)};
      detail.quantity = detail.quantity.plus(amount);
      group.usageDetails.set(detailKey,detail);
      if (['name','supplier','note'].some(k => norm(group.item[k]) !== norm(i[k]))) group.variants = true;
      group.total = group.total.plus(amount);
      groups.set(key,group);
      if (i.section === 'Сборочные единицы') {
        const child = lookup.get(norm(i.code));
        if (child) walk(child, amount, [...path,child.code]);
        else warnings.add(`Не раскрыта сборка ${i.code || i.name} (входит в ${usage})`);
      }
    }
  }
  for (const code of top) {
    const a = lookup.get(norm(compactCode(code)));
    if (!a) throw Error(`Не найдена сборка ${code}`);
    const count = number(a.root_quantity);
    if (count.isZero()) throw Error(`${code}: количество изделий должно быть больше нуля.`);
    walk(a,count,[a.code]);
  }
  return {groups:[...groups.values()].sort((a,b) => SECTIONS.indexOf(a.item.section)-SECTIONS.indexOf(b.item.section) || a.item.name.localeCompare(b.item.name,'ru') || a.item.code.localeCompare(b.item.code,'ru')), warnings:[...warnings], roots:top};
}

// Output selection is applied only after the complete assembly calculation.
export function selectReportGroups(groups, sections) {
  if (!Array.isArray(sections) || !sections.length) throw Error('Выберите хотя бы один раздел для ТВК.');
  if (sections.some(s => !SECTIONS.includes(s))) throw Error('Неизвестный раздел ведомости.');
  const selected = groups.filter(g => sections.includes(g.item.section));
  if (!selected.length) throw Error('В выбранных разделах нет позиций.');
  return selected;
}

export function reportSections(project) {
  return Array.isArray(project?.report_sections)
    ? SECTIONS.filter(s => project.report_sections.includes(s))
    : [...SECTIONS];
}

// The inspection tree intentionally remains navigable before OCR is corrected.
// Unknown quantities stay null; missing/cyclic/ambiguous links never get expanded.
export function buildStructure(assemblies, rootIndex = null, maxNodes = 5000) {
  assemblies = assemblies.map(normalizeAssembly);
  const lookup = new Map(), warnings = new Set();
  assemblies.forEach((a,index) => {
    const key = norm(a.code);
    if (key) lookup.set(key, [...(lookup.get(key) ?? []), index]);
  });
  const referenced = new Set(assemblies.flatMap(a => a.items.filter(i => i.section === 'Сборочные единицы').map(i => norm(i.code))));
  let rootIndices = assemblies.map((a,i) => i).filter(i => !referenced.has(norm(assemblies[i].code)));
  if (rootIndex !== null) {
    if (!Number.isInteger(rootIndex) || !assemblies[rootIndex]) throw Error('Выберите существующую спецификацию.');
    rootIndices = [rootIndex];
  } else if (assemblies.length && !rootIndices.length) {
    rootIndices = assemblies.map((_a,i) => i);
    warnings.add('Не найдено головное изделие. Показаны все спецификации: проверьте циклы входимости.');
  }
  // Include disconnected cycles too, so no loaded specification disappears.
  if (rootIndex === null) {
    const reached = new Set();
    function mark(index) {
      if (reached.has(index)) return;
      reached.add(index);
      for (const i of assemblies[index].items) if (i.section === 'Сборочные единицы') {
        for (const child of lookup.get(norm(i.code)) ?? []) mark(child);
      }
    }
    rootIndices.forEach(mark);
    assemblies.forEach((_a,index) => {
      if (!reached.has(index)) {
        rootIndices.push(index); mark(index);
        warnings.add('Есть отдельная группа сборок без головного изделия. Проверьте циклы и повторяющиеся обозначения.');
      }
    });
  }
  let count = 0, truncated = false;
  const quantity = value => {try {return number(value);} catch {return null;}};
  function children(index,multiplier,path,prefix) {
    const output = [];
    for (const [itemIndex,item] of assemblies[index].items.entries()) {
      if (++count > maxNodes) {truncated = true;break;}
      const q = quantity(item.quantity);
      const node = {id:`${prefix}.${itemIndex+1}`,assemblyIndex:index,itemIndex,code:item.code,name:item.name,section:item.section,unit:item.unit,quantity:q,total:q !== null && multiplier !== null ? q.times(multiplier) : null,children:[],status:'ready',message:'',linkedAssembly:null};
      if (q === null || (q.isZero() && item.section !== 'Документация')) {node.status='invalid';node.message='Проверьте количество';}
      if (item.section === 'Сборочные единицы') {
        const matches = lookup.get(norm(item.code)) ?? [];
        if (!matches.length) {node.status='unresolved';node.message='Нет спецификации';}
        else if (matches.length > 1) {node.status='ambiguous';node.message='Несколько спецификаций с этим обозначением';}
        else if (path.includes(matches[0])) {node.status='cycle';node.message='Циклическая входимость';}
        else if (path.length >= 100) {node.status='limited';node.message='Больше 100 уровней вложенности';}
        else {
          node.linkedAssembly=matches[0];
          node.children=children(matches[0],node.total,[...path,matches[0]],node.id);
        }
      }
      output.push(node);
    }
    return output;
  }
  const roots = rootIndices.map((index,n) => {
    const a=assemblies[index],q=quantity(a.root_quantity);
    return {id:String(n+1),assemblyIndex:index,itemIndex:null,code:a.code,name:a.name,section:'Изделие',unit:'шт.',quantity:q,total:q,children:children(index,q,[index],String(n+1)),status:q === null || q.isZero()?'invalid':'ready',message:q === null || q.isZero()?'Проверьте количество изделий':'',linkedAssembly:index};
  });
  if (truncated) warnings.add(`Показаны первые ${maxNodes} позиций структуры. Выберите отдельную спецификацию для просмотра. Расчёт ТВК выполняется по полным данным.`);
  return {roots,warnings:[...warnings],truncated};
}
