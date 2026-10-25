import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('web/dist');
async function list(dir){const paths=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())paths.push(...await list(p));else if(entry.name!=='sw.js')paths.push(p);}return paths;}
const files=(await list(root)).sort();const hash=crypto.createHash('sha256');
for(const file of files){hash.update(path.relative(root,file));hash.update(await fs.readFile(file));}
const version=hash.digest('hex').slice(0,16),urls=files.map(file=>'./'+path.relative(root,file).split(path.sep).join('/'));
await fs.writeFile(path.join(root,'sw.js'),`const CACHE='vedomost-${version}';
const FILES=${JSON.stringify(urls)};
const allowed=new Set(FILES.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(let i=0;i<FILES.length;i+=8){await cache.addAll(FILES.slice(i,i+8));}await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const names=(await caches.keys()).filter(k=>k.startsWith('vedomost-'));for(const name of names.slice(0,-2))if(name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);url.search='';const navigation=event.request.mode==='navigate'&&url.href.startsWith(self.registration.scope);if(!navigation&&!allowed.has(url.href))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(navigation?'./index.html':url.href);return cached||fetch(event.request);})());});
`);
console.log('Precached',urls.length,'assets; version',version);
