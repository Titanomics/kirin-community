"""Persistent public-channel observations; independent from manual review outcomes."""
import difflib
import hashlib
import json
import sqlite3
import threading
import uuid
import re
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from .loader import DataError,KST
from .marketing import now,text,ACTOR,INITIALIZE_LOCK
from .public_fetch import public_url,fetch_public


class VisibleText(HTMLParser):
    def __init__(self):super().__init__();self.hidden=0;self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript','svg'):self.hidden+=1
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript','svg'):self.hidden=max(0,self.hidden-1)
    def handle_data(self,value):
        if not self.hidden and value.strip():self.parts.append(' '.join(value.split()))


def parse_observation(source,response):
    body=response['body'];mime=response['content_type'].split(';')[0].strip().lower()
    if source['mode']=='rss':
        if b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():raise DataError('외부 정의가 포함된 피드는 읽지 않습니다.')
        try:root=ET.fromstring(body)
        except ET.ParseError:raise DataError('RSS 또는 Atom 피드 형식을 확인해 주세요.') from None
        tag=lambda node:node.tag.rsplit('}',1)[-1]
        if tag(root) not in ('rss','feed','RDF'):raise DataError('RSS 또는 Atom 피드가 아닙니다.')
        items=[]
        for node in (n for n in root.iter() if tag(n) in ('item','entry')):
            values={tag(child):(child.text or '').strip() for child in node}
            links=[child.attrib.get('href','') for child in node if tag(child)=='link' and child.attrib.get('rel','alternate')=='alternate']
            link=values.get('link') or next((x for x in links if x),'')
            try:link=public_url(urljoin(response['url'],link)) if link else source['url']
            except DataError:link=source['url']
            identity=values.get('guid') or values.get('id') or link+'|'+values.get('title','')
            items.append({'key':hashlib.sha256(identity.encode()).hexdigest(),'title':values.get('title','새 공개 게시물')[:300],'url':link})
            if len(items)>=100:break
        return {'items':items,'fingerprint':hashlib.sha256(json.dumps(items,sort_keys=True).encode()).hexdigest()}
    if mime not in ('text/html','application/xhtml+xml','text/plain'):raise DataError('공개 HTML·텍스트 페이지로 등록해 주세요.')
    encoding=re.search(r'charset=["\']?([\w-]+)',response['content_type'],re.I)
    try:decoded=body.decode(encoding.group(1) if encoding else 'utf-8')
    except (LookupError,UnicodeError):raise DataError('공개 페이지 문자 인코딩을 확인하지 못했습니다.') from None
    parser=VisibleText();parser.feed(decoded);visible='\n'.join(parser.parts)
    if not visible:raise DataError('확인할 공개 문구가 없습니다. 로그인이 필요한 채널은 수동 확인으로 등록하세요.')
    return {'fingerprint':hashlib.sha256(visible.encode()).hexdigest(),'text':visible[:16000],'truncated':len(visible)>16000}


