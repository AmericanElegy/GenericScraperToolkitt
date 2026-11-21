import {createRemoteJWKSet,jwtVerify}from 'jose';
const keySets=new Map();
export async function ownerAccess(request,env={}){
 const hostname=new URL(request.url).hostname;
 if(env.ACCESS_REQUIRED!=='true'&&!hostname.endsWith('.workers.dev'))return null;
 const issuer=env.ACCESS_ISSUER,audience=env.ACCESS_AUD,owner=env.ACCESS_OWNER_HASH;
 const denied=(message,status)=>new Response(message,{status,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'')||!audience||!/^[a-f0-9]{64}$/.test(owner||''))return denied('Private workbench access is not configured.',503);
 const token=request.headers.get('cf-access-jwt-assertion');if(!token)return denied('Sign in through Cloudflare Access to use this private workbench.',401);
 try{
  if(!keySets.has(issuer))keySets.set(issuer,createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs')));
  const {payload}=await jwtVerify(token,keySets.get(issuer),{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
  if(typeof payload.email!=='string')return denied('Owner identity is required.',403);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload.email.trim().toLowerCase())),hash=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==owner)return denied('This workbench is restricted to its owner.',403);
  return null;
 }catch{return denied('Cloudflare Access identity could not be verified. Sign in again.',401);}
}
