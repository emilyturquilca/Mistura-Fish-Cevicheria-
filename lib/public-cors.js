// Only the restaurant's published ordering app may call these public endpoints.
export const orderingOrigin='https://pedidos-mistura-fish.vercel.app';
export function cors(handler){return async request=>{
  const response=await handler(request);
  if(request.headers.get('origin')===orderingOrigin){
    response.headers.set('Access-Control-Allow-Origin',orderingOrigin);
    response.headers.set('Vary','Origin');
  }
  return response;
}}
export function OPTIONS(request){
  if(request.headers.get('origin')!==orderingOrigin)return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':orderingOrigin,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, X-Order-Token',
    'Access-Control-Max-Age':'600','Vary':'Origin','Cache-Control':'no-store'
  }});
}
