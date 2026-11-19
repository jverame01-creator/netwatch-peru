'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const PORT=Number(process.env.PORT||3080);
const HOST=process.env.HOST||'0.0.0.0';
const sources=[
 {id:'cloudflare',name:'Cloudflare',url:'https://www.cloudflarestatus.com',api:'https://www.cloudflarestatus.com/api/v2/summary.json',type:'Infraestructura'},
 {id:'twilio',name:'Twilio / VoIP',url:'https://status.twilio.com',api:'https://status.twilio.com/api/v2/summary.json',type:'Telefonía'},
 {id:'github',name:'GitHub',url:'https://www.githubstatus.com',api:'https://www.githubstatus.com/api/v2/summary.json',type:'Plataforma'},
 {id:'digitalocean',name:'DigitalOcean',url:'https://status.digitalocean.com',api:'https://status.digitalocean.com/api/v2/summary.json',type:'Cloud'},
 {id:'atlassian',name:'Atlassian',url:'https://status.atlassian.com',api:'https://status.atlassian.com/api/v2/summary.json',type:'Plataforma'}
];
const links=[
 {name:'Claro Perú',url:'https://downdetector.pe/problemas/claro/'},
 {name:'Movistar Perú',url:'https://downdetector.pe/problemas/movistar/'},
 {name:'Entel Perú',url:'https://downdetector.pe/problemas/entel/'},
 {name:'WIN Perú',url:'https://downdetector.pe/'},
 {name:'Cloudflare Radar',url:'https://radar.cloudflare.com/outage-center'},
 {name:'RIPEstat',url:'https://stat.ripe.net/'}
];
let cache=null,updated=0;
let history=[];
const cut=x=>String(x??'').slice(0,1000);
async function fetchOne(s){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const r=await fetch(s.api,{signal:controller.signal,headers:{'User-Agent':'NetWatchPeru/1.0'}});
  if(!r.ok)throw Error('HTTP '+r.status);
  const j=await r.json();
  const incidents=(j.incidents||[]).filter(i=>!['resolved','postmortem'].includes(i.status)).map(i=>({id:s.id+':'+i.id,service:s.name,name:cut(i.name),status:cut(i.status),impact:cut(i.impact||'none'),date:i.created_at,details:cut(i.incident_updates?.[0]?.body||''),url:s.url}));
  return {name:s.name,type:s.type,url:s.url,state:cut(j.status?.indicator||'unknown'),description:cut(j.status?.description||''),incidents};
 }catch(e){return {name:s.name,type:s.type,url:s.url,state:'unknown',description:'Fuente no disponible: '+cut(e.message),incidents:[]};}
 finally{clearTimeout(timer);}
}
async function getStatus(force=false){
 if(!force&&cache&&Date.now()-updated<60000)return cache;
 const services=await Promise.all(sources.map(fetchOne));
 const incidents=services.flatMap(s=>s.incidents);
 const now=new Date().toISOString();
 for(const incident of incidents)if(!history.some(h=>h.id===incident.id))history.unshift({...incident,firstSeen:now});
 history=history.filter(h=>Date.now()-new Date(h.firstSeen).getTime()<7*86400000).slice(0,200);
 cache={updatedAt:now,services:services.map(({incidents,...rest})=>rest),incidents,history,links};
 updated=Date.now();
 return cache;
}
function json(res,obj,code=200){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/health')return json(res,{ok:true});
 if(url.pathname==='/api/status'){try{return json(res,await getStatus())}catch(e){return json(res,{error:e.message},503)}}
 if(url.pathname==='/api/refresh'){try{return json(res,await getStatus(true))}catch(e){return json(res,{error:e.message},503)}}
 if(url.pathname!=='/')return json(res,{error:'Not found'},404);
 fs.readFile(path.join(__dirname,'public','index.html'),(err,data)=>{if(err)return json(res,{error:'Missing frontend'},500);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(data)});
}).listen(PORT,HOST,()=>console.log('NetWatch Perú escuchando en '+HOST+':'+PORT));
