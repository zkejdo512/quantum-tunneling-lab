import {solveRequest} from './stationary-core.mjs';
self.onmessage = ({data}) => {
  try { self.postMessage({ok:true, data:solveRequest(data)}); }
  catch(error) { self.postMessage({ok:false, data:{error:error.message || 'Calculation failed'}}); }
};
