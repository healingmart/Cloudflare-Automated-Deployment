import {execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execute=promisify(execFile);
const origin="https://www.its.go.kr";
const work=await fs.mkdtemp(path.join(os.tmpdir(),"hm-its-public-"));
const out=path.resolve("out");

async function curl(args){
  const bin=process.platform==="win32"?"C:/Windows/System32/curl.exe":"curl";
  const {stdout}=await execute(bin,["-fsSL","--max-time","35","-A","Mozilla/5.0 HealingMart-ITS-Public-Refresh",...args],{maxBuffer:40*1024*1024,timeout:40000});
  return stdout;
}
function bucketId(id){
  let hash=2166136261;
  for(const c of String(id)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return ((hash>>>0)&255).toString(16).padStart(2,"0");
}
function clean(v){return String(v??"").trim()}

try{
  const cookie=path.join(work,"cookies");
  const page=await curl(["-c",cookie,origin+"/"]);
  const meta=(name)=>page.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`))?.[1]||"";
  const token=meta("_csrf"),header=meta("_csrf_header");
  if(!token||!header)throw new Error("ITS_CSRF_MISSING");

  const body=path.join(work,"body.json");
  await fs.writeFile(body,JSON.stringify({body:{data:{type:"CCTV"}}}));
  const raw=await curl(["-b",cookie,"-H","Content-Type: application/json","-H","X-Requested-With: XMLHttpRequest","-H","Referer: "+origin+"/","-H",header+": "+token,"--data-binary","@"+body,origin+"/map/getMarkers"]);
  const payload=JSON.parse(raw);

  const entries={},buckets=new Map();
  for(const feature of payload.features||[]){
    let info;
    try{info=JSON.parse(feature?.properties?.INFO||"")}catch{continue}
    const id=clean(info.cctvId);
    if(!id||entries[id])continue;
    const appUrl=clean(info.appUrl),webUrl=clean(info.webUrl),img=clean(info.imgUrl);
    if(!/^https?:/i.test(appUrl||webUrl))continue;
    const row={
      id,
      title:clean(info.instlLcDc||id),
      provider:clean(info.insttNm||"국가교통정보센터"),
      status:clean(info.sttusTy),
      appUrl,
      webUrl,
      img
    };
    entries[id]=row;
    const key=bucketId(id);
    if(!buckets.has(key))buckets.set(key,{});
    buckets.get(key)[id]=row;
  }

  const count=Object.keys(entries).length;
  if(count<10000||count>15000)throw new Error("ITS_COUNT_INVALID_"+count);
  const at=Date.now();

  await fs.rm(out,{recursive:true,force:true});
  await fs.mkdir(path.join(out,"buckets"),{recursive:true});
  await fs.writeFile(path.join(out,"its-addresses.json"),JSON.stringify({at,entries}));
  for(const [key,value] of buckets)await fs.writeFile(path.join(out,"buckets",key+".json"),JSON.stringify({at,entries:value}));
  await fs.writeFile(path.join(out,"health.json"),JSON.stringify({ok:true,source:"github-actions-official-its",itsAt:new Date(at).toISOString(),its:count,buckets:buckets.size}));
  console.log(JSON.stringify({ok:true,count,buckets:buckets.size,at:new Date(at).toISOString()}));
}finally{
  await fs.rm(work,{recursive:true,force:true});
}
