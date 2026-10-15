#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import * as prismic from '@prismicio/client';
import { validateDraft, prepareMigration } from '#curate-send';
export function validateHistoricalDraft(raw, entry) {
 if (!raw.selectedOn || raw.selectedOn !== entry.selectedOn) throw new Error('Historical selectedOn must match the first Teams date');
 return validateDraft(raw);
}
export function assertWriteReady(entry) {
 if (entry.status !== 'ready') throw new Error('Entry must be editorially reviewed and ready');
 if (entry.documents?.length) throw new Error('Partial documents require remote reconciliation before retry');
}
export function draftTopicLinks(registry) {
 return registry.filter(t=>t.id).map(t=>({uid:t.uid,link_type:'Document',id:t.id}));
}
export async function stageEntry(entry, {client,topics,sources=[],existing=[],save}) {
 assertWriteReady(entry);
 const draft=validateHistoricalDraft(entry.draft,entry);
 // Optional media failures must not discard a verified editorial entry.
 entry.missingAssets ||= [];
 for (const field of ['imageUrl','siteIconUrl']) {
  if (!draft[field]) continue;
  try {
   const response=await fetch(draft[field],{signal:AbortSignal.timeout(15000)});
   if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Unusable asset (${response.status})`);
   await response.body?.cancel();
  } catch(error) {entry.missingAssets.push({field,url:draft[field],reason:error.message});delete draft[field];}
 }
 const {migration,french,english}=prepareMigration(draft,{topics,sources,usedUids:{fr:existing.filter(d=>d.lang==='fr-be').map(d=>d.uid),en:existing.filter(d=>d.lang==='en-us').map(d=>d.uid)}});
 const checkpoint=()=>{entry.documents=[french,english].filter(d=>d.document.id).map(d=>({id:d.document.id,uid:d.document.uid,lang:d.document.lang}));save();};
 entry.status='writing';save();
 try {
  await client.migrate(migration,{reporter:checkpoint});checkpoint();
  if(entry.documents.length!==2)throw new Error('Expected two document IDs');
  existing.push({uid:french.document.uid,lang:'fr-be'},{uid:english.document.uid,lang:'en-us'});
  entry.status='staged';save();
 }catch(error){checkpoint();entry.status='needs-reconciliation';entry.error=error.message;save();throw error;}
}
async function main(){
 const [manifestArg,limitArg='10']=process.argv.slice(2);
 if(!manifestArg)throw new Error('Usage: teams-send.mjs <manifest> [limit]; stages ready entries only');
 const path=resolve(manifestArg),lock=path+'.lock';const fd=openSync(lock,'wx');
 try {
  loadEnvFile('.env.local');
  const m=JSON.parse(readFileSync(path));
  const save=()=>{writeFileSync(path+'.tmp',JSON.stringify(m,null,2),{mode:0o600});renameSync(path+'.tmp',path);};
  const {repositoryName}=JSON.parse(readFileSync('prismic-models/prismic.config.json'));
  const client=prismic.createWriteClient(repositoryName,{writeToken:process.env.PRISMIC_WRITE_TOKEN});
  const [publishedTopics,sources,existing]=await Promise.all([client.getAllByType('topic',{lang:'fr-be'}),client.getAllByType('discovery_source',{lang:'fr-be'}),client.getAllByType('curated_link',{lang:'*'})]);
  for(const staged of m.entries.filter(e=>e.status==='staged'))for(const doc of staged.documents||[])if(doc.uid&&doc.lang)existing.push({uid:doc.uid,lang:doc.lang});
  const topics=[...publishedTopics,...draftTopicLinks(m.topicRegistry||[])];
  for(const entry of m.entries.filter(e=>e.status==='ready').slice(0,Number(limitArg))){
   try {await stageEntry(entry,{client,topics,sources,existing,save});console.log(JSON.stringify({key:entry.key,status:entry.status,documents:entry.documents}));}
   catch(error){console.log(JSON.stringify({key:entry.key,status:entry.status,error:error.message}));break;}
  }
 }finally{closeSync(fd);unlinkSync(lock);}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(e=>{console.error(JSON.stringify({name:e.name,message:e.message,cause:e.cause?.message,stack:e.stack}));process.exitCode=1;});
