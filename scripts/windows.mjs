import fs from 'node:fs/promises';
import path from 'node:path';
import { packager } from '@electron/packager';
const staging=path.resolve('release/windows-app');
await fs.rm(staging,{recursive:true,force:true});
await fs.mkdir(staging,{recursive:true});
await fs.cp('web/dist',path.join(staging,'site'),{recursive:true});
await fs.copyFile('desktop/main.cjs',path.join(staging,'main.cjs'));
await fs.copyFile('desktop/server.cjs',path.join(staging,'server.cjs'));
await fs.writeFile(path.join(staging,'package.json'),JSON.stringify({name:'vedomost',version:'2.0.0',main:'main.cjs',private:true}));
const results=await packager({dir:staging,out:path.resolve('release'),platform:'win32',arch:'x64',electronVersion:'45.0.0',name:'Vedomost',icon:path.resolve('desktop/icon.ico'),overwrite:true,asar:true,prune:false,download:{cacheRoot:path.resolve('.electron-cache')}});
for(const dir of results){
  await fs.writeFile(path.join(dir,'Open-browser.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0Vedomost.exe" --browser\r\n');
  await fs.writeFile(path.join(dir,'README-RU.txt'),'ВЕДОМОСТЬ — WINDOWS x64\r\n\r\nРаспакуйте всю папку. Запустите Vedomost.exe для отдельного окна или Open-browser.cmd для браузера. Python, Node.js и интернет для работы не нужны.\r\n\r\nВ браузерном режиме программа остаётся в области уведомлений Windows. Для завершения выберите «Выход» в меню значка.\r\n\r\nПроекты в окне приложения и в обычном браузере хранятся отдельно. Для переноса используйте «Сохранить проект» и «Открыть проект». Исходные PDF храните отдельно.\r\n\r\nВсе количества после распознавания нужно сверить с PDF. Перед выпуском проверьте Word.\r\n\r\nСборка использует официальный Electron. Результаты проверок указаны в описании релиза. Электронной подписи издателя у этой сборки нет.\r\n','utf8');
  console.log('Windows package:',dir);
}
