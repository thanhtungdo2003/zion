/** Browser smoke test. Requires Next on :3100 and a disposable Chromium CDP profile on :9333. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const endpoint = 'http://127.0.0.1:9333';
const tabs = await (await fetch(`${endpoint}/json`)).json();
const tab = tabs.find(t => t.type === 'page');
if (!tab) throw new Error('No Chromium page target');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;
const pending=new Map(),exceptions=[];
ws.onmessage=e=>{const message=JSON.parse(e.data);if(message.id){const callback=pending.get(message.id);pending.delete(message.id);if(message.error)callback.reject(new Error(JSON.stringify(message.error)));else callback.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);};
function command(method,params={}) {return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});}
async function evaluate(expression) {const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression) {for(let i=0;i<90;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error(`Timed out: ${expression}`);}
try {
  await command('Runtime.enable');await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url:'http://localhost:3100/studio/world'});
  await until('document.querySelectorAll("canvas").length === 2');
  // Open the actual persisted revision using the editor's file input, not a mocked map response.
  const dom=await command('DOM.getDocument');
  const input=await command('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'});
  await command('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[`${root}docs/world-editor/island-revision.json`]});
  await until('document.querySelectorAll("ol li").length === 5 && document.body.innerText.includes("1223 site")');
  const title=await evaluate('document.querySelector("h1").innerText');
  // Sculpt, restore the environment checkpoint, then reload the page from browser storage.
  await evaluate('document.querySelector("input[type=checkbox]").click()');
  await evaluate('(()=>{const canvas=document.querySelectorAll("canvas")[1],r=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:r.left+r.width*.62,clientY:r.top+r.height*.46}));})()');
  await until('document.querySelectorAll("ol li").length === 6');
  await evaluate('document.querySelectorAll("ol li")[4].querySelector("button").click()');
  await until('document.querySelectorAll("ol li").length === 5');
  await command('Page.reload');
  await until('document.querySelectorAll("ol li").length === 5 && document.body.innerText.includes("1223 site")');
  const loaded=JSON.parse(await evaluate('localStorage.getItem("zion-island-editor-v1")'));
  const saved=JSON.parse(await readFile(`${root}docs/world-editor/island-revision.json`,'utf8'));
  if(JSON.stringify(loaded)!==JSON.stringify(saved))throw new Error('Browser save/reload differs from input revision');
  const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(`${root}docs/world-editor/evidence/editor-browser.png`,Buffer.from(shot.data,'base64'));
  const report={browser:'Microsoft Edge headless via CDP',title,fileImport:true,sculpt:true,checkpointRollback:true,browserStorageRoundTrip:true,canvasCount:2,originalSites:1221,totalSites:1223,unhandledExceptions:exceptions};
  await writeFile(`${root}docs/world-editor/evidence/browser-validation.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(exceptions.length)throw new Error('Unhandled browser exceptions');
} finally {ws.close();}
