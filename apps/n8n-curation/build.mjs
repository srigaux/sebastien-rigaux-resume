import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const systemMessage = readFileSync(new URL('./agent-prompt.md', import.meta.url), 'utf8').trim();

export function prepare() {
  const data = $input.first().json;
  const text = String(data.Lien ?? data.chatInput ?? '').trim();
  const urls = text.match(/https?:\/\/[^\s<>]+/g) || [];
  if (urls.length !== 1 || (data.Lien !== undefined && urls[0] !== text)) throw new Error('Saisissez un seul lien HTTP(S) par envoi.');
  const url = urls[0];
  const note = String(data.Note ?? (data.chatInput ? text.replace(url, '').trim() : ''));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Brussels', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const selectedOn = `${parts.year}-${parts.month}-${parts.day}`;
  return [{json:{prompt:JSON.stringify({url,note,selectedOn,nowBrussels:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',dateStyle:'short',timeStyle:'medium'}).format(new Date()),publicationSchedule:{time:'18:00',timeZone:'Europe/Brussels',frequency:'daily'},repository:'bd7d5fa0',instruction:'Importe uniquement ce lien, sans recherche de doublons ni filtrage, en brouillons FR/EN liés avec la date actuelle selectedOn.'})}}];
}
const body = fn => {const s=fn.toString();return s.slice(s.indexOf('{')+1,s.lastIndexOf('}'));};
const allowedTools = ['list_releases','create_release','create_document','upload_asset','present_release'];
export function build(chat=false) {
  const nodes = [
    {id:'instructions',name:'Installation',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[-520,-340],parameters:{width:760,height:240,content:'# Veille FR/EN → Prismic\n1. OpenAI : sélectionner votre credential API.\n2. Context.dev : Header Auth, Authorization = Bearer VOTRE_CLE.\n3. Prismic MCP : Bearer Auth, write token du repository bd7d5fa0.\n4. Tester puis activer le workflow pour utiliser son URL.\nSoumettre un lien crée directement des brouillons FR/EN liés.\nRelease de veille réutilisée. Publication souhaitée : 18 h Europe/Brussels. Programmer la release dans Prismic ; le MCP ne peut pas fixer cet horaire.'}},
    chat ? {id:'trigger',name:'Chat',type:'@n8n/n8n-nodes-langchain.chatTrigger',typeVersion:1.3,position:[-480,0],webhookId:'a38c226c-c81b-4099-920b-67a56232cb08',parameters:{public:false,options:{responseMode:'lastNode',title:'Ajouter à ma veille',subtitle:'Collez un lien et une note facultative.',initialMessages:'Collez le lien à ajouter à votre veille. Je préparerai les fiches FR/EN dans Prismic.'}}}
      : {id:'trigger',name:'Formulaire',type:'n8n-nodes-base.formTrigger',typeVersion:2.2,position:[-480,0],webhookId:'c45f52ec-e71d-4e1b-a3d1-238a909f1bde',parameters:{formTitle:'Ajouter à ma veille',formDescription:'Collez un lien. La date du jour est ajoutée automatiquement. Les fiches françaises et anglaises seront préparées dans une release Prismic.',formFields:{values:[{fieldLabel:'Lien',fieldType:'text',placeholder:'https://exemple.com/article',requiredField:true},{fieldLabel:'Note',fieldType:'textarea',placeholder:'Un angle, un détail à retenir…'}]},responseMode:'onReceived',options:{buttonLabel:'Créer les brouillons'}}},
    {id:'input',name:'Préparer la demande',type:'n8n-nodes-base.code',typeVersion:2,position:[-220,0],parameters:{jsCode:body(prepare)}},
    {id:'agent',name:'Agent de veille',type:'@n8n/n8n-nodes-langchain.agent',typeVersion:2.2,position:[80,0],parameters:{promptType:'define',text:'={{ $json.prompt }}',hasOutputParser:false,options:{systemMessage,maxIterations:25,returnIntermediateSteps:false,enableStreaming:false}}},
    {id:'openai',name:'OpenAI Chat Model',type:'@n8n/n8n-nodes-langchain.lmChatOpenAi',typeVersion:1.2,position:[-40,300],parameters:{model:{__rl:true,mode:'id',value:'gpt-4.1'},options:{temperature:0.2}}},
    {id:'context',name:'context_dev',type:'n8n-nodes-base.httpRequestTool',typeVersion:4.2,position:[220,300],parameters:{toolDescription:'Lire une URL avec Context.dev et obtenir son contenu Markdown et toutes les métadonnées : auteur, image Open Graph, favicon, dates et langue. Appeler une fois par lien avant de rédiger.',method:'POST',url:'https://api.context.dev/v1/web/scrape',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:"={{ JSON.stringify({ url: $fromAI('url', 'URL exacte à lire', 'string'), formats: { markdown: true, screenshot: true }, sharedParams: { dismissPopups: true, settleAnimations: true, mainContentOnly: true }, markdownParams: { includeLinks: false }, maxAgeMs: $fromAI('fresh', 'true pour une actualité sensible ou une lecture fraîche, false sinon', 'boolean', false) ? 0 : 31536000000 }) }}",options:{timeout:120000},optimizeResponse:true,responseType:'json',fieldsToInclude:'selected',fields:'url,markdown,metadata',truncateResponse:false}},
    {id:'prismic',name:'Prismic MCP',type:'@n8n/n8n-nodes-langchain.mcpClientTool',typeVersion:1.2,position:[480,300],parameters:{endpointUrl:'https://mcp.prismic.io/mcp',serverTransport:'httpStreamable',authentication:'bearerAuth',include:'selected',includeTools:allowedTools,options:{timeout:120000}}},
    {id:'wait',name:'attendre',type:'@n8n/n8n-nodes-langchain.toolCode',typeVersion:1.3,position:[740,300],parameters:{name:'attendre',description:'Attendre 6 secondes après une erreur de limitation 429 avant une nouvelle tentative.',jsCode:"await new Promise(resolve => setTimeout(resolve, 6000)); return 'Attente de 6 secondes terminée.';"}},
  ];
  const connections={};
  function connect(a,b,type='main') {connections[a]={[type]:[[{node:b,type,index:0}]]};}
  connect(chat?'Chat':'Formulaire','Préparer la demande');connect('Préparer la demande','Agent de veille');
  connect('OpenAI Chat Model','Agent de veille','ai_languageModel');
  for(const n of ['context_dev','Prismic MCP','attendre'])connect(n,'Agent de veille','ai_tool');
  if(!chat) {
    nodes.push({id:'response',name:'Afficher le bilan',type:'n8n-nodes-base.form',typeVersion:1,position:[500,0],webhookId:'b1f63b60-a293-4aa2-937d-e67c0092dd71',parameters:{operation:'completion',respondWith:'text',completionTitle:'Bilan de votre lien',completionMessage:'={{ $json.output }}',options:{}}});
    connect('Agent de veille','Afficher le bilan');
  }
  return {name:chat?'Veille - Chat + OpenAI + Prismic':'Veille - Formulaire + OpenAI + Prismic',nodes,connections,active:false,pinData:{},settings:{executionOrder:'v1',timezone:'Europe/Brussels',saveManualExecutions:true,saveExecutionProgress:true,saveDataErrorExecution:'all',saveDataSuccessExecution:'all'},tags:[]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  for(const [chat,name] of [[false,'n8n-curation.n8n.json'],[true,'n8n-curation-chat.n8n.json']]) writeFileSync(new URL('./'+name,import.meta.url),JSON.stringify(build(chat),null,2)+'\n');
}
