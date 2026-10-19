"""Exact offline road/building reference. Contains public addresses only."""
import csv
import hashlib
import json
import os
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime,timezone,timedelta
from pathlib import Path

ROAD_DB=Path(__file__).resolve().parents[1]/'.local'/'public-data'/'roads-capital.sqlite'
SOURCE_URL='https://www.epost.go.kr/search/zipcode/areacdAddressDown.jsp'
KST=timezone(timedelta(hours=9))
PROVINCES={'11':('서울특별시','서울'),'28':('인천광역시','인천'),'41':('경기도','경기')}


def build_road_database(stream,path,index,metadata,*,additional_streams=()):
    required={'시도','시군구','도로명','지하여부','건물번호본번','건물번호부번','법정동코드','법정동명'}
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    counts={'source_rows':0,'accepted_rows':0,'rejected_rows':0}
    provinces={}
    try:
        with closing(sqlite3.connect(temporary)) as conn:
            conn.execute('CREATE TABLE roads (sig TEXT, road TEXT, basement INTEGER, main INTEGER, sub INTEGER, emd TEXT, PRIMARY KEY(sig,road,basement,main,sub,emd)) WITHOUT ROWID')
            for source in (stream,*additional_streams):
                reader=csv.DictReader(source,delimiter='|')
                if not required.issubset(reader.fieldnames or []):raise ValueError('Public address columns are missing')
                accepted_before=counts['accepted_rows']
                for row in reader:
                    if any(row[k] is None for k in required):raise ValueError('Incomplete public address row')
                    counts['source_rows']+=1
                    code=row['법정동코드'].strip();short=code[:8];sig=code[:5]
                    province=row['시도'].strip();district=row['시군구'].strip()
                    dong=row['법정동명'].strip();town=(row.get('읍면') or '').strip();ri=(row.get('리명') or '').strip()
                    group=next((p for p,(name,_) in PROVINCES.items() if name==province),None)
                    stats=provinces.setdefault(group,{'source_rows':0,'accepted_rows':0,'rejected_rows':0}) if group else None
                    if stats:stats['source_rows']+=1
                    # Postal ri codes identify their legal eup/myeon by the first
                    # eight digits. Require the explicit town name, never the ri
                    # name alone, and verify its full parent against the boundary.
                    valid_town=town.endswith(('읍','면')) and not dong
                    name=' '.join((province,district,town if valid_town else dong))
                    valid_code=bool(re.fullmatch(r'(11|28|41)\d{8}',code)) and code[:2]==group
                    valid_unit=(valid_town and bool(ri or code[-2:]=='00')) or (not town and bool(dong) and code[-2:]=='00' and not ri)
                    if not valid_code or not valid_unit or index.names['emd'].get(short)!=name:
                        counts['rejected_rows']+=1
                        if stats:stats['rejected_rows']+=1
                        continue
                    road=row['도로명'].strip()
                    try:basement,main,sub=(int(row[k]) for k in ('지하여부','건물번호본번','건물번호부번'))
                    except (ValueError,TypeError):raise ValueError('Invalid public building number') from None
                    if not road or basement not in (0,1) or main<1 or sub<0:raise ValueError('Invalid public building number')
                    conn.execute('INSERT OR IGNORE INTO roads VALUES (?,?,?,?,?,?)',(sig,road,basement,main,sub,short))
                    counts['accepted_rows']+=1;stats['accepted_rows']+=1
                if counts['accepted_rows']==accepted_before:raise ValueError('No verified address rows in source')
            codes=sorted(p for p,stats in provinces.items() if stats['accepted_rows'])
            result={**metadata,**counts,'scope':' · '.join(PROVINCES[p][1] for p in codes),'province_codes':codes,'province_counts':provinces,'built_at':datetime.now(KST).isoformat(),'boundary_version':index.provenance['boundary_date']}
            conn.execute('CREATE TABLE metadata (value TEXT NOT NULL)')
            conn.execute('INSERT INTO metadata VALUES (?)',(json.dumps(result,ensure_ascii=False),))
            conn.commit()
        os.replace(temporary,path)
        return result
    finally:
        if temporary.exists():temporary.unlink()


class RoadLookup:
    def __init__(self,path):
        self.path=Path(path) if path else None;self.fingerprint=None;self.cache={};self.metadata={}
        self.refresh()

    def connect(self):
        return sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)

    def refresh(self):
        checked=datetime.now(KST).isoformat()
        try:
            if not self.path:raise OSError
            digest=hashlib.sha256(self.path.read_bytes()).hexdigest()
            if digest!=self.fingerprint:
                with closing(self.connect()) as conn:
                    conn.execute('SELECT sig,road,basement,main,sub,emd FROM roads LIMIT 0')
                    if conn.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError
                    metadata=json.loads(conn.execute('SELECT value FROM metadata').fetchone()[0])
                    if not isinstance(metadata,dict):raise ValueError
                    codes=metadata.get('province_codes',['11'] if metadata.get('scope')=='서울' else [])
                    if not isinstance(codes,list) or not codes or any(p not in PROVINCES for p in codes) or len(set(codes))!=len(codes) or not metadata.get('as_of'):raise ValueError
                    metadata={**metadata,'province_codes':codes,'scope':' · '.join(PROVINCES[p][1] for p in sorted(codes))}
                self.cache={};self.metadata=metadata;self.fingerprint=digest
            self.metadata={**self.metadata,'connected':True,'checked_at':checked}
        except (OSError,sqlite3.Error,ValueError,TypeError,IndexError):
            self.cache={};self.fingerprint=None;self.metadata={'connected':False,'checked_at':checked}
        return self.fingerprint

    def covers(self,sig):
        return self.metadata.get('connected',False) and str(sig)[:2] in self.metadata.get('province_codes',[])

    def lookup(self,sig,road,basement,main,sub):
        key=(sig,road,basement,main,sub)
        if not self.metadata.get('connected'):return set()
        if key not in self.cache:
            try:
                with closing(self.connect()) as conn:
                    self.cache[key]=frozenset(row[0] for row in conn.execute('SELECT emd FROM roads WHERE sig=? AND road=? AND basement=? AND main=? AND sub=?',key))
            except sqlite3.Error:
                self.cache={};self.fingerprint=None
                self.metadata={'connected':False,'checked_at':datetime.now(KST).isoformat()}
                return set()
        return set(self.cache[key])
