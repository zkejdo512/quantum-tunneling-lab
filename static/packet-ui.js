const $=id=>document.getElementById(id);
const canvas=$('packetCanvas'),ctx=canvas.getContext('2d');
const state={worker:null,result:null,index:0,playing:false,last:0,raf:0,view:true,computing:false};
const names={energy:'Energy',height:'Height',width:'Width',gap:'Gap',sigma:'Sigma',dx:'Dx'};
const presets={tunnel:{energy:1,height:1.5,width:.3,gap:.6,sigma:1.4,shape:'rectangle'},free:{energy:1,height:0,width:.3,gap:.6,sigma:1.4,shape:'rectangle'},resonant:{energy:.405,height:1.5,width:.2,gap:.6,sigma:2.4,shape:'double'},off:{energy:.65,height:1.5,width:.2,gap:.6,sigma:2.4,shape:'double'}};
const percent=n=>(100*n).toFixed(2)+'%';
const scientific=n=>{if(n===0)return '0';const [m,e]=n.toExponential(2).split('e');const power=String(Number(e)).replace(/[-0-9]/g,c=>'⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);return `${m} × 10${power}`;};
function readParams(){return {...Object.fromEntries(Object.entries(names).map(([k,v])=>[k,Number($('packet'+v).value)])),shape:$('packetShape').value};}
function play(value){state.playing=value;state.last=0;$('packetPlay').textContent=value?'Pause':'Play';if(value){cancelAnimationFrame(state.raf);state.raf=requestAnimationFrame(animate);}}
function showPacket(){state.view=true;$('packetPanel').hidden=false;$('steadyWorkspace').hidden=true;document.body.classList.add('packet-mode');$('packetTab').setAttribute('aria-selected','true');for(const id of ['surfaceTab','waveTab'])$(id).setAttribute('aria-selected','false');requestAnimationFrame(draw);}
$('packetTab').addEventListener('click',showPacket);
document.addEventListener('quantum:view',()=>{state.view=false;play(false);$('packetPanel').hidden=true;$('steadyWorkspace').hidden=false;$('packetTab').setAttribute('aria-selected','false');document.body.classList.remove('packet-mode');});
function enableReplay(value){for(const id of ['packetPlay','packetRewind','packetTimeline','packetEnd'])$(id).disabled=!value;}
function launch(event){
  event?.preventDefault();if(!$('packetForm').reportValidity())return;
  state.worker?.terminate();play(false);state.result=null;state.index=0;state.computing=true;enableReplay(false);
  $('packetStatus').textContent='Computing the time-dependent wavefunction… 0%';
  $('packetLaunch').textContent='Restart calculation';$('packetParameterNote').textContent='The controls describe this new run.';
  for(const id of ['packetLeft','packetMiddle','packetRight','packetNorm'])$(id).textContent='—';
  $('packetRunLabel').textContent='Solving the initial-value problem';$('packetTime').textContent='0.00 fs';
  $('packetTimeline').value=0;$('packetDuration').textContent='0 / 0 fs';
  $('packetSpectrum').textContent='A finite wave packet contains a distribution of energies.';
  $('packetDiagnostics').textContent='Checking the probability norm and the distant boundaries.';
  try{
    const worker=new Worker('/static/packet-worker.js',{type:'module'});state.worker=worker;
    worker.onmessage=({data})=>{
      if(worker!==state.worker)return;
      if(data.type==='progress'){$('packetStatus').textContent=`Computing the time-dependent wavefunction… ${Math.round(100*data.progress)}%`;return;}
      if(data.type==='error'){fail(data.message);return;}
      state.result=data;state.computing=false;state.index=0;worker.terminate();state.worker=null;
      $('packetLaunch').textContent='Relaunch wave packet';$('packetTimeline').max=data.frames.length-1;enableReplay(true);
      const p=data.params;
      let peak=0;for(const f of data.frames)for(let j=0;j<f.re.length;j++)peak=Math.max(peak,f.re[j]**2+f.im[j]**2);
      data.densityMax=Math.max(peak*1.12,1/(Math.sqrt(2*Math.PI)*p.sigma)*1.8);
      $('packetRunLabel').textContent=`${p.shape==='double'?'Double':'Single'} barrier · E₀ ${p.energy.toFixed(3)} eV · V₀ ${p.height.toFixed(2)} eV · a ${data.width.toFixed(2)} nm${p.shape==='double'?` · gap ${data.gap.toFixed(2)} nm`:''}`;
      const spread=`⟨E⟩ = ${data.meanEnergy.toFixed(3)} eV · σE = ${data.energySD.toFixed(3)} eV.`;
      $('packetSpectrum').textContent=data.packetT===null?`${spread} Double-barrier resonances select part of this energy distribution; delayed probability can remain in the well. Compare the resonance and off-resonance runs after the collision.`:`${spread} Rectangle reference: single-energy T(E₀) = ${percent(data.singleT)}; spectrum-weighted packet transmission ≈ ${percent(data.packetT)}. These are separate predictions.`;
      const error=Math.max(...data.frames.map(f=>Math.abs(f.norm-1))),edge=Math.max(...data.frames.map(f=>f.edge));
      $('packetDiagnostics').textContent=`Δx = ${data.dx.toFixed(3)} nm · Δt = ${data.dt.toFixed(3)} fs. Max |norm − 1| = ${scientific(error)}. Max outer-edge probability = ${scientific(edge)}. Box: −80…80 nm; replay ends at ${data.frames.at(-1).time.toFixed(1)} fs.`;
      update();if(state.view&&!document.hidden)play(true);
    };
    worker.onerror=()=>fail('The background calculation could not start. Relaunch after refreshing the page.');
    worker.postMessage(readParams());
  }catch(e){fail(e.message);}
  draw();
}
function fail(message){state.computing=false;state.worker?.terminate();state.worker=null;$('packetStatus').textContent='Calculation failed: '+message;$('packetLaunch').textContent='Try again';}
function update(){
  const d=state.result;if(!d)return;
  const i=Math.min(d.frames.length-1,Math.round(state.index)),f=d.frames[i];
  $('packetLeft').textContent=percent(f.left);$('packetMiddle').textContent=percent(f.middle);$('packetRight').textContent=percent(f.right);$('packetNorm').textContent=f.norm.toFixed(8);
  $('packetTime').textContent=f.time.toFixed(2)+' fs';$('packetTimeline').value=i;
  $('packetDuration').textContent=`${f.time.toFixed(1)} / ${d.frames.at(-1).time.toFixed(1)} fs`;
  const arrived=f.time>Math.abs(d.x0)/d.velocity;
  const separated=arrived&&f.near<.005;
  $('packetStatus').textContent=f.maxEdge>1e-7?'Boundary threshold reached · replay stopped before further propagation.':i===d.frames.length-1?'End of recorded experiment · drag the timeline to replay.':separated?'Outgoing packets have largely separated.':arrived?'Scattering and separation · probability may linger in the structure.':'Incoming packet · approaching the barrier.';
  $('packetInterpretation').textContent=separated?`Approximate outgoing fractions now: reflected ${percent(f.left)}, transmitted ${percent(f.right)}. ${percent(f.middle)} remains inside the structure; these are finite-time spatial integrals.`:'Left-region probability includes the incoming wave and its interference with the reflected wave. Read it as reflection only after the outgoing packets have separated.';
  draw();
}
function animate(time){
  if(!state.playing||!state.result)return;
  if(state.last)state.index+=Math.min(time-state.last,80)*Number($('packetSpeed').value)*(state.result.frames.length-1)/16000;
  state.last=time;
  if(state.index>=state.result.frames.length-1){state.index=state.result.frames.length-1;play(false);}
  update();if(state.playing)state.raf=requestAnimationFrame(animate);
}
function draw(){
  if(!state.view)return;
  const rect=canvas.getBoundingClientRect();if(rect.width<1)return;
  const ratio=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;
  if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#0c0c0c';ctx.fillRect(0,0,w,h);
  ctx.font='10px ui-monospace, monospace';ctx.fillStyle='#999';
  const d=state.result;if(!d){ctx.textAlign='center';ctx.fillText(state.computing?'Computing real TDSE evolution…':'Launch a wave packet to begin',w/2,h/2);return;}
  const f=d.frames[Math.round(state.index)],left=48,right=w-49,top=30,bottom=h-35,split=top+(bottom-top)*.66;
  const xmin=d.x0-22,xmax=-d.x0+d.span+22,xp=x=>left+(x-xmin)/(xmax-xmin)*(right-left);
  const yp=q=>split-12-q/d.densityMax*(split-top-20),zero=split+(bottom-split)/2;
  ctx.strokeStyle='#252525';ctx.lineWidth=1;
  for(let j=0;j<=3;j++){const q=d.densityMax*j/3,y=yp(q);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#6f6f6f';ctx.fillText(q.toFixed(2),left-7,y+3);}
  ctx.textAlign='left';ctx.fillStyle='#aaa';ctx.fillText('|ψ|² / nm⁻¹',left,top-14);ctx.fillText('Re ψ / nm⁻½',left,split+10);ctx.textAlign='right';ctx.fillText('V / eV',right,top-14);
  const vmax=Math.max(d.params.height*1.2,1),potentialY=yp(0)-(d.params.height/vmax)*(split-top-20);
  const barrier=(a,b)=>{ctx.fillStyle='#716d652c';ctx.fillRect(xp(a),potentialY,Math.max(1,xp(b)-xp(a)),yp(0)-potentialY);ctx.strokeStyle='#807b72';ctx.strokeRect(xp(a),potentialY,Math.max(1,xp(b)-xp(a)),yp(0)-potentialY);};
  if(d.width>0&&d.params.height>0){barrier(0,d.width);if(d.params.shape==='double')barrier(d.width+d.gap,d.span);}
  ctx.textAlign='left';ctx.fillStyle='#8c8780';ctx.fillText(vmax.toFixed(1),right+8,top+13);ctx.fillText('0',right+8,yp(0)+3);
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  ctx.beginPath();let started=false;
  for(let j=0;j<d.x.length;j++){if(d.x[j]<xmin||d.x[j]>xmax)continue;const x=xp(d.x[j]),y=yp(f.re[j]**2+f.im[j]**2);if(!started){ctx.moveTo(x,yp(0));started=true;}ctx.lineTo(x,y);}
  ctx.lineTo(right,yp(0));ctx.closePath();ctx.fillStyle='#adc4b51c';ctx.fill();
  for(const type of ['density','real']){
    ctx.beginPath();started=false;
    for(let j=0;j<d.x.length;j++){if(d.x[j]<xmin||d.x[j]>xmax)continue;const x=xp(d.x[j]),y=type==='density'?yp(f.re[j]**2+f.im[j]**2):zero-f.re[j]/Math.sqrt(d.densityMax)*(bottom-split)*.39;if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}
    ctx.lineWidth=type==='density'?1.6:1;ctx.strokeStyle=type==='density'?'#cbd8cf':'#8aa292';ctx.stroke();
  }
  ctx.restore();ctx.strokeStyle='#363636';ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(right,zero);ctx.stroke();
  ctx.fillStyle='#666';ctx.textAlign='right';ctx.fillText('0',left-7,zero+3);
  const amplitude=Math.sqrt(d.densityMax);ctx.fillText(amplitude.toFixed(1),left-7,zero-(bottom-split)*.39+3);
  const tick= w<450?20:10;
  for(let x=Math.ceil(xmin/tick)*tick;x<=xmax;x+=tick){ctx.textAlign='center';ctx.fillStyle='#818181';ctx.fillText(String(x),xp(x),bottom+16);}
  ctx.textAlign='right';ctx.fillText('x / nm',right,h-3);
  ctx.setLineDash([3,4]);ctx.strokeStyle='#4f554f';ctx.beginPath();ctx.moveTo(xp(0),top);ctx.lineTo(xp(0),bottom);ctx.stroke();ctx.setLineDash([]);
}
$('packetForm').addEventListener('submit',launch);
$('packetForm').addEventListener('input',()=>{$('packetGap').disabled=$('packetShape').value!=='double';$('packetParameterNote').textContent='Parameters changed. Relaunch to apply them; the recorded run stays unchanged.';});
for(const button of document.querySelectorAll('[data-packet-preset]'))button.addEventListener('click',()=>{
  const p=presets[button.dataset.packetPreset];for(const [key,value] of Object.entries(p))$('packet'+(key==='shape'?'Shape':names[key])).value=value;
  $('packetGap').disabled=p.shape!=='double';launch();
});
$('packetPlay').addEventListener('click',()=>{if(state.result&&state.index>=state.result.frames.length-1)state.index=0;play(!state.playing);});
$('packetRewind').addEventListener('click',()=>{play(false);state.index=0;update();});
$('packetEnd').addEventListener('click',()=>{play(false);state.index=state.result.frames.length-1;update();});
$('packetTimeline').addEventListener('input',()=>{play(false);state.index=Number($('packetTimeline').value);update();});
new ResizeObserver(draw).observe(canvas.parentElement);
document.addEventListener('visibilitychange',()=>{if(document.hidden)play(false);});
showPacket();launch();
