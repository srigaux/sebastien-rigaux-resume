#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { scrape } from '#curate-scrape';
const manifestPath=resolve(process.argv[2] || '.local/teams-import/manifest.json');
const cache=resolve(process.argv[3] || '/tmp/teams-prismic-scrapes');
const lock=manifestPath+'.lock';const fd=openSync(lock,'wx');
try {
 loadEnvFile('.env.local');mkdirSync(cache,{recursive:true,mode:0o700});
 const manifest=JSON.parse(readFileSync(manifestPath));
 function save(){writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2),{mode:0o600});renameSync(manifestPath+'.tmp',manifestPath);}
 const pending=manifest.entries.filter(e=>e.status==='pending' && e.publicUrlReviewed===true && e.scrapeAuthorized===true);let next=0;
 async function worker(){while(next<pending.length){const e=pending[next++];e.scrapePath=join(cache,e.key+'.json');
  try {if(!existsSync(e.scrapePath)){const result=await scrape(e.url);writeFileSync(e.scrapePath,JSON.stringify(result),{mode:0o600});} e.status='scraped';delete e.error;}
  catch(error){e.status='blocked';e.error=error.message;}
  save();console.log(JSON.stringify({key:e.key,status:e.status,url:e.url,error:e.error}));
 }}
 await Promise.all(Array.from({length:4},worker));
} finally {closeSync(fd);unlinkSync(lock);}
