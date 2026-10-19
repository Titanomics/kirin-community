"""Manually recorded public campaign locations and contract follow-up dates."""
import math
from datetime import date
from .loader import DataError


def coordinate(value,label,limit):
    if value is None or isinstance(value,str) and not value.strip():return None
    try:
        if type(value) not in (str,int,float):raise ValueError
        number=float(value)
        if not math.isfinite(number) or not -limit<=number<=limit:raise ValueError
        return number
    except (ValueError,TypeError,OverflowError):raise DataError(f'{label} 좌표 범위를 확인해 주세요.') from None


def prepare_location(data):
    from .marketing import text
    result={key:text(data.get(key),label,limit) or None for key,label,limit in [('location_name','집행 장소',150),('location_address','집행 주소',500),('location_source','위치 확인 근거',1000),('contract_reference','계약 식별·근거',1000)]}
    result['latitude']=coordinate(data.get('latitude'),'위도',85)
    result['longitude']=coordinate(data.get('longitude'),'경도',180)
    if (result['latitude'] is None)!=(result['longitude'] is None):raise DataError('집행 위치의 위도와 경도를 함께 입력해 주세요.')
    if result['latitude'] is not None and (not result['location_name'] or not result['location_source']):raise DataError('지도 표시에 필요한 집행 장소와 위치 확인 근거를 입력해 주세요.')
    renewal=text(data.get('renewal_on'),'갱신 확인일',10)
    try:result['renewal_on']=date.fromisoformat(renewal).isoformat() if renewal else None
    except ValueError:raise DataError('갱신 확인일을 확인해 주세요.') from None
    return result
