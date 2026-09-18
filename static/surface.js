/* A perspective-projected 3D mesh of numerical 1D scattering solutions. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('surfaceCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const state = {data:null, solution:null, yaw:-0.62, pitch:0.62, zoom:1,
    request:0, controller:null, timer:0, frame:0, drag:null, hover:null, vertices:[],
    dataKey:null, pendingKey:null, width:0, height:0};
  const params = () => ({energy:Number($('energyNumber').value),
    shape:document.querySelector('input[name="shape"]:checked').value,
    gap:Number($('gapNumber').value),dx:Number($('dxSelect').value)});
  const key = p => JSON.stringify([p.energy,p.shape,p.shape==='double'?p.gap:0,p.dx]);
  const superscript = n => String(n).replace(/[-+0-9]/g,c=>'⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹'['-+0123456789'.indexOf(c)]);
  const number = n => {
    if(n===0) return '0';
    if(Math.abs(n)<0.001){
      const [mantissa,exponent]=n.toExponential(2).split('e');
      return `${mantissa} × 10${superscript(Number(exponent))}`;
    }
    return n.toFixed(3).replace(/\.?0+$/,'');
  };
  const shapeName = {rectangle:'Rectangle',triangle:'Triangle',double:'Double barrier'};
  const redraw = () => {cancelAnimationFrame(state.frame);state.frame=requestAnimationFrame(draw);};

  async function calculate() {
    clearTimeout(state.timer);
    const p=params();
    const id=++state.request;
    state.controller?.abort();
    const controller=new AbortController();state.controller=controller;state.pendingKey=key(p);
    $('surfaceLoading').hidden=false;
    $('surfaceStatus').textContent=state.data?'Computing · showing previous result':'Computing';
    $('surfaceRefresh').disabled=true;
    try {
      const response=await fetch('/api/surface?'+new URLSearchParams({...p,count:41}),{signal:controller.signal});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Surface calculation failed');
      if(id!==state.request) return;
      if(!Array.isArray(data.widths)||!Array.isArray(data.heights)||
        !Array.isArray(data.transmission)||data.transmission.length!==data.heights.length||
        data.transmission.some(row=>!Array.isArray(row)||row.length!==data.widths.length||row.some(t=>!Number.isFinite(t)||t<0)))
        throw new Error('Incomplete surface data');
      state.data=data;state.dataKey=key(data.params);state.hover=null;
      $('surfaceStatus').textContent='Ready';
      const min=Math.min(...data.transmission.flat().filter(t=>t>0));
      state.logFloor=Math.max(-300,Math.min(-2,Math.floor(Math.log10(min))));
      canvas.setAttribute('aria-label',`${shapeName[data.params.shape]} barrier parameter surface, energy ${data.params.energy} eV, ${data.count} × ${data.count} numerical samples. Width 0–2 nm, height 0–8 eV, vertical axis transmission. Arrow keys rotate; plus and minus zoom.`);
      redraw();
    } catch(error) {
      if(error.name==='AbortError'||id!==state.request) return;
      $('surfaceStatus').textContent=(state.data?'Calculation failed · showing previous result: ':'')+error.message;
    } finally {
      if(id===state.request){state.pendingKey=null;$('surfaceLoading').hidden=true;$('surfaceRefresh').disabled=false;}
    }
  }

  function changed() {
    const k=key(params());
    if(k===state.pendingKey) return;
    if(k===state.dataKey) {
      clearTimeout(state.timer);
      if(state.pendingKey && state.pendingKey!==k){state.controller?.abort();++state.request;state.pendingKey=null;}
      $('surfaceLoading').hidden=true;$('surfaceRefresh').disabled=false;
      $('surfaceStatus').textContent='Ready';redraw();return;
    }
    ++state.request;state.controller?.abort();state.pendingKey=null;
    $('surfaceLoading').hidden=true;$('surfaceRefresh').disabled=false;
    $('surfaceStatus').textContent=state.data?'Parameters changed · awaiting calculation':'Waiting for calculation';
    clearTimeout(state.timer);state.timer=setTimeout(calculate,650);redraw();
  }

  function project(x,y,z) {
    const c=Math.cos(state.yaw),s=Math.sin(state.yaw);
    const u=x*c-y*s, depth=x*s+y*c;
    const v=z*Math.cos(state.pitch)-depth*Math.sin(state.pitch);
    const d=depth*Math.cos(state.pitch)+z*Math.sin(state.pitch);
    const perspective=4.8/(4.8-d);
    const scale=Math.min(state.width*0.275,state.height*0.32)*state.zoom;
    return {x:state.width/2+u*scale*perspective,y:state.height*0.49-v*scale*perspective,d};
  }
  function zFor(t) {
    const value=$('surfaceLog').checked?
      (Math.log10(Math.max(1e-300,t))-state.logFloor)/(-state.logFloor):t;
    return -0.78+Math.max(0,Math.min(1,value))*1.56;
  }
  function line(a,b,color='#343434',width=1,dash=[]) {
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
  }
  function label(text,p,align='center',color='#929292') {
    ctx.font='11px ui-monospace, SFMono-Regular, Consolas, monospace';
    const width=ctx.measureText(text).width;
    const left=align==='right'?width:align==='center'?width/2:0;
    const right=align==='left'?width:align==='center'?width/2:0;
    const x=Math.max(8+left,Math.min(state.width-8-right,p.x));
    ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(text,x,p.y);
  }
  function draw() {
    if($('surfacePanel').hidden) return;
    const rect=canvas.getBoundingClientRect();
    if(rect.width<1||rect.height<1) return;
    state.width=rect.width;state.height=rect.height;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#0c0c0c';ctx.fillRect(0,0,rect.width,rect.height);
    const data=state.data;
    if(!data){label('Waiting for numerical calculation',{x:rect.width/2,y:rect.height/2});return;}
    // Ground grid, projected from the same world coordinates as the surface.
    for(let i=0;i<=4;i++){
      const v=-1+i/2;
      line(project(v,-1,-0.78),project(v,1,-0.78),'#242424');
      line(project(-1,v,-0.78),project(1,v,-0.78),'#242424');
    }
    const points=data.heights.map((height,j)=>data.widths.map((width,i)=>{
      const T=data.transmission[j][i];
      return {...project(width-1,height/4-1,zFor(T)),T,width,height};
    }));
    const faces=[];
    for(let j=0;j<points.length-1;j++)for(let i=0;i<points[j].length-1;i++){
      const a=points[j][i],b=points[j][i+1],c=points[j+1][i+1],d=points[j+1][i];
      faces.push([a,b,c],[a,c,d]);
    }
    faces.sort((a,b)=>a.reduce((s,p)=>s+p.d,0)-b.reduce((s,p)=>s+p.d,0));
    for(const face of faces){
      const avg=face.reduce((s,p)=>s+zFor(p.T),0)/3;
      const t=(avg+0.78)/1.56;
      ctx.beginPath();ctx.moveTo(face[0].x,face[0].y);face.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();
      ctx.fillStyle=`rgb(${Math.round(26+29*t)},${Math.round(31+40*t)},${Math.round(33+38*t)})`;ctx.fill();
      ctx.strokeStyle=`rgba(159,179,171,${0.19+0.2*t})`;ctx.lineWidth=0.55;ctx.stroke();
    }
    state.vertices=points.flat();
    // Axes and numeric ticks stay legible at every view angle.
    const origin=project(-1,-1,-0.78);
    line(origin,project(1.12,-1,-0.78),'#777');
    line(origin,project(-1,1.12,-0.78),'#777');
    line(origin,project(-1,-1,0.9),'#aaa');
    for(let i=0;i<=4;i++){
      label(number(i/2),project(-1+i/2,-1.12,-0.78));
      label(String(i*2),project(-1.12,-1+i/2,-0.78),'right');
    }
    const logarithmic=$('surfaceLog').checked;
    const step=Math.ceil(-state.logFloor/4);
    const ticks=logarithmic?Array.from({length:Math.floor(-state.logFloor/step)+1},(_,i)=>-i*step):[0,0.25,0.5,0.75,1];
    for(const tick of ticks){
      const fraction=logarithmic?(tick-state.logFloor)/(-state.logFloor):tick;
      const p=project(-1,-1,-0.78+fraction*1.56);
      const text=logarithmic?(tick===0?'1':`10${superscript(tick)}`):number(tick);
      label(text,{x:p.x-20,y:p.y+4},'right');
    }
    label('a / nm',project(0,-1.37,-0.78));
    label('V₀ / eV',project(-1.38,0,-0.78));
    label($('surfaceLog').checked?'T · log₁₀':'T',project(-1,-1,1.04),'center','#ddd');
    const solution=state.solution;
    if(solution && key(solution.params)===state.dataKey){
      const p=solution.params;
      const top=project(p.width-1,p.height/4-1,zFor(solution.transmission));
      const foot=project(p.width-1,p.height/4-1,-0.78);
      line(foot,top,'#b4ccb6',1,[3,4]);
      ctx.fillStyle='#c4e1c8';ctx.fillRect(top.x-3.5,top.y-3.5,7,7);
      label('Current point',{x:top.x+10,y:top.y-9},'left','#c4e1c8');
    }
    const note=`${shapeName[data.params.shape]} · E = ${number(data.params.energy)} eV · ${data.count} × ${data.count} points`;
    label(note,{x:18,y:24},'left','#929292');
    label('a: 0–2 nm   V₀: 0–8 eV',{x:18,y:state.height-16},'left','#707070');
    $('surfaceMeta').textContent=state.hover?
      `Sample  a = ${number(state.hover.width)} nm  /  V₀ = ${number(state.hover.height)} eV  /  T = ${number(state.hover.T)}`:
      `Finite differences · ${data.count**2} solutions · refine sampling near narrow resonances`;
    if(state.hover){ctx.strokeStyle='#ddd';ctx.strokeRect(state.hover.x-4,state.hover.y-4,8,8);}
  }

  function showView(surface) {
    document.dispatchEvent(new CustomEvent("quantum:view",{detail:"steady"}));
    $('surfacePanel').hidden=!surface;$('wavePanel').hidden=surface;
    $('surfaceTab').setAttribute('aria-selected',String(surface));$('waveTab').setAttribute('aria-selected',String(!surface));
    window.dispatchEvent(new Event('resize'));redraw();
  }
  $('surfaceTab').addEventListener('click',()=>showView(true));
  $('waveTab').addEventListener('click',()=>showView(false));
  $('surfaceLog').addEventListener('change',redraw);
  $('surfaceResetView').addEventListener('click',()=>{state.yaw=-0.62;state.pitch=0.62;state.zoom=1;redraw();});
  $('surfaceRefresh').addEventListener('click',calculate);
  $('surfaceDownload').addEventListener('click',()=>{
    if(!state.data) return;draw();canvas.toBlob(blob=>{
      if(!blob) return;const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='quantum-transmission-surface.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  });
  canvas.addEventListener('pointerdown',e=>{
    state.drag={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);state.hover=null;
  });
  canvas.addEventListener('pointermove',e=>{
    if(state.drag){
      state.yaw-=(e.clientX-state.drag.x)*0.008;
      state.pitch=Math.max(0.12,Math.min(1.3,state.pitch+(e.clientY-state.drag.y)*0.006));
      state.drag.x=e.clientX;state.drag.y=e.clientY;
    }else{
      const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      let distance=15**2;state.hover=null;
      for(const p of state.vertices){const d=(p.x-x)**2+(p.y-y)**2;if(d<distance){distance=d;state.hover=p;}}
    }redraw();
  });
  const stopDrag=()=>{state.drag=null;};
  canvas.addEventListener('pointerup',stopDrag);canvas.addEventListener('pointercancel',stopDrag);
  canvas.addEventListener('lostpointercapture',stopDrag);
  canvas.addEventListener('pointerleave',()=>{state.hover=null;redraw();});
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=Math.max(0.65,Math.min(1.6,state.zoom*Math.exp(-e.deltaY*0.001)));redraw();},{passive:false});
  canvas.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();
    if(e.key==='ArrowLeft')state.yaw+=0.12;if(e.key==='ArrowRight')state.yaw-=0.12;
    if(e.key==='ArrowUp')state.pitch=Math.min(1.3,state.pitch+0.08);
    if(e.key==='ArrowDown')state.pitch=Math.max(0.12,state.pitch-0.08);
    if(e.key==='+'||e.key==='=')state.zoom=Math.min(1.6,state.zoom+0.1);if(e.key==='-')state.zoom=Math.max(0.65,state.zoom-0.1);
    redraw();
  });
  document.addEventListener('quantum:solution',e=>{state.solution=e.detail;changed();});
  // Capture invalidation immediately; debounce only the expensive calculation.
  $('parameterForm').addEventListener('input',changed);
  $('parameterForm').addEventListener('change',changed);
  new ResizeObserver(redraw).observe($('surfaceCanvasWrap'));
  calculate();
})();
