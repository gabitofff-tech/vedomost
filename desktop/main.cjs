const {app,BrowserWindow,Menu,shell,Tray,nativeImage,dialog,clipboard}=require('electron');
const path=require('node:path');
const {createSiteServer}=require('./server.cjs');
const root=path.join(__dirname,'site');
let server,window,tray,origin;
let browserRequested=process.argv.includes('--browser');
async function openBrowser(){
  browserRequested=true;
  try{await shell.openExternal(origin);}catch{
    const result=await dialog.showMessageBox({type:'warning',title:'Браузер не открылся',message:'Программа запущена, но открыть браузер автоматически не удалось.',detail:`Скопируйте этот адрес и откройте его в Chrome или Edge:\n${origin}`,buttons:['Скопировать адрес','Закрыть']});
    if(result.response===0)clipboard.writeText(origin);
  }
}
function openWindow(){
  if(window){window.show();window.focus();return;}
  window=new BrowserWindow({width:1600,height:1000,minWidth:850,minHeight:650,backgroundColor:'#f5f4ef',icon:path.join(root,'icon-192.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{
    if(url.startsWith('blob:'+origin))return {action:'allow',overrideBrowserWindowOptions:{webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}};
    return {action:'deny'};
  });
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin))event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.loadURL(origin);
  window.on('closed',()=>{window=null;if(!browserRequested)app.quit();});
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',(_event,args)=>{if(!origin)return;if(args.includes('--browser'))openBrowser();else openWindow();});
  app.whenReady().then(()=>{
    server=createSiteServer(root);
    // A stable local origin retains projects across restarts. Fail visibly if occupied.
    const port=19745;
    origin=`http://127.0.0.1:${port}/`;
    server.on('error',err=>{dialog.showErrorBox('Не удалось запустить Ведомость',`Порт ${port} занят или недоступен. Закройте другой экземпляр программы и повторите запуск.\n${err.message}`);app.quit();});
    server.listen(port,'127.0.0.1',()=>{
      const menu=[{label:'Ведомость',submenu:[{label:'Открыть в браузере',click:openBrowser},{label:'Закрыть программу',click:()=>app.quit()}]}];
      Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
      tray=new Tray(nativeImage.createFromPath(path.join(root,'icon-192.png')));
      tray.setToolTip('Ведомость — локальная обработка PDF');
      tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть окно программы',click:openWindow},{label:'Открыть в браузере',click:openBrowser},{label:'Выход',click:()=>app.quit()}]));
      if(browserRequested)openBrowser();else openWindow();
    });
  });
  app.on('before-quit',()=>{server?.close();tray?.destroy();});
}
