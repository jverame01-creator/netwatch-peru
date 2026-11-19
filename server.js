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
 {id:'atlassian',name:'Atlassian',url:'https://status.atlassian.com',api:'https://status.atlassian.com/api/v2/summary.json',type:'Plataforma'},
 {id:'upcloud',name:'UpCloud',url:'https://status.upcloud.com',api:'https://status.upcloud.com/api/v2/summary.json',type:'Cloud'}
];
const links=[
 {name:'Claro Perú',url:'https://downdetector.pe/problemas/claro/'},
 {name:'Movistar Perú',url:'https://downdetector.pe/problemas/movistar/'},
 {name:'Entel Perú',url:'https://downdetector.pe/problemas/entel/'},
 {name:'WIN Perú',url:'https://downdetector.pe/'},
 {name:'Cloudflare Radar',url:'https://radar.cloudflare.com/outage-center'},
 {name:'RIPEstat',url:'https://stat.ripe.net/'},
 {name:'Netrouting Status',url:'https://status.netrouting.com'},
 {name:'Proxmox VE',url:'https://www.proxmox.com/'}
];

const probeTargets=[
 {id:'nr',name:'Netrouting - estado público',url:'https://status.netrouting.com/'},
 {id:'up',name:'UpCloud - estado público',url:'https://status.upcloud.com/'},
 {id:'pve',name:'Proxmox - web pública',url:'https://www.proxmox.com/'}
];
// Comprobaciones exclusivamente de destinos configurados por el administrador mediante variables de entorno.
// No se admite introducir direcciones arbitrarias desde la interfaz pública.
try{
 const extra=JSON.parse(process.env.MONITOR_TARGETS_JSON||'[]');
 if(Array.isArray(extra))for(const t of extra.slice(0,15)){
  if(typeof t.name!=='string'||typeof t.url!=='string')continue;
  const u=new URL(t.url);
  // No permitir endpoints privados/loopback ni hosts con credenciales, evitando SSRF.
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)||host.includes(':'))continue;
  probeTargets.push({id:'custom-'+probeTargets.length,name:cut(t.name).slice(0,60),url:u.href});
 }
}catch(e){console.error('MONITOR_TARGETS_JSON inválido',e.message)}
const probeHistory=new Map();
let probes=[];
let probeUpdated=0;
let probing=null;
async function checkTarget(target){
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),8000);
 const start=performance.now();
 try{
  const response=await fetch(target.url,{method:'GET',signal:ctrl.signal,redirect:'error',headers:{'User-Agent':'NetWatchPeru-Monitor/1.2'}});
  const ms=Math.round(performance.now()-start);
  // Errores 4xx/5xx se anotan como fallos HTTP.
  return {id:target.id,name:target.name,url:target.url,ms,httpCode:response.status,ok:response.status<500&&response.status>=200,at:new Date().toISOString()};
 }catch(err){return {id:target.id,name:target.name,url:target.url,ms:null,httpCode:null,ok:false,error:cut(err.message),at:new Date().toISOString()}}
 finally{clearTimeout(timer)}
}
async function refreshProbes(){
 if(probing)return probing;
 if(Date.now()-probeUpdated<55000)return probes;
 probing=(async()=>{
  const rows=await Promise.all(probeTargets.map(checkTarget));
  probes=rows;
  const cutoff=Date.now()-24*3600000;
  for(const row of rows){
   const past=probeHistory.get(row.id)||[];
   past.push({at:row.at,ms:row.ms,ok:row.ok});
   probeHistory.set(row.id,past.filter(x=>Date.parse(x.at)>=cutoff).slice(-1440));
  }
  probeUpdated=Date.now();
  return rows;
 })().finally(()=>{probing=null});
 return probing;
}
setInterval(()=>refreshProbes().catch(console.error),60000).unref();
setTimeout(()=>refreshProbes().catch(console.error),1500).unref();

let cache=null,updated=0;
let history=[];
let historicalEvents=[];
const cut=x=>String(x??'').slice(0,1000);
async function fetchOne(s){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const r=await fetch(s.api,{signal:controller.signal,headers:{'User-Agent':'NetWatchPeru/1.0'}});
  if(!r.ok)throw Error('HTTP '+r.status);
  const j=await r.json();
  let archived=[];
  try{
   const ar=await fetch(s.url+'/api/v2/incidents.json',{signal:controller.signal,headers:{'User-Agent':'NetWatchPeru/1.1'}});
   if(ar.ok){const aj=await ar.json();archived=(aj.incidents||[]).filter(i=>i.created_at&&Date.now()-Date.parse(i.created_at)<48*3600000).map(i=>({id:s.id+':'+i.id,service:s.name,name:cut(i.name),created_at:i.created_at,status:cut(i.status),url:s.url}));}
  }catch(_){}
  historicalEvents=historicalEvents.filter(e=>e.service!==s.name).concat(archived).slice(-500);
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
 const events=historicalEvents.filter(e=>Date.now()-new Date(e.created_at).getTime()<24*3600000);
 cache={updatedAt:now,services:services.map(({incidents,...rest})=>rest),incidents,history,links,events};
 updated=Date.now();
 return cache;
}
function json(res,obj,code=200){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/probes'){await refreshProbes();return json(res,{updatedAt:new Date(probeUpdated).toISOString(),probes,series:Object.fromEntries([...probeHistory].map(([k,v])=>[k,v]))});}
 if(url.pathname==='/api/health')return json(res,{ok:true});
 if(url.pathname==='/api/status'){try{return json(res,await getStatus())}catch(e){return json(res,{error:e.message},503)}}
 if(url.pathname==='/api/refresh'){try{return json(res,await getStatus(true))}catch(e){return json(res,{error:e.message},503)}}
 if(url.pathname!=='/')return json(res,{error:'Not found'},404);
 fs.readFile(path.join(__dirname,'public','index.html'),(err,data)=>{if(err)return json(res,{error:'Missing frontend'},500);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(data)});
}).listen(PORT,HOST,()=>console.log('NetWatch Perú escuchando en '+HOST+':'+PORT));
