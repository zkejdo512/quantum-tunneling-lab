import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {Worker as NodeWorker} from 'node:worker_threads';
import {simulate,sweep,surface,solveRequest} from '../static/stationary-core.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
function python(expression,payload) {
  return JSON.parse(execFileSync(process.env.PYTHON || 'python3',['-c',
    'import json,sys\nfrom quantum_tunneling.solver import Parameters,simulate,sweep,surface\ndata=json.load(sys.stdin)\nprint(json.dumps('+expression+'))'],
    {cwd:root,input:JSON.stringify(payload),maxBuffer:30*1024*1024,encoding:'utf8'}));
}
function near(actual,expected,label,tolerance=2e-8) {
  assert.ok(Number.isFinite(actual),label+' is finite');
  assert.ok(Math.abs(actual-expected)<=tolerance*(1+Math.abs(expected)),`${label}: ${actual} vs ${expected}`);
}
function compare(actual,expected,label='result') {
  if(typeof expected==='number') return near(actual,expected,label);
  if(expected===null || typeof expected!=='object') return assert.equal(actual,expected,label);
  if(Array.isArray(expected)) assert.equal(actual.length,expected.length,label+' length');
  for(const [key,value] of Object.entries(expected)) compare(actual[key],value,label+'.'+key);
}

test('browser stationary solver matches Python wave functions, grids and diagnostics across shapes and regimes',()=>{
  const cases=[];
  for(const shape of ['rectangle','triangle','double']) for(const energy of [0.01,1,2,3,10]) cases.push({shape,energy,height:2,width:0.5,dx:0.01});
  cases.push({width:0},{height:0},{width:3,height:20,energy:0.01},{dx:0.0005},
    {shape:'double',width:0.5,gap:0.025,dx:0.01},
    {shape:'double',width:0.5,gap:0.035,dx:0.01},
    {shape:'double',energy:0.405,height:1.5,width:0.2,gap:0.6});
  const references=python('[simulate(Parameters(**p)) for p in data]',cases);
  cases.forEach((p,i)=>compare(simulate(p),references[i],JSON.stringify(p)));
});

test('browser numerical sweeps and surface row/column ordering match Python',()=>{
  for(const shape of ['rectangle','triangle','double']) {
    const p={shape,energy:1.3,dx:0.02};
    compare(sweep(p,'energy',0.05,5,9),python('sweep(Parameters(**data), "energy", 0.05, 5, 9)',p));
    compare(surface(p,5),python('surface(Parameters(**data), 5)',p));
  }
});

test('browser solver retains probability conservation and second-order grid convergence',()=>{
  const errors=[0.02,0.01,0.005].map(dx=>{
    const r=simulate({dx});
    assert.ok(r.conservation_error<1e-8);
    assert.ok(r.current_error<1e-8);
    return r.absolute_error;
  });
  for(let i=1;i<errors.length;i++) assert.ok(errors[i]/errors[i-1]>0.15 && errors[i]/errors[i-1]<0.4);
  assert.ok(simulate({width:1}).transmission<simulate({width:0.5}).transmission);
  near(simulate({height:0}).transmission,1,'free transmission');
});

test('request adapter validates limits and computes every route without a remote API',()=>{
  compare(solveRequest('/api/simulate?energy=1&shape=triangle'),simulate({energy:1,shape:'triangle'}));
  compare(solveRequest('/api/sweep?variable=height&count=5'),sweep({},'height',0,8,5));
  compare(solveRequest('/api/surface?count=5'),surface({},5));
  for(const path of ['/api/simulate?energy=','/api/simulate?height=Infinity','/api/simulate?energy=1&energy=2',
    '/api/simulate?dx=0','/api/simulate?shape=unknown','/api/simulate?width=0.00001',
    '/api/surface?count=100','/api/surface?count=5.5','/api/sweep?variable=bad','/api/sweep?start=2&stop=1',
    '/api/simulate?unexpected=1','/api/missing']) assert.throws(()=>solveRequest(path),path);
});

test('actual stationary worker and page adapter return responses and terminate cancelled computations',async()=>{
  const active=new Set();
  class BrowserWorker {
    constructor(path) {
      assert.equal(path,'/static/stationary-worker.js');
      const moduleURL=new URL('../static/stationary-worker.js',import.meta.url).href;
      this.node=new NodeWorker(`const {parentPort}=require('node:worker_threads');
        globalThis.self={postMessage:data=>parentPort.postMessage(data)};
        import(${JSON.stringify(moduleURL)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
      active.add(this);
      this.node.on('message',data=>this.onmessage?.({data}));
      this.node.on('error',error=>this.onerror?.(error));
    }
    postMessage(data) { this.node.postMessage(data); }
    terminate() { active.delete(this); this.node.terminate(); }
  }
  const context={window:{},document:{documentElement:{dataset:{compute:'browser'}}},
    Worker:BrowserWorker,DOMException,Response,fetch:()=>{throw new Error('Cloud mode attempted HTTP');}};
  vm.runInNewContext(readFileSync(new URL('../static/api-client.js',import.meta.url),'utf8'),context);
  try {
    const response=await context.window.quantumFetch('/api/simulate?energy=1&height=2');
    assert.equal(response.status,200);
    compare(await response.json(),simulate({energy:1,height:2}));
    assert.equal(active.size,0);
    const invalid=await context.window.quantumFetch('/api/surface?count=100');
    assert.equal(invalid.status,400);
    assert.match((await invalid.json()).error,/count/);
    const controller=new AbortController();
    const pending=context.window.quantumFetch('/api/surface?count=61&dx=0.0005',{signal:controller.signal});
    controller.abort();
    await assert.rejects(pending,{name:'AbortError'});
    assert.equal(active.size,0);
    await assert.rejects(context.window.quantumFetch('/api/simulate',{signal:controller.signal}),{name:'AbortError'});
    assert.equal(active.size,0);
    // Local mode still invokes the original Python HTTP API.
    context.document.documentElement.dataset.compute='';
    context.fetch=async path=>new Response(path);
    assert.equal(await (await context.window.quantumFetch('/api/simulate')).text(),'/api/simulate');
  } finally { for(const worker of active) worker.terminate(); }
});
