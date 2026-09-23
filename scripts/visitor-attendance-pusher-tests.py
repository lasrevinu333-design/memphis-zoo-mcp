import ast,json,re
from pathlib import Path
from types import SimpleNamespace
root=Path(__file__).resolve().parents[1]
source=(root/'ops/attendance/attendance_pusher.py').read_text()
tree=ast.parse(source)
push=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='push_attendance')
captured=[]
response=SimpleNamespace(status_code=200,json=lambda:{'ok':True,'data':{'attendance':0}})
def post(url,**kw):
 captured.append((url,kw))
 return response
ns={'requests':SimpleNamespace(post=post),'json':json,'PUSH_URL':'https://memphis-zoo-mcp.onrender.com/collector-api/visitor-attendance','ATTENDANCE_COLLECTOR_TOKEN':'synthetic-test-token'}
exec(compile(ast.Module(body=[push],type_ignores=[]),'<isolated collector function>','exec'),ns)
assert ns['push_attendance']({'attendance':0})['ok'] is True
url,options=captured[0]
assert url.endswith('/collector-api/visitor-attendance')
assert options['headers']['Authorization']=='Bearer synthetic-test-token'
assert 'x-admin-key' not in options['headers']
assert options['json']['attendance']==0
assert options['timeout']==20
response.status_code=401
try:ns['push_attendance']({'attendance':0});raise AssertionError('401 accepted')
except RuntimeError:pass
assert 'ADMIN_API_KEY' not in source
assert 'ATTENDANCE_COLLECTOR_TOKEN' in source
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'parse_int_from_text','extract_labeled_metric'}]
ns['re']=re
exec(compile(ast.Module(body=functions,type_ignores=[]),'<isolated collector parser>','exec'),ns)
passed=9
for source_text,expected in [('0',0),('1,234',1234),(' 27 ',27),('-1',None),('1.5',None),('N/A (updated 09:30)',None),('1,23',None),('2,147,483,648',None),('',None)]:
 assert ns['parse_int_from_text'](source_text)==expected,source_text
 passed+=1
card='200 Last Year: 2,706 Planned: 2000 Yesterday: 4,256 Yesterday Plan: 2500'
for label,expected in [('Last Year',2706),('Planned',2000),('Yesterday',4256),('Yesterday Plan',2500)]:
 assert ns['extract_labeled_metric'](card,label)==expected,label
 passed+=1
for invalid in ['Planned: 1.5','Planned: -1','Planned: N/A (updated 09:30)','Planned: 1,23']:
 try:ns['extract_labeled_metric'](invalid,'Planned');raise AssertionError(invalid+' accepted')
 except RuntimeError:pass
 passed+=1
print(json.dumps({'passed':passed,'failed':0,'networkCalls':0,'browserLaunched':False,'hostCollectorChanged':False}))
