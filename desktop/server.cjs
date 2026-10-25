const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
exports.createSiteServer=function(root){
  root=path.resolve(root);
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.gz':'application/gzip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  const server=http.createServer((req,res)=>{
    try{
      const origin=`http://127.0.0.1:${server.address().port}/`;
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
      const pathname=decodeURIComponent(new URL(req.url,origin).pathname);
      const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Cache-Control','no-cache');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; object-src 'none'");
      if(req.method==='HEAD'){res.end();return;}fs.createReadStream(filename).on('error',()=>res.destroy()).pipe(res);
    }catch{res.writeHead(400);res.end();}
  });
  return server;
};
