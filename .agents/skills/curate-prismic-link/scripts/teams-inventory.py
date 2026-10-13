#!/usr/bin/env python3
"""Extract Teams hyperlinks, retaining provenance and earliest Belgian date."""
import argparse, hashlib, json, re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from zoneinfo import ZoneInfo
TRACKING = {'fbclid','gclid','dclid','msclkid','twclid','ck_subscriber_id','_bhlid','_obid','mibextid','igsh','link_source','taid','rcm','ref_src','ref_url'}
class Anchors(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.urls=[]
    def handle_starttag(self, tag, attrs):
        if tag == 'a': self.urls.extend(v for k,v in attrs if k=='href' and v)
def normalize(value):
    p=urlsplit(value.strip())
    if p.scheme not in ('http','https') or not p.hostname: raise ValueError('Not an HTTP URL')
    host=p.hostname.lower()
    pairs=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if k.lower() not in TRACKING and not k.lower().startswith(('utm_','hsa_'))]
    if host in ('youtu.be','youtube.com','www.youtube.com'): pairs=[(k,v) for k,v in pairs if k!='si']
    if host=='github.com': pairs=[(k,v) for k,v in pairs if k!='tab']
    fragment=p.fragment
    if re.match(r'\d+:',fragment) or fragment.startswith('Echobox='): fragment=''
    return urlunsplit((p.scheme.lower(),p.netloc.lower(),p.path or '/',urlencode(pairs),fragment))
def inventory(data):
    entries={}; audit=[]
    for m in data['messages']:
        if not m.get('urls'): continue
        parser=Anchors(); parser.feed(m.get('rawBody',{}).get('content',''))
        actual=parser.urls or m['urls']
        for u in dict.fromkeys(actual):
            try: url=normalize(u)
            except ValueError:
                audit.append({'messageId':m['id'],'url':u,'reason':'invalid-url'});continue
            item=entries.setdefault(url,{'key':hashlib.sha256(url.encode()).hexdigest()[:16],'url':url,'status':'pending','occurrences':[]})
            item['occurrences'].append({'messageId':m['id'],'createdAt':m['createdAt'],'url':u,'note':m.get('description')})
        for u in m['urls']:
            if u not in actual: audit.append({'messageId':m['id'],'url':u,'reason':'export-field-differs-from-html','htmlUrls':list(dict.fromkeys(actual))})
    for item in entries.values():
        item['occurrences'].sort(key=lambda o:datetime.fromisoformat(o['createdAt'].replace('Z','+00:00')))
        item['selectedOn']=datetime.fromisoformat(item['occurrences'][0]['createdAt'].replace('Z','+00:00')).astimezone(ZoneInfo('Europe/Brussels')).date().isoformat()
    return {'version':1,'source':'docs/teams-history.json','entries':sorted(entries.values(),key=lambda x:(x['selectedOn'],x['url'])),'extractionAudit':audit}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args();dest=Path(a.output)
    if dest.exists(): raise SystemExit('Manifest exists: refusing to overwrite import progress')
    d=inventory(json.loads(Path(a.input).read_text()));dest.write_text(json.dumps(d,ensure_ascii=False,indent=2));dest.chmod(0o600)
    print(json.dumps({'entries':len(d['entries']),'audit':len(d['extractionAudit'])}))
