"""Clinic's public map point, independent of patient addresses or campaign costs."""
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from .loader import DataError
from .marketing import now,text,ACTOR
from .knowledge import day,today,url
from .campaign_locations import coordinate

LOCK=threading.Lock()
def prepare(raw):
    if not isinstance(raw,dict):raise DataError('병원 위치를 입력해 주세요.')
    result={k:text(raw.get(k),label,limit,True) for k,label,limit in [('name','병원 표시명',120),('address','공개 주소',500),('source_note','위치 확인 근거',1000)]}
    result.update(latitude=coordinate(raw.get('latitude'),'위도',85),longitude=coordinate(raw.get('longitude'),'경도',180),source_url=url(raw.get('source_url'),'공개 위치 출처',True),checked_on=day(raw.get('checked_on'),'출처 확인일',True))
    if result['latitude'] is None or result['longitude'] is None:raise DataError('공개 병원 위치의 위도와 경도를 함께 입력해 주세요.')
    if not '2000-01-01'<=result['checked_on']<=today():raise DataError('출처 확인일은 2000년부터 오늘까지 입력할 수 있습니다.')
    return result

class ClinicLocationStore:
    def __init__(self,path,clinic_id):self.path=Path(path);self.clinic_id=clinic_id;self.marker=self.path.with_suffix(self.path.suffix+'.initialized')
    @contextmanager
    def connection(self,write=False):
        conn=None
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with LOCK:
                exists=self.path.exists()
                if not exists and self.marker.exists():raise DataError('병원 위치 저장소가 없습니다. 빈 위치로 초기화하지 않습니다.')
                if not exists:self.marker.write_text('initialized\n',encoding='ascii')
                conn=sqlite3.connect(self.path,timeout=25,isolation_level=None);conn.row_factory=sqlite3.Row
                if not exists:
                    conn.executescript('''CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),clinic_id TEXT,revision INTEGER);
                    CREATE TABLE history(revision INTEGER PRIMARY KEY,location TEXT,reason TEXT,at TEXT,actor TEXT);''')
                    conn.execute('INSERT INTO meta VALUES(1,?,0)',(self.clinic_id,))
                else:
                    conn.execute('SELECT id,clinic_id,revision FROM meta LIMIT 0');conn.execute('SELECT revision,location,reason,at,actor FROM history LIMIT 0')
                    if not self.marker.exists():self.marker.write_text('initialized\n',encoding='ascii')
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN');meta=conn.execute('SELECT * FROM meta WHERE id=1').fetchone()
            if not meta or meta['clinic_id']!=self.clinic_id or type(meta['revision'])!=int or meta['revision']<0:raise DataError('병원 위치의 식별정보가 일치하지 않습니다.')
            history=[{**dict(r),'location':json.loads(r['location']),'actor':json.loads(r['actor'])} for r in conn.execute('SELECT * FROM history ORDER BY revision DESC')]
            if len(history)!=meta['revision'] or any(r['revision']!=meta['revision']-i for i,r in enumerate(history)):raise DataError('병원 위치 이력이 일치하지 않습니다.')
            for r in history:
                if r['location'] is not None and prepare(r['location'])!=r['location']:raise DataError('저장된 병원 위치를 확인하지 못했습니다.')
                if r['location'] is None:text(r['reason'],'위치 해제 사유',500,True)
            yield conn,meta['revision'],history;conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('병원 위치 저장소를 확인하지 못했습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()
    def _result(self,revision,history):return {'clinic_id':self.clinic_id,'revision':revision,'location':history[0]['location'] if history else None,'history':history[:50],'checked_at':now()}
    def snapshot(self):
        with self.connection() as (_,revision,history):return self._result(revision,history)
    def _write(self,conn,current,history,location,reason):
        if current>=1000:raise DataError('병원 위치 변경 이력 한도에 도달했습니다.')
        actor=ACTOR.get();actor={k:actor[k] for k in ('id','username','name')} if actor else None
        entry={'revision':current+1,'location':location,'reason':reason,'at':now(),'actor':actor}
        conn.execute('INSERT INTO history VALUES(?,?,?,?,?)',(current+1,json.dumps(location,ensure_ascii=False),reason,entry['at'],json.dumps(actor,ensure_ascii=False)))
        conn.execute('UPDATE meta SET revision=? WHERE id=1',(current+1,));return self._result(current+1,[entry,*history])
    def save(self,raw,revision):
        location=prepare(raw)
        with self.connection(True) as (conn,current,history):
            if history and history[0]['location']==location:return self._result(current,history)
            if type(revision)!=int or revision!=current:raise DataError('병원 위치가 변경됐습니다. 다시 확인해 주세요.')
            return self._write(conn,current,history,location,'')
    def clear(self,revision,reason,confirmed):
        reason=text(reason,'위치 해제 사유',500,True)
        if confirmed is not True:raise DataError('지도에서 병원 위치를 해제할지 확인해 주세요.')
        with self.connection(True) as (conn,current,history):
            if type(revision)!=int or revision!=current:raise DataError('병원 위치가 변경됐습니다. 다시 확인해 주세요.')
            if not history or history[0]['location'] is None:raise DataError('해제할 병원 위치가 없습니다.')
            return self._write(conn,current,history,None,reason)
