import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate, emptyItem, validateProject, fmt, normalizeAssembly, buildStructure} from '../src/core.js';
import {reportPages} from '../src/word.js';
const item=values=>({...emptyItem(),name:'Деталь',code:'D',...values});
const assembly=(code,items,root_quantity='1')=>({code,name:code,items,root_quantity,reviewed:true});
test('nested multipliers and direct occurrences retain immediate parents',()=>{
  const result=aggregate([assembly('R',[item({section:'Сборочные единицы',code:'S',name:'Сборка',quantity:'4'}),item({})],'2'),assembly('S',[item({quantity:'3'})])]);
  const g=result.groups.find(g=>g.item.code==='D');assert.equal(fmt(g.total),'26');assert.equal(fmt(g.usages.get('S')),'24');assert.equal(fmt(g.usages.get('R')),'2');assert.deepEqual(result.roots,['R']);
});
test('same part across independent assemblies is merged',()=>{const {groups}=aggregate([assembly('A',[item({})]),assembly('B',[item({quantity:'2'})])]);assert.equal(groups.length,1);assert.equal(fmt(groups[0].total),'3');assert.equal(groups[0].usages.size,2);});
test('decimal quantities are exact',()=>{const {groups}=aggregate([assembly('A',[item({quantity:'0,1',unit:'м'}),item({quantity:'0,2',unit:'м'})])]);assert.equal(fmt(groups[0].total),'0,3');});
test('units and standard-item sizes are distinct',()=>{const {groups}=aggregate([assembly('A',[item({section:'Стандартные изделия',name:'Винт М3'}),item({section:'Стандартные изделия',name:'Винт М4'}),item({unit:'м'}),item({unit:'кг'})])]);assert.equal(groups.length,4);});
test('cycles are detected even without a root',()=>{assert.throws(()=>aggregate([assembly('A',[item({section:'Сборочные единицы',code:'B'})]),assembly('B',[item({section:'Сборочные единицы',code:'A'})])]),/Циклическая/);});
test('different descriptions merge without losing source-specific metadata',()=>{
  const input=[assembly('A',[item({name:'Один',supplier:'Завод 1',note:'Для A',quantity:'2'}),item({name:'Другой',supplier:'Завод 2',note:'Для B',quantity:'3'})]),assembly('B',[item({name:'Другой',supplier:'Завод 2',note:'Для B'})])];
  const before=JSON.stringify(input),{groups}=aggregate(input),g=groups[0];
  assert.equal(groups.length,1);assert.equal(fmt(g.total),'6');assert.equal(fmt(g.usages.get('A')),'5');assert.equal(g.usageDetails.size,3);assert.equal(g.variants,true);
  const rows=reportPages(groups).flat();
  assert.ok(rows.some(r=>r[1]==='Один'&&r[3]==='Завод 1'&&r[4]==='A'&&r[5]==='2'&&r[6]==='Для A'));
  assert.ok(rows.some(r=>r[1]==='Другой'&&r[3]==='Завод 2'&&r[4]==='A'&&r[5]==='3'&&r[6]==='Для B'));
  assert.ok(rows.some(r=>r[4]==='B'&&r[5]==='1'&&r[6]==='Для B'));
  assert.equal(JSON.stringify(input),before,'Calculation does not rewrite source metadata');
});
test('duplicate assembly codes are rejected',()=>{assert.throws(()=>aggregate([assembly('A',[item({})]),assembly('A',[item({})])]),/Две спецификации/);});
test('missing assembly is explicit and retained',()=>{const result=aggregate([assembly('A',[item({section:'Сборочные единицы',code:'MISSING',quantity:'2'})])]);assert.match(result.warnings[0],/MISSING/);assert.equal(fmt(result.groups[0].total),'2');});
test('empty and invalid quantities cannot silently disappear',()=>{for(const value of ['','NaN','Infinity','-1','1 м'])assert.throws(()=>aggregate([assembly('A',[item({quantity:value})])]));assert.throws(()=>aggregate([assembly('A',[])]),/нет позиций/);});
test('project import is compatible with Python format and drops unknown properties',()=>{const project=validateProject({version:1,assemblies:[{...assembly('A',[item({})]),source:'a.pdf',warnings:['OCR'],injected:'ignored'}]});assert.equal(project[0].items[0].name,'Деталь');assert.equal(project[0].injected,undefined);assert.throws(()=>validateProject({version:99,assemblies:[]}),/формат/);});
test('pagination retains every usage and total',()=>{const {groups}=aggregate([assembly('A',[item({})]),assembly('B',[item({quantity:'2'})])]);const pages=reportPages(groups);const cells=pages.flat(2);assert.ok(cells.includes('A'));assert.ok(cells.includes('B'));assert.ok(cells.includes('=3'));});
test('large report has first-page and continuation capacities',()=>{const {groups}=aggregate([assembly('A',Array.from({length:60},(_,i)=>item({code:'D'+i,name:'Деталь '+i})))]);const pages=reportPages(groups);assert.ok(pages.length>2);assert.ok(pages[0].length<=23);assert.ok(pages.slice(1).every(p=>p.length<=29));for(let i=0;i<60;i++)assert.ok(pages.flat(2).includes('D'+i));});

test('codes are compact and sequential executions replace rather than stack suffixes',()=>{
  const a=normalizeAssembly(assembly(' R . 001 ',[item({code:'ХХХХ. 0123456. 789'}),item({code:' - 01',name:'',page:2}),item({code:'–02',name:''}),item({section:'Стандартные изделия',code:'ГОСТ 123-45'})]));
  assert.equal(a.code,'R.001');assert.deepEqual(a.items.map(i=>i.code),['ХХХХ.0123456.789','ХХХХ.0123456.789-01','ХХХХ.0123456.789-02','ГОСТ 123-45']);assert.equal(a.items[1].name,'Деталь');
  assert.deepEqual(normalizeAssembly(a),a);
});
test('space normalization connects assemblies and merges shared parts',()=>{
  const input=[assembly('R',[item({section:'Сборочные единицы',code:'S . 1',quantity:'2'})]),assembly('S.1',[item({code:' D . 1',quantity:'3'})]),assembly('B',[item({code:'D.1'})])];
  const {groups,warnings}=aggregate(input);assert.deepEqual(warnings,[]);assert.equal(fmt(groups.find(g=>g.item.code==='D.1').total),'7');
  assert.equal(buildStructure(input).roots[0].children[0].linkedAssembly,1);
});
test('orphan suffix does not borrow from another section or specification',()=>{
  assert.throws(()=>aggregate([assembly('A',[item({code:'-01'})])]),/предыдущего полного/);
  const a=normalizeAssembly(assembly('A',[item({code:'D'}),item({section:'Сборочные единицы',code:'-01'})]));assert.equal(a.items[1].code,'-01');
});
test('legacy projects normalize codes and keep editions distinct',()=>{
  const [a]=validateProject({version:1,assemblies:[assembly('A',[item({code:'D . 1'}),item({code:'-01'}),item({code:'-02'})])]});
  assert.equal(aggregate([a]).groups.length,3);assert.equal(a.items[2].code,'D.1-02');
});
