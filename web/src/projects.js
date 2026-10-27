import {validateProject,reportSections} from './core.js';
export const LIBRARY_KEY='vedomost-projects-v1';
export const LEGACY_KEY='vedomost-project-v2';
export function cleanProject(value){
  const meta=value?.export_settings??{};
  return {version:1,assemblies:validateProject(value),report_sections:reportSections(value),export_settings:Object.fromEntries(['title','designation','version','date'].map(key=>[key,String(meta[key]??'')])),change_sheet:value.change_sheet!==false};
}
export class ProjectLibrary {
  constructor(storage){
    this.storage=storage;this.raw=storage.getItem(LIBRARY_KEY);
    if(this.raw!==null){
      const data=JSON.parse(this.raw);
      if(data.version!==1||!Array.isArray(data.projects)||!data.projects.length||new Set(data.projects.map(p=>p.id)).size!==data.projects.length||!data.projects.some(p=>p.id===data.activeId))throw Error('Не удалось прочитать список проектов. Сохранённые данные не перезаписаны.');
      this.state={version:1,activeId:data.activeId,projects:data.projects.map(p=>{if(typeof p.id!=='string'||typeof p.name!=='string')throw Error('Неверная запись проекта.');return {...p,data:cleanProject(p.data)};})};
    }else{
      const legacy=storage.getItem(LEGACY_KEY),data=cleanProject(legacy?JSON.parse(legacy):{version:1,assemblies:[]});
      const entry={id:crypto.randomUUID(),name:'Моя ведомость',data};this.state={version:1,activeId:entry.id,projects:[entry]};
      // Keep the old key untouched as a migration backup.
    }
  }
  get active(){return this.state.projects.find(p=>p.id===this.state.activeId);}
  commit(next){
    if(this.storage.getItem(LIBRARY_KEY)!==this.raw)throw Error('Список проектов изменён в другом окне. Сохраните текущий проект в JSON и обновите страницу.');
    const raw=JSON.stringify(next);this.storage.setItem(LIBRARY_KEY,raw);this.raw=raw;this.state=next;
  }
  save(data){this.commit({...this.state,projects:this.state.projects.map(p=>p.id===this.state.activeId?{...p,data:cleanProject(data)}:p)});}
  activate(id){if(!this.state.projects.some(p=>p.id===id))throw Error('Проект не найден.');this.commit({...this.state,activeId:id});}
  create(name,data={version:1,assemblies:[]}){
    const entry={id:crypto.randomUUID(),name:this.uniqueName(name),data:cleanProject(data)};
    this.commit({...this.state,activeId:entry.id,projects:[...this.state.projects,entry]});
  }
  uniqueName(value){const base=String(value??'').trim().slice(0,120)||'Новая ведомость';let name=base,n=2;while(this.state.projects.some(p=>p.name===name))name=`${base} (${n++})`;return name;}
  rename(value){const name=String(value).trim().slice(0,120);if(!name)throw Error('Введите название проекта.');this.commit({...this.state,projects:this.state.projects.map(p=>p.id===this.state.activeId?{...p,name}:p)});}
}
