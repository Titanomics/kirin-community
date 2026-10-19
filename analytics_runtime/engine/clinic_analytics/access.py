"""Optional local operator accounts. Enabling authentication is one-way."""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager,closing
from pathlib import Path
from .loader import DataError

HASH_GATE=threading.BoundedSemaphore(2)
SCRYPT={'n':2**17,'r':8,'p':1,'dklen':32,'maxmem':256*1024*1024}
SESSION_SECONDS=12*60*60
IDLE_SECONDS=30*60


class AccessError(DataError):
    def __init__(self,message,status=403):super().__init__(message);self.status=status


def password_hash(password,salt=None):
    if not isinstance(password,str) or not 12<=len(password)<=256 or len(password.encode())>1024:
        raise AccessError('비밀번호는 12~256자로 입력해 주세요.',400)
    salt=salt or secrets.token_hex(16)
    with HASH_GATE:value=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),**SCRYPT).hex()
    return json.dumps({'algorithm':'scrypt-v1','salt':salt,'hash':value,**SCRYPT},separators=(',',':'))


def matches(password,stored):
    try:
        encoded=json.loads(stored)
        if encoded.get('algorithm')!='scrypt-v1' or any(encoded.get(k)!=v for k,v in SCRYPT.items()):return False
        computed=json.loads(password_hash(password,encoded['salt']))['hash']
        return hmac.compare_digest(computed,encoded['hash'])
    except (ValueError,TypeError,KeyError,AccessError):return False


