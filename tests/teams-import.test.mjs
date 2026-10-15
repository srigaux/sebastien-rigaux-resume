import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHistoricalDraft,assertWriteReady,draftTopicLinks,stageEntry} from '#teams-send';
import {slugFromTitle} from '#curate-send';
const raw={canonicalUrl:'https://example.com/a',selectedOn:'2023-05-01',sourceLanguage:'EN',format:'Article',topics:['react','forms'],fr:{title:'Des formulaires React fiables',summary:'Un guide pratique de validation des formulaires React avec des exemples de gestion des erreurs.'},en:{title:'Build reliable React forms',summary:'A practical guide to validating React forms with examples of handling input errors.'}};
const entry=()=>({selectedOn:raw.selectedOn,status:'ready',draft:raw});
test('historical dates are mandatory and never replaced by today',()=>{
 assert.throws(()=>validateHistoricalDraft({...raw,selectedOn:undefined},entry()),/Historical/);
 assert.throws(()=>validateHistoricalDraft({...raw,selectedOn:'2026-10-13'},entry()),/Historical/);
 assert.equal(validateHistoricalDraft(raw,entry()).selectedOn,'2023-05-01');
});
test('draft topics can be linked without publication',()=>{
 const links=draftTopicLinks([{uid:'forms',id:'unpublished-topic'}]);
 assert.deepEqual(links,[{uid:'forms',link_type:'Document',id:'unpublished-topic'}]);
});
test('partially written entries cannot be blindly retried',()=>{
 assert.doesNotThrow(()=>assertWriteReady(entry()));
 assert.throws(()=>assertWriteReady({...entry(),documents:[{id:'partial'}]}),/reconciliation/);
});
test('a migration failure persists assigned IDs and requires reconciliation',async()=>{
 const e=entry();let saves=0;
 const client={migrate:async(m,{reporter})=>{m._documents[0].document.id='partial-fr';reporter({type:'documents:creating'});throw new Error('Connection interrupted');}};
 await assert.rejects(stageEntry(e,{client,topics:[{uid:'react',link_type:'Document',id:'react'},{uid:'forms',link_type:'Document',id:'forms'}],save:()=>saves++}),/interrupted/);
 assert.equal(e.status,'needs-reconciliation');assert.equal(e.documents[0].id,'partial-fr');assert.ok(saves>=2);
});
test('historical staging derives locale UIDs from titles and reserves existing slugs',async()=>{
 const e=entry();let uids=[];const existing=[{uid:slugFromTitle(raw.fr.title),lang:'fr-be'}];
 const client={migrate:async migration=>{uids=migration._documents.map(x=>x.document.uid);migration._documents.forEach((x,i)=>{x.document.id=`created-${i}`;});}};
 await stageEntry(e,{client,topics:raw.topics.map(uid=>({uid,id:uid})),existing,save:()=>{}});
 assert.notEqual(uids[0],slugFromTitle(raw.fr.title));
 assert.equal(uids[1],slugFromTitle(raw.en.title));
 assert.deepEqual(existing.slice(-2).map(x=>x.uid),uids);
 assert.equal(e.status,'staged');
});