class MonitorStore:
    def __init__(self,path,clinic_id):self.path=Path(path);self.clinic_id=clinic_id;self.marker=self.path.with_suffix('.sqlite.initialized')
    @contextmanager
    def connection(self,write=False):
        conn=None
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with INITIALIZE_LOCK:
                exists=self.path.exists()
                if not exists and self.marker.exists():raise DataError('채널 확인 저장소가 없습니다. 빈 상태로 초기화하지 않습니다.')
                conn=sqlite3.connect(self.path,timeout=25,isolation_level=None)
                if not exists:
                    conn.executescript('CREATE TABLE meta(id INTEGER PRIMARY KEY,clinic_id TEXT,revision INTEGER);CREATE TABLE sources(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE events(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE checks(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT,at TEXT,status TEXT,message TEXT);')
                    conn.execute('INSERT INTO meta VALUES(1,?,0)',(self.clinic_id,));self.marker.write_text('initialized\n',encoding='ascii')
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN');meta=conn.execute('SELECT clinic_id,revision FROM meta WHERE id=1').fetchone()
            if not meta or meta[0]!=self.clinic_id:raise DataError('채널 확인 저장소의 병원이 일치하지 않습니다.')
            yield conn,meta[1];conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('채널 확인 기록을 읽거나 저장하지 못했습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()
    def _sources(self,conn):return [json.loads(r[0]) for r in conn.execute('SELECT payload FROM sources ORDER BY id')]
    def snapshot(self,workspace=None):
        with self.connection() as (conn,revision):
            sources=self._sources(conn);events=[json.loads(r[0]) for r in conn.execute("SELECT payload FROM events ORDER BY (json_extract(payload,'$.acknowledged_at') IS NULL) DESC,rowid DESC LIMIT 200")]
            unacknowledged=conn.execute("SELECT count(*) FROM events WHERE json_extract(payload,'$.acknowledged_at') IS NULL").fetchone()[0]
            event_count=conn.execute('SELECT count(*) FROM events').fetchone()[0]
            checks=[dict(zip(('id','source_id','at','status','message'),r)) for r in conn.execute('SELECT * FROM checks ORDER BY id DESC LIMIT 100')]
        overdue=[]
        for review in (workspace or {}).get('reviews',[]):
            if review['status'] in ('resolved','closed'):continue
            age=max(0,round((datetime.now(KST)-datetime.fromisoformat(review['found_at'])).total_seconds()/3600,1))
            overdue.append({'id':review['id'],'title':review['title'],'owner':review['owner'],'status':review['status'],'age_hours':age,'unstarted':not review['started_at']})
        return {'clinic_id':self.clinic_id,'revision':revision,'sources':[{k:v for k,v in s.items() if k not in ('baseline','seen')} for s in sources],'events':events,'event_count':event_count,'checks':checks,'auto_count':sum(s['auto'] for s in sources),'open_reviews':sorted(overdue,key=lambda r:-r['age_hours']),'checked_at':now(),'unacknowledged_count':unacknowledged}
    def save(self,data,revision):
        if not isinstance(data,dict):raise DataError('확인할 채널 정보를 입력해 주세요.')
        mode=data.get('mode');platform=data.get('platform');auto=data.get('auto',False);interval=data.get('interval_minutes',60)
        if mode not in ('page','rss','manual') or platform not in ('website','blog','naver_place','google','other') or type(auto)!=bool or type(interval)!=int or not 30<=interval<=10080:raise DataError('채널 종류와 확인 간격을 확인해 주세요.')
        if (mode=='manual' and auto) or (platform in ('naver_place','google') and mode!='manual'):raise DataError('플레이스·리뷰 채널은 수동 확인으로 등록해 주세요.')
        prepared={'title':text(data.get('title'),'채널 이름',150,True),'url':public_url(data.get('url')),'mode':mode,'platform':platform,'owner':text(data.get('owner'),'담당자',100),'auto':auto,'interval_minutes':interval}
        with self.connection(True) as (conn,current):
            if type(revision)!=int or revision!=current:raise DataError('채널 기록이 바뀌었습니다. 새로 확인해 주세요.')
            sources=self._sources(conn);previous=next((s for s in sources if s['id']==data.get('id')),None)
            if data.get('id') and not previous:raise DataError('이 병원의 채널을 선택해 주세요.')
            if not previous and len(sources)>=50:raise DataError('병원당 채널은 최대 50개입니다.')
            reset=not previous or any(previous[k]!=prepared[k] for k in ('url','mode'))
            source={**(previous or {}),**prepared,'id':previous['id'] if previous else uuid.uuid4().hex,'version':previous['version']+1 if previous else 1,'updated_at':now()}
            if reset:source.update(baseline=None,seen=[],last_status='never',last_checked=None,last_message='아직 확인하지 않았습니다.')
            conn.execute('INSERT OR REPLACE INTO sources VALUES(?,?)',(source['id'],json.dumps(source,ensure_ascii=False)));conn.execute('UPDATE meta SET revision=revision+1')
        return {'source':{k:v for k,v in source.items() if k not in ('baseline','seen')},'revision':current+1}
    def check(self,identifier):
        with self.connection() as (conn,_):source=next((s for s in self._sources(conn) if s['id']==identifier),None)
        if not source:raise DataError('이 병원의 채널을 선택해 주세요.')
        if source['mode']=='manual':raise DataError('이 채널은 원문을 열어 수동으로 확인하고 리뷰 대응 기록에 남겨 주세요.')
        observation=None;message='공개 채널을 확인했습니다.';status='ok'
        try:observation=parse_observation(source,fetch_public(source['url']))
        except DataError as error:status='error';message=str(error)
        with self.connection(True) as (conn,_):
            latest=next((s for s in self._sources(conn) if s['id']==identifier),None)
            if latest['version']!=source['version'] or latest['last_checked']!=source['last_checked']:raise DataError('확인 중 채널 설정이나 기록이 바뀌었습니다. 다시 확인해 주세요.')
            events=[]
            if observation is not None:
                baseline=source['baseline']
                if source['mode']=='rss':
                    seen=set(source['seen'])
                    if len(seen)>10000:raise DataError('피드 확인 항목 한도에 도달했습니다. 채널 설정을 검토해 주세요.')
                    for item in observation['items']:
                        if baseline is not None and item['key'] not in seen:events.append({'title':item['title'],'url':item['url'],'detail':'이전에 관측하지 않은 공개 피드 항목입니다. 게시 시각이나 실제 신규 여부는 원문에서 확인해 주세요.'})
                        seen.add(item['key'])
                    source['seen']=sorted(seen)
                elif baseline and baseline['fingerprint']!=observation['fingerprint']:
                    diff='\n'.join(difflib.unified_diff(baseline['text'].splitlines(),observation['text'].splitlines(),fromfile='이전 확인',tofile='이번 확인',lineterm=''))[:2000]
                    events.append({'title':source['title']+' · 공개 문구 변경','url':source['url'],'detail':diff or '보관 범위 밖의 문구 변경입니다. 원문을 확인해 주세요.'})
                source['baseline']=observation
                if baseline is None:message='첫 관측을 기준으로 저장했습니다.'
            stamp=now();source.update(last_status=status,last_checked=stamp,last_message=message)
            for event in events:
                event.update(id=uuid.uuid4().hex,source_id=identifier,detected_at=stamp,acknowledged_at=None,acknowledged_by=None,ack_note='')
                conn.execute('INSERT INTO events VALUES(?,?)',(event['id'],json.dumps(event,ensure_ascii=False)))
            conn.execute('INSERT INTO checks(source_id,at,status,message) VALUES(?,?,?,?)',(identifier,stamp,status,message))
            conn.execute('DELETE FROM checks WHERE id NOT IN (SELECT id FROM checks ORDER BY id DESC LIMIT 2000)')
            conn.execute('UPDATE sources SET payload=? WHERE id=?',(json.dumps(source,ensure_ascii=False),identifier));conn.execute('UPDATE meta SET revision=revision+1')
        return {'status':status,'message':message,'new_events':len(events),'checked_at':stamp}
    def ack(self,identifier,note,revision):
        note=text(note,'확인 기록',1000,True)
        with self.connection(True) as (conn,current):
            if type(revision)!=int or revision!=current:raise DataError('확인 기록이 바뀌었습니다. 새로 확인해 주세요.')
            row=conn.execute('SELECT payload FROM events WHERE id=?',(identifier,)).fetchone()
            if not row:raise DataError('이 병원의 변경 알림을 선택해 주세요.')
            event=json.loads(row[0]);actor=ACTOR.get();event.update(acknowledged_at=now(),ack_note=note,acknowledged_by=actor['name'] if actor else '이 PC 담당자')
            conn.execute('UPDATE events SET payload=? WHERE id=?',(json.dumps(event,ensure_ascii=False),identifier));conn.execute('UPDATE meta SET revision=revision+1')
        return {'revision':current+1}
    def check_due(self):
        for source in self.snapshot()['sources']:
            if not source['auto']:continue
            if source['last_checked'] and (datetime.now(KST)-datetime.fromisoformat(source['last_checked'])).total_seconds()<source['interval_minutes']*60:continue
            try:self.check(source['id'])
            except DataError:continue


class MonitorService:
    def __init__(self,server):self.server=server;self.stop=threading.Event();self.thread=threading.Thread(target=self.run,daemon=True,name='public-channel-checks');self.thread.start()
    def run(self):
        while not self.stop.wait(30):
            try:identifiers=self.server.agency.ids()
            except (DataError,OSError):continue
            for identifier in identifiers:
                if self.stop.is_set():return
                try:
                    context=self.server.agency.resolve(identifier);path=context.marketing.path.with_name('monitoring.sqlite')
                    if path.is_file():MonitorStore(path,identifier).check_due()
                except (DataError,OSError):continue
    def close(self):self.stop.set()
