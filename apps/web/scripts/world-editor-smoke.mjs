/** Browser smoke test. Requires Next on :3100 and a disposable Chromium CDP profile on :9333. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const endpoint = 'http://127.0.0.1:9333';
const tabs = await (await fetch(`${endpoint}/json`)).json();
const tab = tabs.find(t => t.type === 'page' && t.url.includes('/studio/world')) ?? tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension:'));
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
  await until(`document.querySelectorAll("ol li").length === 5 && !!document.querySelector('[data-site-count="1223"]')`);
  const title=await evaluate('document.querySelector("h1").innerText');
  // Sculpt, restore the environment checkpoint, then reload the page from browser storage.
  await evaluate('document.querySelector("[data-testid=sculpt-toggle]").click()');
  await evaluate('(()=>{const canvas=document.querySelectorAll("canvas")[1],r=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:r.left+r.width*.62,clientY:r.top+r.height*.46}));})()');
  await until('document.querySelectorAll("ol li").length === 6');
  await evaluate('document.querySelectorAll("ol li")[4].querySelector("button").click()');
  await until('document.querySelectorAll("ol li").length === 5');
  await command('Page.reload');
  await until(`document.querySelectorAll("ol li").length === 5 && !!document.querySelector('[data-site-count="1223"]')`);
  const loaded=JSON.parse(await evaluate('localStorage.getItem("zion-island-editor-v1")'));
  const saved=JSON.parse(await readFile(`${root}docs/world-editor/island-revision.json`,'utf8'));
  if(JSON.stringify(loaded)!==JSON.stringify(saved))throw new Error('Browser save/reload differs from input revision');
  // Verify the new viewport and visibility controls change the real map canvas.
  const initialMap=await evaluate('document.querySelectorAll("canvas")[1].toDataURL()');
  await evaluate(`document.querySelector('[aria-label="Phóng to bản đồ"]').click()`);
  await until('document.querySelector("[data-testid=zoom]").textContent === "200%"');
  if(await evaluate('document.querySelectorAll("canvas")[1].toDataURL()')===initialMap)throw new Error('Zoom did not redraw map');
  await evaluate(`document.querySelector('[title="Xem toàn đảo"]').click()`);
  await until('document.querySelector("[data-testid=zoom]").textContent === "100%"');
  await evaluate('document.querySelector("[data-testid=layer-buildings]").click()');
  await evaluate(`(()=>{const select=document.querySelector('[aria-label="Đi đến địa danh"]');select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until('document.querySelector("[data-testid=zoom]").textContent === "400%"');
  const focusedMap=await evaluate('document.querySelectorAll("canvas")[1].toDataURL()');
  const bounds=await evaluate(`(()=>{const r=document.querySelectorAll('canvas')[1].getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x+bounds.width*.5,y:bounds.y+bounds.height*.5,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:bounds.x+bounds.width*.7,y:bounds.y+bounds.height*.7,button:'left',buttons:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x+bounds.width*.7,y:bounds.y+bounds.height*.7,button:'left',clickCount:1});
  if(await evaluate('document.querySelectorAll("canvas")[1].toDataURL()')===focusedMap)throw new Error('Pan did not redraw map');
  await evaluate(`document.querySelector('[title="Xem toàn đảo"]').click()`);
  await until('!document.querySelector("[data-testid=layer-buildings]").checked');
  if(await evaluate('document.querySelectorAll("canvas")[1].toDataURL()')===initialMap)throw new Error('Layer toggle did not redraw map');
  await evaluate('document.querySelector("[data-testid=layer-buildings]").click()');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Bản chỉnh sửa").click()');
  await until('document.querySelectorAll("canvas").length === 1');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="So sánh").click()');
  await until('document.querySelectorAll("canvas").length === 2');
  const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(`${root}docs/world-editor/evidence/editor-browser.png`,Buffer.from(shot.data,'base64'));
  await command('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});
  if(await evaluate('document.documentElement.scrollWidth > window.innerWidth'))throw new Error('Tablet horizontal overflow');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  if(await evaluate('document.documentElement.scrollWidth > window.innerWidth'))throw new Error('Mobile horizontal overflow');
  const mobile=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(`${root}docs/world-editor/evidence/world-studio-mobile.png`,Buffer.from(mobile.data,'base64'));
  const report={browser:'Microsoft Edge headless via CDP',title,fileImport:true,sculpt:true,checkpointRollback:true,browserStorageRoundTrip:true,zoom:true,pan:true,poiNavigation:true,layerVisibility:true,viewModes:true,tabletOverflow:false,mobileOverflow:false,canvasCount:2,originalSites:1221,totalSites:1223,unhandledExceptions:exceptions};
  await writeFile(`${root}docs/world-editor/evidence/browser-validation.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(exceptions.length)throw new Error('Unhandled browser exceptions');
} finally {ws.close();}
