// Browser port of quantum_tunneling/solver.py. Same finite-difference equations,
// midpoint grid and discrete transparent leads; no analytic substitution.
export const KINETIC = 0.0380998212;
const defaults = {energy:1, height:2, width:0.5, shape:'rectangle', gap:0.5, dx:0.005};

function parameters(input={}) {
  const p = {...defaults, ...input};
  for (const [name, [low, high]] of Object.entries({energy:[0.01,10],height:[0,20],width:[0,3],gap:[0,3],dx:[0.0005,0.02]})) {
    if (!Number.isFinite(p[name])) throw new Error(`${name} must be finite`);
    if (p[name]<low || p[name]>high) throw new Error(`${name} must be between ${low} and ${high}`);
  }
  if (!['rectangle','triangle','double'].includes(p.shape)) throw new Error('shape must be rectangle, triangle or double');
  return p;
}

export function analyticTransmission(energy,height,width) {
  if (![energy,height,width].every(Number.isFinite) || energy<=0 || height<0 || width<0) throw new Error('Require finite E>0, V>=0, a>=0');
  if (!height || !width) return 1;
  const delta=height-energy, z=width*Math.sqrt(Math.abs(delta)/KINETIC);
  if (z<1e-5) {
    const ratio=1+(delta>=0?1:-1)*z*z/6;
    return 1/(1+height**2*width**2/(4*energy*KINETIC)*ratio**2);
  }
  if (delta>0) {
    const logSinh=z+Math.log(-Math.expm1(-2*z))-Math.log(2);
    const logFactor=2*Math.log(height)-Math.log(4*energy*delta)+2*logSinh;
    if (logFactor>0) { const inverse=Math.exp(-logFactor); return inverse/(1+inverse); }
    return 1/(1+Math.exp(logFactor));
  }
  return 1/(1+height**2*Math.sin(z)**2/(4*energy*(-delta)));
}

// Match Python's round-to-even for gap cells, including exact half-cell ties.
function roundEven(v) {
  const low=Math.floor(v);
  return v-low===0.5 ? low+(low%2) : Math.round(v);
}

export function simulate(input={}) {
  const p=parameters(input);
  const cells=p.width ? Math.max(1,Math.ceil(p.width/p.dx)) : 0;
  const dx=cells ? p.width/cells : p.dx;
  if (dx<0.0001) throw new Error('Nonzero barrier width must be at least 0.0001 nm; use 0 for no barrier');
  const pad=Math.max(2,Math.ceil(1.2/dx));
  const gapCells=p.shape==='double' && cells ? roundEven(p.gap/dx) : 0;
  const body=p.shape==='double' ? 2*cells+gapCells : cells, n=2*pad+body;
  if (n>100000) throw new Error('Grid too large; increase dx or reduce the spatial extent');
  const potential=new Float64Array(n), x=new Float64Array(n);
  for(let j=0;j<n;j++) x[j]=(j-pad+0.5)*dx;
  for(let j=0;j<cells;j++) {
    potential[pad+j]=p.shape==='triangle' ? p.height*(1-Math.abs(2*(j+0.5)/cells-1)) : p.height;
    if(p.shape==='double') potential[pad+cells+gapCells+j]=p.height;
  }
  const hopping=KINETIC/dx**2;
  if(p.energy>=4*hopping) throw new Error('Energy exceeds the grid propagation band; reduce dx');
  const q=2*Math.asin(Math.sqrt(p.energy/(4*hopping))), sine=Math.sin(q);
  const dr=new Float64Array(n), di=new Float64Array(n);
  const br=new Float64Array(n), bi=new Float64Array(n);
  for(let j=0;j<n;j++) dr[j]=2+(potential[j]-p.energy)/hopping;
  dr[0]-=Math.cos(q); dr[n-1]-=Math.cos(q); di[0]=-sine; di[n-1]=-sine;
  bi[0]=-2*sine;
  for(let j=1;j<n;j++) {
    const den=dr[j-1]**2+di[j-1]**2, ir=dr[j-1]/den, ii=-di[j-1]/den;
    dr[j]-=ir; di[j]-=ii;
    br[j]+=br[j-1]*ir-bi[j-1]*ii;
    bi[j]+=br[j-1]*ii+bi[j-1]*ir;
  }
  const real=new Float64Array(n), imag=new Float64Array(n), density=new Float64Array(n);
  for(let j=n-1;j>=0;j--) {
    const ar=br[j]+(j+1<n?real[j+1]:0), ai=bi[j]+(j+1<n?imag[j+1]:0);
    const den=dr[j]**2+di[j]**2;
    real[j]=(ar*dr[j]+ai*di[j])/den;
    imag[j]=(ai*dr[j]-ar*di[j])/den;
    density[j]=real[j]**2+imag[j]**2;
  }
  const transmission=density[n-1], reflection=(real[0]-1)**2+imag[0]**2;
  const analytic=p.shape==='rectangle' ? analyticTransmission(p.energy,p.height,p.width) : null;
  let currentError=0;
  for(let j=0;j<n-1;j++) currentError=Math.max(currentError,Math.abs((real[j]*imag[j+1]-imag[j]*real[j+1])/sine-transmission));
  const peak=p.width ? p.height : 0;
  return {params:p,x:Array.from(x),potential:Array.from(potential),real:Array.from(real),imag:Array.from(imag),density:Array.from(density),
    transmission,reflection,conservation_error:Math.abs(transmission+reflection-1),current_error:currentError,
    analytic_transmission:analytic,absolute_error:analytic===null?null:Math.abs(transmission-analytic),
    dx,points:n,effective_gap:gapCells*dx,regime:p.energy===peak?'threshold':p.energy<peak?'tunneling':'above',
    method:'central difference / discrete transparent leads'};
}

