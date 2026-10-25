import Decimal from 'decimal.js';
export const SECTIONS = ['Сборочные единицы', 'Детали', 'Документация', 'Стандартные изделия', 'Материалы', 'Прочие изделия'];
export const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().replaceAll('ё', 'е');
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
    return copy;
  });
}
export function aggregate(assemblies, roots) {
  if (!assemblies.length) throw Error('Добавьте спецификации.');
  const lookup = new Map();
  for (const a of assemblies) {
    if (!norm(a.code)) throw Error('Введите обозначение каждой сборки.');
    if (lookup.has(norm(a.code))) throw Error(`Две спецификации с одним обозначением: ${a.code}`);
    if (!a.items.length) throw Error(`${a.code}: нет позиций. Сверьте PDF и добавьте пропущенные строки.`);
    lookup.set(norm(a.code), a);
    for (const i of a.items) {
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
      if (previous && ['name','supplier','note'].some(k => norm(previous.item[k]) !== norm(i[k]))) throw Error(`Различаются наименование, поставщик или примечание одинаковой позиции «${i.code || i.name}». Уточните данные.`);
      const group = previous ?? {item:i, usages:new Map(), total:new Decimal(0)};
      const amount = number(i.quantity).times(multiplier), usage = path.join(' → ');
      group.usages.set(usage, (group.usages.get(usage) ?? new Decimal(0)).plus(amount));
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
    const a = lookup.get(norm(code));
    if (!a) throw Error(`Не найдена сборка ${code}`);
    const count = number(a.root_quantity);
    if (count.isZero()) throw Error(`${code}: количество изделий должно быть больше нуля.`);
    walk(a,count,[a.code]);
  }
  return {groups:[...groups.values()].sort((a,b) => SECTIONS.indexOf(a.item.section)-SECTIONS.indexOf(b.item.section) || a.item.name.localeCompare(b.item.name,'ru') || a.item.code.localeCompare(b.item.code,'ru')), warnings:[...warnings], roots:top};
}
