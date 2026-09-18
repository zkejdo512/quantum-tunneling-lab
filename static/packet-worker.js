import {WavePacket,rectanglePacketTransmission,rectangleTransmission,C} from './packet-core.js';
self.onmessage=({data})=>{
  try{
    const sim=new WavePacket(data),stride=Math.round(.08/sim.dx),frames=[];
    const saveEvery=Math.max(1,Math.round(sim.duration/sim.p.dt/480));
    frames.push(sim.snapshot(stride));
    for(let frame=1;frame<=480;frame++){
      sim.advance(saveEvery);frames.push(sim.snapshot(stride));
      if(frame%24===0)self.postMessage({type:'progress',progress:frame/480});
      if(sim.maxEdge>1e-7)break;
    }
    const x=Float32Array.from(sim.x.filter((_,j)=>j%stride===0));
    const result={type:'result',frames,x,params:sim.p,width:sim.width,gap:sim.gap,span:sim.span,x0:sim.x0,velocity:sim.velocity,
      dx:sim.dx,dt:sim.p.dt,singleT:data.shape==='rectangle'?rectangleTransmission(data.energy,data.height,sim.width):null,
      packetT:data.shape==='rectangle'?rectanglePacketTransmission({...sim.p,width:sim.width}):null,
      meanEnergy:data.energy+C/(4*data.sigma**2),energySD:Math.sqrt(C*data.energy/data.sigma**2+C*C/(8*data.sigma**4))};
    self.postMessage(result,[x.buffer,...frames.flatMap(f=>[f.re.buffer,f.im.buffer])]);
  }catch(e){self.postMessage({type:'error',message:e.message});}
};
