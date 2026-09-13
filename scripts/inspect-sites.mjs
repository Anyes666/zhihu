import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const sites = [
 {id:'sheepsky',url:'https://sheepsky.com/'},
 {id:'honghuang',url:'https://famous-brigadeiros-22cdbd.netlify.app/'},
 {id:'storydive',url:'https://storydive-10wtw01.org/read/huatangchun'},
 {id:'cards',url:'https://arena-of-cards.app.workbuddy.host/'},
 {id:'icebreaker',url:'https://zhihu-hackathon-icebreaker-production.up.railway.app/'}
];
const config = process.argv[2] ? JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,'')) : {};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const temp=await mkdtemp(path.join(tmpdir(),'echo-competitors-')), debug=await freePort();
const out=path.resolve('artifacts/competitor-review',config.round||'initial');await mkdir(out,{recursive:true});
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debug}`,`--user-data-dir=${path.join(temp,'profile')}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let spawnError;chrome.on('error',e=>spawnError=e);
function connect(url,events=()=>{}){return new Promise((resolve,reject)=>{const ws=new WebSocket(url),pending=new Map();let seq=0;ws.onopen=()=>resolve({call:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));}),close:()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP closed'));}pending.clear();ws.close();}});ws.onerror=reject;ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else events(m);};});}
let browser;
try{
 let info;for(let i=0;i<100;i++){if(spawnError)throw spawnError;try{info=await fetch(`http://127.0.0.1:${debug}/json/version`).then(r=>r.json());break;}catch{}await sleep(100);}if(!info)throw Error('Chrome unavailable');
 browser=await connect(info.webSocketDebuggerUrl);
 for(const site of sites.filter(s=>!config.sites||config.sites[s.id])){
  const report={site:site.id,url:site.url,at:new Date().toISOString(),steps:[],requests:[],errors:[]};let page,ctx;
  try{
   ctx=(await browser.call('Target.createBrowserContext')).browserContextId;
   const target=(await browser.call('Target.createTarget',{url:'about:blank',browserContextId:ctx})).targetId;
   let tab;for(let i=0;i<20;i++){tab=(await fetch(`http://127.0.0.1:${debug}/json`).then(r=>r.json())).find(t=>t.id===target);if(tab)break;await sleep(100);}
   page=await connect(tab.webSocketDebuggerUrl,m=>{if(m.method==='Network.responseReceived'&&['Document','Fetch','XHR'].includes(m.params.type)){const r=m.params.response;try{const u=new URL(r.url);report.requests.push({method:m.params.type,url:u.origin+u.pathname,status:r.status});}catch{}}if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.text);if(m.method==='Network.loadingFailed')report.errors.push(m.params.errorText);});
   const call=page.call,evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
   await call('Page.enable');await call('Page.bringToFront');await call('Runtime.enable');await call('Network.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   const snapshot=async name=>{
    const state=await evaluate(`(()=>{let n=0;const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&s.visibility!=='hidden'&&s.display!=='none'};return {url:location.href,title:document.title,text:document.body.innerText.slice(0,20000),controls:[...document.querySelectorAll('button,a,input,textarea,select,summary,[role=button],[onclick],[tabindex]')].filter(visible).slice(0,90).map(e=>{e.setAttribute('data-inspect',String(++n));return {selector:'[data-inspect="'+n+'"]',tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,180),type:e.type,placeholder:e.placeholder,href:e.tagName==='A'?e.getAttribute('href'):undefined,disabled:e.disabled}}),width:innerWidth,scrollWidth:document.documentElement.scrollWidth}})()`);
    state.text=state.text.replace(/\bu[a-z0-9]{13,}\b/g,'[guest-id-redacted]');
    report.targets=(await browser.call('Target.getTargets')).targetInfos.filter(t=>t.type==='page').map(t=>{try{const u=new URL(t.url);return {title:t.title,url:u.origin+u.pathname}}catch{return {title:t.title}}});
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,`${site.id}-${name}.png`),Buffer.from(shot.data,'base64'));await writeFile(path.join(out,`${site.id}-${name}.json`),JSON.stringify(state,null,2));
    report.steps.push({name,title:state.title,text:state.text.slice(0,2000),controls:state.controls});console.log(JSON.stringify({site:site.id,step:name,title:state.title,text:state.text.slice(0,5200),controls:state.controls}));
   };
   const nav=await call('Page.navigate',{url:site.url});if(nav.errorText)report.navigationError=nav.errorText;await sleep(config.waitMs||10000);await snapshot('home');
   let index=0;
   for(const action of config.sites?.[site.id]?.actions||[]){
    if(action.type==='click'){
     let selector=action.selector;
     if(action.text){selector=await evaluate(`(()=>{const candidates=[...document.querySelectorAll(${JSON.stringify(action.selector||'button,a,summary,[role=button],[onclick],[tabindex]')})];const e=candidates.sort((a,b)=>a.innerText.length-b.innerText.length).find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&e.innerText.trim().includes(${JSON.stringify(action.text)})});if(!e)throw Error('No matching control');e.setAttribute('data-click-target','yes');return '[data-click-target="yes"]'})()`);}

     const box=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('No element');if(e.disabled)throw Error('Disabled element');e.scrollIntoView({block:'center',behavior:'instant'});return true})()`);await sleep(250);
     const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
     await call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});
    }else if(action.type==='fill'){
     await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(action.selector)});if(!e)throw Error('No field');e.focus();})()`);await call('Input.insertText',{text:action.text});
    }else if(action.type==='mobile')await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    else if(action.type==='scroll')await evaluate(`window.scrollTo({top:${Number(action.y)||0},behavior:'instant'})`);
    else if(action.type==='navigate')await call('Page.navigate',{url:action.url});
    else if(action.type!=='wait')throw Error('Unsupported action');
    await evaluate(`document.querySelectorAll('[data-click-target]').forEach(e=>e.removeAttribute('data-click-target'))`);
    await sleep(action.waitMs??2500);await snapshot(action.name||String(++index));
   }
  }catch(e){report.failure=e.message;console.error(site.id+': '+e.message);}
  finally{await writeFile(path.join(out,site.id+'-report.json'),JSON.stringify(report,null,2));page?.close();if(ctx)await browser.call('Target.disposeBrowserContext',{browserContextId:ctx});}
 }
}finally{browser?.close();chrome.kill();await sleep(800);if(path.dirname(path.resolve(temp))===path.resolve(tmpdir())&&path.basename(temp).startsWith('echo-competitors-'))try{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:300});}catch(e){console.error('Temporary profile cleanup:',e.code,temp);}}


