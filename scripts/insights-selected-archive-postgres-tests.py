"""Exercise the proposed archive using catalog definitions and synthetic work only."""
from pathlib import Path
import runpy

fixtures = runpy.run_path(str(Path(__file__).parent / 'fixtures/operational-schedule-postgres.py'))
root = fixtures['root']
catalog = fixtures['catalog']
sql = fixtures['blank_schema']()
for name in ('v_cleaning_session_facts','v_cleaning_performance_comparison','v_custodial_cleaning_session_truth'):
    definition = next(v['definition'] for v in catalog['views'] if v['schema_name']=='public' and v['view_name']==name)
    sql += f'CREATE VIEW public.{name} AS {definition};\n'
sql += (root/'proposals/insights-selected-test-records.sql').read_text()
sql += (root/'scripts/fixtures/insights-selected-archive-checks.sql').read_text()
fixtures['run_pg'](sql)
