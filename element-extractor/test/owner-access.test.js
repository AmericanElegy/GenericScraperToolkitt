import {test}from 'node:test';import assert from 'node:assert/strict';import {readFile}from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT}from 'jose';import {Miniflare,convertV4MiniflareOptions}from 'miniflare';import {digest}from '../src/interpretation/pipeline.js';
test('owner gate checks signed Access tokens on page, API and assets and fails closed for production',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
 const issuer='https://test.cloudflareaccess.com',audience='owner-test',email='owner@example.org';
 const script=await readFile(new URL('../worker-code.txt',import.meta.url),'utf8');
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01',bindings:{ACCESS_REQUIRED:'true',ACCESS_ISSUER:issuer,ACCESS_AUD:audience,ACCESS_OWNER_HASH:await digest(email)},outboundService:r=>{assert.equal(r.url,issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});}}));
 const token=async({address=email,aud=audience,exp='1h'}={})=>new SignJWT({email:address}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer).setAudience(aud).setSubject('owner').setIssuedAt().setExpirationTime(exp).sign(privateKey);
 try{
  for(const path of ['/','/api/interpretation/start','/file-import.js'])assert.equal((await mf.dispatchFetch('https://toolkit.example.org'+path)).status,401);
  assert.equal((await mf.dispatchFetch('https://toolkit.example.org/',{headers:{'cf-access-jwt-assertion':await token()}})).status,200);
  assert.equal((await mf.dispatchFetch('https://toolkit.example.org/',{headers:{'cf-access-jwt-assertion':await token({address:'other@example.org'})}})).status,403);
  assert.equal((await mf.dispatchFetch('https://toolkit.example.org/',{headers:{'cf-access-jwt-assertion':await token({aud:'other-app'})}})).status,401);
  assert.equal((await mf.dispatchFetch('https://toolkit.example.org/',{headers:{'cf-access-jwt-assertion':'forged'}})).status,401);
 }finally{await mf.dispose();}
 const unconfigured=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-10-01'}));try{assert.equal((await unconfigured.dispatchFetch('https://example.workers.dev/')).status,503);}finally{await unconfigured.dispose();}
});
