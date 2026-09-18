/* Independently implemented central-difference TDSE / Crank–Nicolson.
 * Units nm, eV, fs; electron mass. No third-party numerical code.
 */
export const C = 0.0380998212;
export const HBAR = 0.6582119569;
export class WavePacket {
  constructor(options = {}) {
    this.p = {energy:1,height:1.5,width:0.3,gap:0.6,shape:'rectangle',sigma:1.4,dx:0.02,dt:0.008,halfDomain:80,...options};
    const p=this.p;
    for(const [name,lo,hi] of [['energy',.25,3],['height',0,5],['width',0,1],['gap',0,2],['sigma',.7,2.4],['dx',.01,.04],['dt',.001,.02],['halfDomain',40,120]]) {
      if(!Number.isFinite(p[name])||p[name]<lo||p[name]>hi) throw new Error(`Invalid ${name}`);
    }
    if(!['rectangle','double'].includes(p.shape)) throw new Error('Invalid shape');
    this.n=Math.round(2*p.halfDomain/p.dx);
    this.dx=2*p.halfDomain/this.n;
    this.width=Math.round(p.width/this.dx)*this.dx;
    this.gap=Math.round(p.gap/this.dx)*this.dx;
    this.span=p.shape==='double'?2*this.width+this.gap:this.width;
    this.x0=-(6*p.sigma+6);this.k=Math.sqrt(p.energy/C);
    this.velocity=2*C*this.k/HBAR;
    this.duration=(2*Math.abs(this.x0)+this.span+8)/this.velocity;
    this.time=0;this.steps=0;this.maxEdge=0;
    const array=()=>new Float64Array(this.n);
    this.x=array();this.v=array();this.re=array();this.im=array();
    this.invRe=array();this.invIm=array();this.cpRe=array();this.cpIm=array();
    this.workRe=array();this.workIm=array();this.diagonal=array();
    const a=C*p.dt/(2*HBAR*this.dx*this.dx);this.a=a;
    let norm=0;
    for(let j=0;j<this.n;j++) {
      const x=-p.halfDomain+(j+.5)*this.dx;this.x[j]=x;
      this.v[j]=(x>=0&&x<this.width || p.shape==='double'&&x>=this.width+this.gap&&x<this.span)?p.height:0;
      const envelope=Math.exp(-((x-this.x0)**2)/(4*p.sigma*p.sigma));
      this.re[j]=envelope*Math.cos(this.k*(x-this.x0));this.im[j]=envelope*Math.sin(this.k*(x-this.x0));
      norm+=(this.re[j]**2+this.im[j]**2)*this.dx;
      const b=2*a+p.dt*this.v[j]/(2*HBAR);this.diagonal[j]=b;
      // A diagonal = 1+i*b, offdiagonal = -i*a. Reuse LU factors.
      const pr=1-(j?a*this.cpIm[j-1]:0), pi=b+(j?a*this.cpRe[j-1]:0);
      const den=pr*pr+pi*pi;
      this.invRe[j]=pr/den;this.invIm[j]=-pi/den;
      this.cpRe[j]=-a*pi/den;this.cpIm[j]=-a*pr/den;
    }
    const scale=1/Math.sqrt(norm);for(let j=0;j<this.n;j++){this.re[j]*=scale;this.im[j]*=scale;}
  }
  advance(count=1) {
    const {n,re,im,workRe:wr,workIm:wi,invRe:ir,invIm:ii,cpRe:cr,cpIm:ci,diagonal:b,a}=this;
    for(let step=0;step<count;step++) {
      for(let j=0;j<n;j++) {
        // B psi = (1-i*b)psi + i*a*(psi_left+psi_right).
        let rr=re[j]+b[j]*im[j]-a*((j?im[j-1]:0)+(j+1<n?im[j+1]:0));
        let ri=im[j]-b[j]*re[j]+a*((j?re[j-1]:0)+(j+1<n?re[j+1]:0));
        if(j){rr-=a*wi[j-1];ri+=a*wr[j-1];}
        wr[j]=rr*ir[j]-ri*ii[j];wi[j]=rr*ii[j]+ri*ir[j];
      }
      re[n-1]=wr[n-1];im[n-1]=wi[n-1];
      for(let j=n-2;j>=0;j--) {
        re[j]=wr[j]-cr[j]*re[j+1]+ci[j]*im[j+1];
        im[j]=wi[j]-cr[j]*im[j+1]-ci[j]*re[j+1];
      }
    }
    this.steps+=count;this.time=this.steps*this.p.dt;
  }
  statistics() {
    let left=0,middle=0,right=0,norm=0,mean=0,second=0,edge=0,near=0;
    for(let j=0;j<this.n;j++){
      const x=this.x[j],q=(this.re[j]**2+this.im[j]**2)*this.dx;
      norm+=q;mean+=x*q;second+=x*x*q;
      if(x<0)left+=q;else if(x<this.span)middle+=q;else right+=q;
      if(Math.abs(x)>this.p.halfDomain-8)edge+=q;
      if(x>-3&&x<this.span+3)near+=q;
    }
    this.maxEdge=Math.max(this.maxEdge,edge);
    return {time:this.time,left,middle,right,norm,mean:mean/norm,sigma:Math.sqrt(Math.max(0,second/norm-(mean/norm)**2)),edge,maxEdge:this.maxEdge,near};
  }
  snapshot(stride=4) {
    const length=Math.ceil(this.n/stride),re=new Float32Array(length),im=new Float32Array(length);
    for(let j=0,k=0;j<this.n;j+=stride,k++){re[k]=this.re[j];im[k]=this.im[j];}
    return {...this.statistics(),re,im};
  }
}
export function rectangleTransmission(energy,height,width) {
  if(height===0||width===0)return 1;
  const d=height-energy,z=width*Math.sqrt(Math.abs(d)/C);
  const r=z<1e-7?1:d>0?Math.sinh(z)/z:Math.sin(z)/z;
  return 1/(1+height*height*width*width*r*r/(4*energy*C));
}
export function rectanglePacketTransmission(p) {
  const k0=Math.sqrt(p.energy/C),dk=1/(2*p.sigma),n=800;
  let sum=0,weight=0;
  for(let i=0;i<=n;i++){
    const z=-7+14*i/n,k=k0+dk*z,w=Math.exp(-z*z/2)*(i===0||i===n?.5:1);
    weight+=w;if(k>0)sum+=w*rectangleTransmission(C*k*k,p.height,p.width);
  }
  return sum/weight;
}
