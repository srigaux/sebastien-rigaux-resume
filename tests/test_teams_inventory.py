import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('inventory',Path(__file__).resolve().parents[1]/'.agents/skills/curate-prismic-link/scripts/teams-inventory.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class InventoryTests(unittest.TestCase):
 def test_real_links_and_dates(self):
  data={'messages':[{'id':'new','createdAt':'2024-03-31T22:30:00Z','urls':['https://example.com/ahttps://example.com/a'],'rawBody':{'content':'<a href="https://example.com/a?utm_source=x">A</a><a href="https://example.com/b?v=1&amp;lang=fr">B</a>'}}, {'id':'old','createdAt':'2023-05-01T23:30:00Z','urls':['https://example.com/a'],'rawBody':{'content':'<a href="https://example.com/a">A</a>'}},{'id':'empty','urls':[]}]}
  d=mod.inventory(data);a=next(e for e in d['entries'] if e['url']=='https://example.com/a');b=next(e for e in d['entries'] if '/b?' in e['url'])
  self.assertEqual(len(d['entries']),2);self.assertEqual(a['selectedOn'],'2023-05-02');self.assertEqual(len(a['occurrences']),2);self.assertEqual(b['selectedOn'],'2024-04-01');self.assertIn('v=1&lang=fr',b['url']);self.assertTrue(d['extractionAudit'])
 def test_route_fragments_and_tracking(self):
  self.assertEqual(mod.normalize('https://example.com/#/docs'),'https://example.com/#/docs')
  self.assertEqual(mod.normalize('https://youtube.com/watch?v=abc&si=tracking'),'https://youtube.com/watch?v=abc')
if __name__=='__main__':unittest.main()
