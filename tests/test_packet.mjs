import test from 'node:test';
import assert from 'node:assert/strict';
import {WavePacket,rectanglePacketTransmission,C,HBAR} from '../static/packet-core.js';
function run(p,fraction=1){const w=new WavePacket(p);w.advance(Math.round(w.duration*fraction/w.p.dt));return {w,s:w.statistics()};}
test('free packet moves at group velocity, spreads, and preserves probability',()=>{
 const w=new WavePacket({height:0});w.advance(2500);const s=w.statistics();
 assert.ok(Math.abs(s.norm-1)<1e-9);assert.ok(Math.abs(s.mean-(w.x0+w.velocity*w.time))<.04);
 const exact=Math.sqrt(w.p.sigma**2+(C*w.time/(HBAR*w.p.sigma))**2);
 assert.ok(Math.abs(s.sigma-exact)<.008);assert.ok(s.edge<1e-20);
});
test('finite packet transmission agrees with independent spectrum-averaged rectangle reference',()=>{
 const {w,s}=run({energy:1,height:1.5,width:.3});const expected=rectanglePacketTransmission(w.p);
 assert.ok(Math.abs(s.right-expected)<.003,`${s.right} vs ${expected}`);
 assert.ok(s.near<.005);assert.ok(Math.abs(s.norm-1)<1e-8);assert.ok(s.edge<1e-10);
 console.log('rectangle:',JSON.stringify({transmitted:s.right,reference:expected,norm:s.norm,edge:s.edge}));
});
test('higher barrier suppresses transmission and free flight transmits',()=>{
 const low=run({height:1.5,width:.3}).s,high=run({height:3,width:.3}).s,free=run({height:0}).s;
 assert.ok(high.right<low.right/3);assert.ok(free.right>.999);assert.ok(free.left<.001);
});
test('double-barrier resonant packet transmits more than detuned packet',()=>{
 const common={shape:'double',height:1.5,width:.2,gap:.6,sigma:2.4};
 const resonant=run({...common,energy:.405}).s,off=run({...common,energy:.65}).s;
 assert.ok(resonant.right>off.right*2);assert.ok(resonant.right>.4);
 for(const s of [resonant,off]){assert.ok(Math.abs(s.norm-1)<1e-8);assert.ok(s.edge<1e-8);}
 console.log('double barrier:',JSON.stringify({resonant:resonant.right,off:off.right,remaining:resonant.middle,edge:resonant.edge}));
});
test('spatial refinement converges toward continuum and smaller time step agrees',()=>{
 const p={energy:1,height:1.5,width:.3};
 const coarse=run({...p,dx:.02}).s.right,fine=run({...p,dx:.01}).s.right,halfTime=run({...p,dx:.02,dt:.004}).s.right;
 const exact=rectanglePacketTransmission({...p,sigma:1.4});
 assert.ok(Math.abs(fine-exact)<Math.abs(coarse-exact));assert.ok(Math.abs(coarse-halfTime)<.0001);
 console.log('refinement:',JSON.stringify({coarse,fine,halfTime,exact}));
});
test('distant boundary relocation does not alter measured scattering',()=>{
 const a=run({halfDomain:60}).s,b=run({halfDomain:80}).s;
 assert.ok(Math.abs(a.right-b.right)<1e-8);assert.ok(a.edge<1e-8);
});
test('initial left region is incident probability and extreme supported packet remains inside the box',()=>{
 const w=new WavePacket({energy:.25,sigma:.7,shape:'double',height:5,width:1,gap:2});
 assert.ok(w.statistics().left>.999999);w.advance(Math.round(w.duration/w.p.dt));const s=w.statistics();
 assert.ok(Math.abs(s.norm-1)<1e-8);assert.ok(s.edge<1e-7);
});
