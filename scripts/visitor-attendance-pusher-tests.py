import ast,json
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
print(json.dumps({'passed':9,'failed':0,'networkCalls':0,'browserLaunched':False,'hostCollectorChanged':False}))
