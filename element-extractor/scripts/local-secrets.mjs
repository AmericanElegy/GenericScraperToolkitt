import {readFile}from 'node:fs/promises';
export async function localSecrets(){
 const values={...process.env};const text=await readFile('.dev.vars','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
 for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m||!m[2])continue;let value=m[2];if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw Error('Invalid quoted value in local secrets file.');}}else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);if(!values[m[1]])values[m[1]]=value;}
 return {openai:values.OPENAI_API_KEY,anthropic:values.ANTHROPIC_API_KEY||values.ANTHROPIC_KEY};
}
