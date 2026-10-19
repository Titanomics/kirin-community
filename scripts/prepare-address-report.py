"""Prepare an aggregate report locally; never uploads or requests credentials."""
import argparse,json,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from analytics_runtime.address_summary import parse_workbook,enrich_regions,render_report,validate_report
from analytics_runtime.backend import identifier
from analytics_runtime.runtime import public_road
from clinic_analytics.regions import RegionIndex

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','period','clinic-id','clinic-name','clinic-address','output'):
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args();source=Path(args.source)
    clinic={'id':identifier(args.clinic_id),'name':args.clinic_name}
    report=parse_workbook(source.read_bytes(),period=args.period,source_name=source.name)
    report['clinic_id']=clinic['id']
    enrich_regions(report,RegionIndex(road_path=public_road()),args.clinic_address)
    validate_report(report,clinic['id'])
    target=Path(args.output);target.mkdir(parents=True,exist_ok=True)
    (target/(args.period+'.json')).write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    (target/(args.clinic_name+'_'+args.period+'_지역분석.html')).write_text(render_report(report,clinic),encoding='utf8')
    print(json.dumps({'period':report['period'],'complexes':len(report['rows']),'records':report['total_records'],
        'mapped_records':sum(r['records'] for r in report['rows'] if r.get('region_code')),
        'unmatched_complexes':[r['name'] for r in report['rows'] if not r.get('region_code')],
        'regions':sorted({r['region_name'] for r in report['rows']})},ensure_ascii=True))

if __name__=='__main__':main()
