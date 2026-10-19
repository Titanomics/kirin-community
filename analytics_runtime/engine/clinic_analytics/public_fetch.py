"""Bounded public HTTPS reads with pinned DNS, robots rules and no browser credentials."""
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit,urlunsplit,urljoin,quote
from urllib.robotparser import RobotFileParser
from .loader import DataError

AGENT='ClinicChannelMonitor/1.0'
MAX_BODY=1024*1024


def public_url(value):
    try:
        if not isinstance(value,str) or not 1<=len(value)<=1500 or any(ord(c)<33 for c in value):raise ValueError
        p=urlsplit(value)
        if p.scheme!='https' or not p.hostname or p.username or p.password or p.port not in (None,443):raise ValueError
        host=p.hostname.encode('idna').decode('ascii').lower().rstrip('.')
        if host=='localhost' or '.' not in host or host.endswith(('.local','.localhost','.internal')):raise ValueError
        try:ipaddress.ip_address(host)
        except ValueError:pass
        else:raise ValueError
        return urlunsplit(('https',host,quote(p.path or '/',safe='/%:@-._~!$&\'()*+,;='),quote(p.query,safe='=&%:@/?-._~!$\'()*+,;'),''))
    except (ValueError,UnicodeError):raise DataError('공개 HTTPS 주소만 사용할 수 있습니다. 내부 주소·인증정보·별도 포트는 허용하지 않습니다.') from None


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self,host,address):super().__init__(host,443,timeout=8,context=ssl.create_default_context());self.address=address
    def connect(self):
        sock=socket.create_connection((self.address,443),self.timeout)
        try:self.sock=self._context.wrap_socket(sock,server_hostname=self.host)
        except Exception:sock.close();raise


def _request(url):
    p=urlsplit(public_url(url));connection=None
    try:
        addresses=list(dict.fromkeys(r[4][0] for r in socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)))
        if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):raise DataError('내부 네트워크로 연결되는 주소는 확인하지 않습니다.')
        connection=PinnedHTTPS(p.hostname,addresses[0]);connection.request('GET',urlunsplit(('','',p.path,p.query,'')),headers={'User-Agent':AGENT,'Accept-Encoding':'identity','Accept':'text/html,application/rss+xml,application/atom+xml,text/plain,application/xml'})
        response=connection.getresponse();headers={k.lower():v for k,v in response.getheaders()}
        if headers.get('content-encoding','identity') not in ('','identity'):raise DataError('압축 응답은 현재 수집 범위에 포함되지 않습니다.')
        body=response.read(MAX_BODY+1)
        if len(body)>MAX_BODY:raise DataError('공개 응답 크기가 1MB를 넘었습니다.')
        return response.status,headers,body
    except (OSError,http.client.HTTPException,ValueError):raise DataError('공개 채널 연결을 확인하지 못했습니다.') from None
    finally:
        if connection:connection.close()


def _follow(url):
    for _ in range(4):
        url=public_url(url);status,headers,body=_request(url)
        if status in (301,302,303,307,308):
            if not headers.get('location'):raise DataError('이동할 공개 주소가 없습니다.')
            url=urljoin(url,headers['location']);continue
        return status,headers,body,url
    raise DataError('공개 주소 이동 횟수가 너무 많습니다.')


def fetch_public(url):
    url=public_url(url)
    # Every target/redirect gets its own robots check; cookies, API keys and proxies are never used.
    for _ in range(4):
        parts=urlsplit(url);robots=urlunsplit(('https',parts.netloc,'/robots.txt','',''))
        status,_,body,_=_follow(robots)
        if status==200:
            rules=RobotFileParser();rules.parse(body.decode('utf-8','replace').splitlines())
            if not rules.can_fetch(AGENT,url):raise DataError('해당 채널의 robots 규칙이 자동 확인을 허용하지 않습니다.')
        elif status not in (404,410):raise DataError('채널의 자동 접근 규칙을 확인하지 못했습니다.')
        status,headers,body=_request(url)
        if status in (301,302,303,307,308):
            url=public_url(urljoin(url,headers.get('location','')));continue
        if status!=200:raise DataError(f'공개 채널이 HTTP {status}로 응답했습니다.')
        return {'url':url,'content_type':headers.get('content-type',''),'body':body}
    raise DataError('공개 주소 이동 횟수가 너무 많습니다.')
