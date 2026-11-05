import test from 'node:test';import assert from 'node:assert/strict';
import { OPTIONS,cors,orderingOrigin } from '../lib/public-cors.js';
import { originAllowed } from '../lib/online-store.js';
test('Only the published ordering origin receives cross-origin permission, without admin headers or credentials',async()=>{
  const trusted=new Request('https://misturafishreports.vercel.app/api/web-orders',{headers:{origin:orderingOrigin}});
  assert.equal(originAllowed(trusted),true);const pre=OPTIONS(trusted);assert.equal(pre.status,204);
  assert.equal(pre.headers.get('Access-Control-Allow-Headers'),'Content-Type, X-Order-Token');
  assert.equal(pre.headers.has('Access-Control-Allow-Credentials'),false);
  const read=cors(async()=>Response.json({enabled:true}));const response=await read(trusted);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),orderingOrigin);assert.equal((await response.json()).enabled,true);
  const other=new Request(trusted.url,{headers:{origin:'https://another.example'}});
  assert.equal(originAllowed(other),false);assert.equal(OPTIONS(other).status,403);assert.equal((await read(other)).headers.has('Access-Control-Allow-Origin'),false);
});