export function sweep(input={},variable='width',start=0,stop=2,count=81) {
  const p=parameters(input);
  if(!['width','height','energy'].includes(variable)) throw new Error('Sweep variable must be energy, height or width');
  if(!Number.isInteger(count) || count<2 || count>201) throw new Error('Sweep count must be an integer from 2 to 201');
  if(!Number.isFinite(start) || !Number.isFinite(stop) || start>=stop) throw new Error('Sweep start must be less than stop; both must be finite');
  const values=[], transmission=[], analytic=[]; let worst=0;
  for(let j=0;j<count;j++) {
    const value=start+(stop-start)*j/(count-1), result=simulate({...p,[variable]:value});
    values.push(value);transmission.push(result.transmission);analytic.push(result.analytic_transmission);
    worst=Math.max(worst,result.conservation_error);
  }
  return {variable,values,transmission,analytic,max_conservation_error:worst,params:p};
}

export function surface(input={},count=41) {
  const p=parameters(input);
  if(!Number.isInteger(count) || count<5 || count>61) throw new Error('Surface count per axis must be an integer from 5 to 61');
  const widths=Array.from({length:count},(_,i)=>2*i/(count-1));
  const heights=Array.from({length:count},(_,j)=>8*j/(count-1));
  let worst=0;
  const transmission=heights.map(height=>widths.map(width=>{
    const result=simulate({...p,height,width});
    worst=Math.max(worst,result.conservation_error);
    return result.transmission;
  }));
  return {widths,heights,transmission,params:p,count,max_conservation_error:worst};
}

export function solveRequest(path) {
  const url=new URL(path,'https://quantum.invalid'), query=url.searchParams;
  if(!['/api/simulate','/api/sweep','/api/surface'].includes(url.pathname)) throw new Error('Unknown calculation');
  const allowed=new Set(Object.keys(defaults));
  if(url.pathname==='/api/sweep') for(const name of ['variable','start','stop','count']) allowed.add(name);
  if(url.pathname==='/api/surface') allowed.add('count');
  const seen=new Set();
  for(const [name] of query) {
    if(!allowed.has(name)) throw new Error(`Unknown parameter: ${name}`);
    if(seen.has(name)) throw new Error('Query parameters must not be repeated');
    seen.add(name);
  }
  function number(name,fallback) {
    if(!query.has(name)) return fallback;
    const raw=query.get(name);
    if(!raw.trim() || !Number.isFinite(Number(raw))) throw new Error(`${name} must be finite`);
    return Number(raw);
  }
  const p={};
  for(const name of Object.keys(defaults)) if(query.has(name)) p[name]=name==='shape'?query.get(name):number(name);
  if(url.pathname==='/api/simulate') return simulate(p);
  if(url.pathname==='/api/surface') return surface(p,number('count',41));
  const variable=query.get('variable')??'width', limits={width:[0,2],height:[0,8],energy:[0.05,5]}[variable]??[0,2];
  return sweep(p,variable,number('start',limits[0]),number('stop',limits[1]),number('count',81));
}
