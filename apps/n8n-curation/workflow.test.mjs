import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, prepare, systemMessage } from './build.mjs';
const fn=prepare.toString();
const prepareInput=new Function('$input',fn.slice(fn.indexOf('{')+1,fn.lastIndexOf('}')));
const run=data=>JSON.parse(prepareInput({first:()=>({json:data})})[0].json.prompt);
test('single link is preserved and supplied dates are ignored',()=>{
 const url='https://example.com/a?utm_source=mail';
 const result=run({Lien:url,Note:'Mon angle','Date de sauvegarde':'2025-12-31'});
 assert.equal(result.url,url);assert.equal(result.note,'Mon angle');assert.notEqual(result.selectedOn,'2025-12-31');
 assert.throws(()=>run({Lien:url+' '+url}),/un seul lien/);
 assert.throws(()=>run({Lien:''}),/un seul lien/);
});
test('chat separates its single URL and note',()=>{
 const result=run({chatInput:'Voici https://example.com/a conserve son exemple React.'});
 assert.equal(result.url,'https://example.com/a');assert.match(result.note,/conserve son exemple React/);
 assert.throws(()=>run({chatInput:'https://example.com/a https://example.com/b'}),/un seul lien/);
});
test('date follows current Brussels day across UTC midnight',()=>{
 const code=fn.slice(fn.indexOf('{')+1,fn.lastIndexOf('}'));
 const execute=new Function('$input','Date',code);
 for(const [instant,expected] of [['2026-10-15T22:30:00Z','2026-10-16'],['2026-01-15T23:30:00Z','2026-01-16']]){
  class Clock extends Date {constructor(){super(instant);}}
  const result=execute({first:()=>({json:{Lien:'https://example.com'}})},Clock);
  assert.equal(JSON.parse(result[0].json.prompt).selectedOn,expected);
 }
});
test('form ends with native Form Ending and has no date field',()=>{
 const w=build();const trigger=w.nodes.find(n=>n.name==='Formulaire');
 assert.deepEqual(trigger.parameters.formFields.values.map(f=>f.fieldLabel),['Lien','Note']);
 assert.notEqual(trigger.parameters.responseMode,'responseNode');
 assert.ok(!w.nodes.some(n=>n.type==='n8n-nodes-base.respondToWebhook'));
 const ending=w.nodes.find(n=>n.name==='Afficher le bilan');
 assert.equal(ending.type,'n8n-nodes-base.form');assert.equal(ending.parameters.operation,'completion');
 assert.equal(ending.parameters.completionMessage,'={{ $json.output }}');
});
for(const chat of [false,true])test(`valid ${chat?'chat':'form'} export and AI connections`,()=>{
 const workflow=build(chat);const names=new Set(workflow.nodes.map(n=>n.name));
 for(const [source,types] of Object.entries(workflow.connections)){assert.ok(names.has(source));for(const [type,branches] of Object.entries(types))for(const branch of branches)for(const edge of branch){assert.ok(names.has(edge.node));assert.equal(edge.type,type);}}
 assert.equal(workflow.connections['OpenAI Chat Model'].ai_languageModel[0][0].node,'Agent de veille');
 assert.equal(workflow.connections['Prismic MCP'].ai_tool[0][0].node,'Agent de veille');
 assert.equal(workflow.connections.context_dev.ai_tool[0][0].node,'Agent de veille');
 assert.equal(workflow.active,false);
 const mcp=workflow.nodes.find(n=>n.name==='Prismic MCP').parameters;
 assert.equal(mcp.include,'selected');assert.ok(mcp.includeTools.includes('create_document'));assert.ok(mcp.includeTools.includes('upload_asset'));assert.ok(!mcp.includeTools.includes('publish_release'));assert.ok(!mcp.includeTools.includes('search_assets'));
 const file=new URL(chat?'./n8n-curation-chat.n8n.json':'./n8n-curation.n8n.json',import.meta.url);
 assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),workflow);
 for(const node of workflow.nodes)assert.equal(node.credentials,undefined);
});
test('Context tool uses fixed endpoint, expected parameters, fresh option and excludes screenshots',()=>{
 const p=build().nodes.find(n=>n.name==='context_dev').parameters;
 assert.equal(p.url,'https://api.context.dev/v1/web/scrape');
 assert.equal(p.fields,'url,markdown,metadata');assert.equal(p.optimizeResponse,true);
 const expr=p.jsonBody.slice(3,-3);
 for(const fresh of [true,false]){
  const body=JSON.parse(new Function('$fromAI','return '+expr)((key)=>key==='url'?'https://example.com':fresh));
  assert.equal(body.url,'https://example.com');assert.equal(body.maxAgeMs,fresh?0:31536000000);assert.equal(body.formats.markdown,true);assert.equal(body.formats.screenshot,true);assert.equal(body.markdownParams.includeLinks,false);
 }
});
test('agent retains bilingual editorial and translation requirements',()=>{
 for(const text of ['translationOfDocumentId','source_language','selected_on','800 caractères','140 mots','Aucun contrôle de doublon','Ne publie jamais','site_icon','credit'])assert.ok(systemMessage.includes(text),text);
});

test('embedded reference removes discovery tools and includes all topic IDs',()=>{
 const reference=JSON.parse(readFileSync(new URL('./prismic-reference.json',import.meta.url),'utf8'));
 for(const entry of [...reference.topics,...reference.sources])assert.ok(systemMessage.includes(entry.id));
 const tools=build().nodes.find(n=>n.name==='Prismic MCP').parameters.includeTools;
 assert.deepEqual(tools,['list_releases','create_release','create_document','upload_asset','present_release']);
 assert.match(systemMessage,/ImageContent/);assert.match(systemMessage,/GroupItemContent/);assert.match(systemMessage,/spans: \[\]/);
});

test('daily publication intent and current Brussels time are supplied',()=>{
 const result=run({Lien:'https://example.com'});
 assert.deepEqual(result.publicationSchedule,{time:'18:00',timeZone:'Europe/Brussels',frequency:'daily'});
 assert.match(result.nowBrussels,/\d{4}-\d{2}-\d{2}/);
 assert.ok(systemMessage.includes('Veille — à publier'));
 assert.ok(systemMessage.includes("N'invente pas de paramètre"));
});
