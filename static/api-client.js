// Local Python mode uses HTTP; the published static build uses real computation
// in a disposable worker. Termination makes slider cancellation immediate.
(() => {
  window.quantumFetch = (path, options={}) => {
    if(document.documentElement.dataset.compute!=='browser') return fetch(path,options);
    return new Promise((resolve,reject)=>{
      const {signal}=options;
      const aborted=()=>new DOMException('Calculation cancelled','AbortError');
      if(signal?.aborted) { reject(aborted()); return; }
      let worker;
      try { worker=new Worker('/static/stationary-worker.js',{type:'module'}); }
      catch(error) { reject(error); return; }
      const cleanup=()=>{ worker.terminate(); signal?.removeEventListener('abort',cancel); };
      const cancel=()=>{ cleanup(); reject(aborted()); };
      signal?.addEventListener('abort',cancel,{once:true});
      worker.onmessage=({data})=>{
        cleanup();
        resolve(new Response(JSON.stringify(data.data),{status:data.ok?200:400,headers:{'Content-Type':'application/json'}}));
      };
      worker.onerror=()=>{cleanup(); reject(new Error('Could not start the calculation. Please reload and retry.'));};
      worker.onmessageerror=()=>{cleanup(); reject(new Error('Could not read the calculation result.'));};
      worker.postMessage(path);
    });
  };
})();
