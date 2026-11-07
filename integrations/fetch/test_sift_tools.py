import tempfile
import unittest
from sift_tools import SiftTools

P='aaaaaaaa-aaa'; J='bbbbbbbb-bbb'

class ToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.calls=[]
        self.run={'id':J,'status':'completed','baseline':{'submitP95':8,'secret':'no'},'best':{'submitP95':2},'experiments':[{'id':'cccccccc-ccc','status':'accepted'}]}
        def request(route,body=None,text=False):
            self.calls.append((route,body))
            if route=='/api/state': return {'projects':[{'id':P,'name':'Warehouse','lastAcceptedRun':J},{'id':'dddddddd-ddd','name':'PRIVATE'}],'worker':{'alive':True},'runs':[]}
            if route.endswith('/runs'):return {'id':J,'status':'queued'}
            if route.endswith('/report'):return self.run
            if route.endswith('/verdict'):return {'status':'accepted','sourcePath':'PRIVATE','checks':{'selection':True}}
            if route.endswith('/patch'):return 'a'*15001
            raise AssertionError(route)
        self.tools=SiftTools([P],self.tmp.name,request=request,max_jobs=2)
    def tearDown(self):self.tmp.cleanup()
    def test_allowlist_and_ownership(self):
        self.assertEqual(len(self.tools.list_projects()),1)
        with self.assertRaises(ValueError):self.tools.start('alice','1','dddddddd-ddd','goal')
        self.assertFalse(any(route.endswith('/runs') for route,_ in self.calls))
        self.tools.start('alice','1',P,'preserve selection')
        with self.assertRaises(ValueError):self.tools.status('bob',J)
        self.assertNotIn('secret',self.tools.status('alice',J)['baseline'])
    def test_idempotency_and_real_receipt(self):
        self.tools.start('alice','same',P,'goal')
        self.tools.start('alice','same',P,'goal')
        self.assertEqual(sum(r.endswith('/runs') for r,_ in self.calls),1)
        e=self.tools.evidence('alice',J)
        self.assertTrue(e['verified'])
        self.assertNotIn('sourcePath',e['receipts'][0]['verdict'])
    def test_patch_chunks_and_rejected_block(self):
        self.tools.start('alice','1',P,'goal')
        chunks=[self.tools.patch('alice',J,o) for o in (0,7000,14000)]
        self.assertEqual(''.join(c['patch'] for c in chunks),'a'*15001)
        self.assertEqual(len({c['sha256'] for c in chunks}),1)
        self.run['experiments'][0]['status']='rejected'
        with self.assertRaises(ValueError):self.tools.patch('alice',J)
    def test_asi_mentions_are_normalized(self):
        from sift_agent import normalize_text
        self.assertEqual(normalize_text('@agent123 projects', 'agent123'), 'projects')
        self.assertEqual(normalize_text('@sift-3d status '+J, 'agent123'), 'status '+J)
        self.assertEqual(normalize_text('@other projects', 'agent123'), '@other projects')

    def test_no_backend_url_override(self):
        with self.assertRaises(ValueError):SiftTools([P],self.tmp.name,base='https://example.com')

if __name__=='__main__':unittest.main()