class AccessStore:
    def __init__(self,root):
        self.root=Path(root);self.path=self.root/'identity.sqlite';self.marker=self.root/'authentication-enabled'
        self.clock=time.time
        if self.marker.exists() and not self.path.is_file():raise DataError('인증 저장소가 없습니다. 접근을 열지 않습니다.')
        existing=self.path.exists()
        self.root.mkdir(parents=True,exist_ok=True)
        try:
            with closing(sqlite3.connect(self.path)) as conn:
                if existing:
                    conn.execute('SELECT enabled FROM settings WHERE id=1')
                    conn.execute('SELECT id,username,name,role,grants,password,active,version FROM users LIMIT 0')
                    conn.execute('SELECT token_hash,user_id,created,last_seen,expires FROM sessions LIMIT 0')
                    conn.execute('SELECT name,started,count FROM attempts LIMIT 0')
                else:conn.executescript('''
                CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL);
                INSERT OR IGNORE INTO settings VALUES(1,0);
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE,name TEXT,role TEXT,grants TEXT,password TEXT,active INTEGER,version INTEGER);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,created REAL,last_seen REAL,expires REAL);
                CREATE TABLE IF NOT EXISTS attempts(name TEXT PRIMARY KEY,started REAL,count INTEGER);
                ''')
            self.status()
        except (sqlite3.Error,OSError):raise DataError('인증 저장소를 열지 못했습니다.') from None

    @contextmanager
    def connection(self,write=False):
        if not self.path.is_file():raise DataError('인증 저장소가 없습니다. 접근을 열지 않습니다.')
        conn=None
        try:
            conn=sqlite3.connect(self.path,timeout=25,isolation_level=None);conn.row_factory=sqlite3.Row
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            row=conn.execute('SELECT enabled FROM settings WHERE id=1').fetchone()
            if row is None or row[0] not in (0,1) or (self.marker.exists() and not row[0]):raise DataError('인증 상태가 일치하지 않습니다. 접근을 열지 않습니다.')
            yield conn,bool(row[0]);conn.commit()
        except (sqlite3.Error,OSError,ValueError,KeyError,TypeError):
            if conn:conn.rollback()
            raise DataError('인증 자료를 확인하지 못했습니다. 접근을 열지 않습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()

    def _public(self,row):
        return {'id':row['id'],'username':row['username'],'name':row['name'],'role':row['role'],'clinic_ids':json.loads(row['grants']),'active':bool(row['active']),'version':row['version']}

    def status(self,token=None):
        with self.connection() as (_,enabled):pass
        user=None
        if enabled and token:
            try:user=self.principal(token)
            except AccessError:pass
        return {'enabled':enabled,'authenticated':bool(user),'setup_available':not enabled,'user':user}

    def _new_session(self,conn,user_id):
        token=secrets.token_urlsafe(32);now=self.clock()
        conn.execute('DELETE FROM sessions WHERE expires<=? OR last_seen<=?',(now,now-IDLE_SECONDS))
        conn.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user_id,now,now,now+SESSION_SECONDS))
        return token

    def setup(self,username,name,password):
        username,name=self._identity(username,name);encoded=password_hash(password)
        with self.connection(True) as (conn,enabled):
            if enabled or conn.execute('SELECT count(*) FROM users').fetchone()[0]:raise AccessError('관리자가 이미 설정돼 있습니다.',409)
            identifier=uuid.uuid4().hex
            conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?,1,0)',(identifier,username,name,'admin','[]',encoded))
            self.marker.write_text('enabled\n',encoding='ascii')
            conn.execute('UPDATE settings SET enabled=1 WHERE id=1')
            return self._new_session(conn,identifier)

    def _identity(self,username,name):
        if not isinstance(username,str) or not re.fullmatch('[a-zA-Z0-9_.-]{3,64}',username):raise AccessError('아이디는 영문·숫자·._- 3~64자로 입력해 주세요.',400)
        if not isinstance(name,str) or not 1<=len(name.strip())<=100:raise AccessError('담당자 이름을 입력해 주세요.',400)
        return username.lower(),name.strip()

    def login(self,username,password):
        if not isinstance(username,str) or len(username)>64:raise AccessError('아이디와 비밀번호를 확인해 주세요.',401)
        username=username.lower();now=self.clock();invalid=False
        with self.connection(True) as (conn,enabled):
            if not enabled:raise AccessError('먼저 관리자를 설정해 주세요.',400)
            for key,limit in [(username,5),('*',30)]:
                attempt=conn.execute('SELECT started,count FROM attempts WHERE name=?',(key,)).fetchone()
                if attempt and now-attempt['started']<300 and attempt['count']>=limit:raise AccessError('로그인 시도가 많습니다. 5분 뒤 다시 시도해 주세요.',429)
            row=conn.execute('SELECT * FROM users WHERE username=?',(username,)).fetchone()
            if row:valid=matches(password,row['password']) and row['active']
            else:
                # Equal-cost work for a syntactically valid unknown account.
                try:password_hash(password,'00'*16)
                except AccessError:pass
                valid=False
            if not valid:
                for key in (username,'*'):
                    conn.execute('INSERT INTO attempts VALUES(?,?,1) ON CONFLICT(name) DO UPDATE SET count=CASE WHEN ?-started>=300 THEN 1 ELSE count+1 END,started=CASE WHEN ?-started>=300 THEN ? ELSE started END',(key,now,now,now,now))
                invalid=True
            else:
                conn.execute('DELETE FROM attempts WHERE name=?',(username,));token=self._new_session(conn,row['id'])
        if invalid:raise AccessError('아이디와 비밀번호를 확인해 주세요.',401)
        return token

    def principal(self,token):
        if not isinstance(token,str) or not re.fullmatch('[A-Za-z0-9_-]{43}',token):raise AccessError('로그인이 필요합니다.',401)
        with self.connection(True) as (conn,enabled):
            if not enabled:raise AccessError('로그인이 설정되지 않았습니다.',401)
            digest=hashlib.sha256(token.encode()).hexdigest()
            session=conn.execute('SELECT * FROM sessions WHERE token_hash=?',(digest,)).fetchone();now=self.clock()
            if not session or session['expires']<=now or session['last_seen']<=now-IDLE_SECONDS:raise AccessError('로그인이 만료됐습니다. 다시 로그인해 주세요.',401)
            user=conn.execute('SELECT * FROM users WHERE id=?',(session['user_id'],)).fetchone()
            if not user or not user['active']:raise AccessError('접근 권한이 없습니다.',403)
            conn.execute('UPDATE sessions SET last_seen=? WHERE token_hash=?',(now,digest))
            return self._public(user)

    def _authorize(self,conn,enabled,principal,clinic_id=None,write=False,admin=False):
        if not enabled:return None
        if not principal:raise AccessError('로그인이 필요합니다.',401)
        row=conn.execute('SELECT * FROM users WHERE id=?',(principal.get('id'),)).fetchone()
        if not row or not row['active'] or row['version']!=principal.get('version'):raise AccessError('접근 권한이 변경됐습니다. 다시 로그인해 주세요.',401)
        user=self._public(row)
        if admin and user['role']!='admin':raise AccessError('관리자만 변경할 수 있습니다.')
        if clinic_id is not None and user['role']!='admin' and clinic_id not in user['clinic_ids']:raise AccessError('이 병원에 접근할 권한이 없습니다.')
        if write and user['role']=='viewer':raise AccessError('조회 권한으로는 자료를 변경할 수 없습니다.')
        return user

    def authorize(self,principal,clinic_id=None,write=False,admin=False):
        with self.connection() as (conn,enabled):return self._authorize(conn,enabled,principal,clinic_id,write,admin)

    def logout(self,token):
        if not isinstance(token,str):return
        with self.connection(True) as (conn,_):conn.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))

    def users(self,principal):
        with self.connection() as (conn,enabled):
            self._authorize(conn,enabled,principal,admin=True)
            return [self._public(row) for row in conn.execute('SELECT * FROM users ORDER BY username')]

    def save_user(self,principal,data,clinic_ids):
        if not isinstance(data,dict):raise AccessError('담당자 입력을 확인해 주세요.',400)
        username,name=self._identity(data.get('username'),data.get('name'))
        role=data.get('role');grants=data.get('clinic_ids',[]);active=data.get('active',True)
        if role not in ('admin','editor','viewer') or not isinstance(grants,list) or any(not isinstance(x,str) or x not in clinic_ids for x in grants) or type(active)!=bool:raise AccessError('역할과 병원 권한을 확인해 주세요.',400)
        encoded=password_hash(data['password']) if data.get('password') else None
        with self.connection(True) as (conn,enabled):
            self._authorize(conn,enabled,principal,admin=True)
            if not enabled:raise AccessError('관리자 초기 설정을 먼저 해 주세요.',400)
            old=conn.execute('SELECT * FROM users WHERE id=?',(data.get('id'),)).fetchone()
            if data.get('id') and not old:raise AccessError('수정할 계정이 없습니다.',400)
            if old and (type(data.get('version'))!=int or data['version']!=old['version']):raise AccessError('계정 정보가 변경됐습니다. 다시 확인해 주세요.',409)
            if old and old['active'] and old['role']=='admin' and (not active or role!='admin') and conn.execute("SELECT count(*) FROM users WHERE active=1 AND role='admin'").fetchone()[0]<=1:
                raise AccessError('마지막 관리자는 비활성화하거나 권한을 낮출 수 없습니다.',400)
            if not old and not encoded:raise AccessError('새 계정에는 비밀번호가 필요합니다.',400)
            identifier=old['id'] if old else uuid.uuid4().hex
            if conn.execute('SELECT 1 FROM users WHERE username=? AND id<>?',(username,identifier)).fetchone():raise AccessError('이미 사용 중인 아이디입니다.',400)
            conn.execute('INSERT OR REPLACE INTO users VALUES(?,?,?,?,?,?,?,?)',(identifier,username,name,role,json.dumps(sorted(set(grants))),encoded or old['password'],int(active),old['version']+1 if old else 0))
            conn.execute('DELETE FROM sessions WHERE user_id=?',(identifier,))
            return self._public(conn.execute('SELECT * FROM users WHERE id=?',(identifier,)).fetchone())

    def change_password(self,principal,current,new):
        encoded=password_hash(new)
        with self.connection(True) as (conn,enabled):
            user=self._authorize(conn,enabled,principal)
            if not user:raise AccessError('로그인이 필요합니다.',401)
            row=conn.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            if not matches(current,row['password']):raise AccessError('현재 비밀번호를 확인해 주세요.',400)
            conn.execute('UPDATE users SET password=?,version=version+1 WHERE id=?',(encoded,user['id']))
            conn.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
