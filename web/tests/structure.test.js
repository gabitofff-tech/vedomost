import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStructure,aggregate,selectReportGroups,reportSections,emptyItem,fmt,SECTIONS} from '../src/core.js';
const item=values=>({...emptyItem(),code:'D',name:'Деталь',...values});
const a=(code,items,count='1')=>({code,name:code,items,root_quantity:count});
test('inspection tree preserves source indices and all nested multipliers',()=>{
  const tree=buildStructure([a('R',[item({section:'Сборочные единицы',code:'S',quantity:'2'})],'3'),a('S',[item({quantity:'4'})])]);
  const root=tree.roots[0],sub=root.children[0],part=sub.children[0];
  assert.equal(tree.roots.length,1);assert.equal(sub.id,'1.1');assert.equal(part.id,'1.1.1');
  assert.equal(fmt(sub.quantity),'2');assert.equal(fmt(sub.total),'6');assert.equal(fmt(part.total),'24');
  assert.equal(part.assemblyIndex,1);assert.equal(part.itemIndex,0);
});
test('shared subassemblies stay on separate tree paths',()=>{
  const tree=buildStructure([a('A',[item({section:'Сборочные единицы',code:'S',quantity:'2'})]),a('B',[item({section:'Сборочные единицы',code:'S',quantity:'3'})]),a('S',[item({quantity:'4'})])]);
  assert.equal(tree.roots.length,2);assert.equal(fmt(tree.roots[0].children[0].children[0].total),'8');assert.equal(fmt(tree.roots[1].children[0].children[0].total),'12');
});
test('inspection tree shows unknown quantities without inventing a total',()=>{
  const node=buildStructure([a('R',[item({quantity:''})])]).roots[0].children[0];
  assert.equal(node.quantity,null);assert.equal(node.total,null);assert.equal(node.status,'invalid');
});
test('tree marks missing and ambiguous assembly links',()=>{
  const missing=buildStructure([a('R',[item({section:'Сборочные единицы',code:'M'})])]);
  assert.equal(missing.roots[0].children[0].status,'unresolved');
  const duplicate=buildStructure([a('R',[item({section:'Сборочные единицы',code:'S'})]),a('S',[]),a('S',[])]);
  assert.equal(duplicate.roots[0].children[0].status,'ambiguous');assert.deepEqual(duplicate.roots[0].children[0].children,[]);
});
test('a disconnected cycle is visible even beside a valid root',()=>{
  const result=buildStructure([a('R',[item({})]),a('A',[item({section:'Сборочные единицы',code:'B'})]),a('B',[item({section:'Сборочные единицы',code:'A'})])]);
  assert.equal(result.roots.length,2);assert.equal(result.roots[1].children[0].children[0].status,'cycle');assert.ok(result.warnings.length);
});
test('tree size is bounded and reports truncation',()=>{
  const result=buildStructure([a('R',Array.from({length:20},()=>item({})))],null,5);
  assert.equal(result.roots[0].children.length,5);assert.equal(result.truncated,true);assert.ok(result.warnings.length);
});
test('excluding assemblies from Word never excludes their nested parts',()=>{
  const {groups}=aggregate([a('R',[item({section:'Сборочные единицы',code:'S',name:'Сборка',quantity:'2'})],'3'),a('S',[item({quantity:'4'})])]);
  const selected=selectReportGroups(groups,['Детали']);assert.equal(selected.length,1);assert.equal(fmt(selected[0].total),'24');
  assert.equal(selected[0].usages.has('S'),true);assert.throws(()=>selectReportGroups(groups,[]),/Выберите/);
});
test('section selection is backwards compatible and an empty selection stays empty',()=>{
  assert.deepEqual(reportSections({version:1,assemblies:[]}),SECTIONS);
  assert.deepEqual(reportSections({report_sections:[]}),[]);
  assert.deepEqual(reportSections({report_sections:['Детали','invalid']}),['Детали']);
});
