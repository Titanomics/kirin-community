"""Bounded local advertising files with explicit, auditable column mapping."""
import csv
import hashlib
import io
import re
import zipfile
from datetime import date,datetime
from decimal import Decimal,InvalidOperation
from pathlib import Path
import openpyxl
from .loader import DataError
from .knowledge import today
from .conversions import opaque

HEADERS={'일자':'date','캠페인ID':'campaign_id','노출수':'impressions','클릭수':'clicks','매체보고전환수':'conversions','매체보고광고비':'spend','지출장부ID':'expense_id'}
METRICS={'date','impressions','clicks','conversions','spend'}
MAX_BYTES=5*1024*1024


def read_table(filename,data,header_row=1):
    if not isinstance(data,bytes) or not 0<len(data)<=MAX_BYTES:raise DataError('광고 보고서는 5MB 이하 CSV 또는 XLSX로 올려 주세요.')
    if type(header_row)!=int or not 1<=header_row<=30:raise DataError('열 제목 행은 1~30 사이로 선택해 주세요.')
    book=None
    try:
        ext=Path(str(filename)).suffix.lower()
        if ext=='.csv':
            try:decoded=data.decode('utf-8-sig')
            except UnicodeDecodeError:decoded=data.decode('cp949')
            rows=csv.reader(io.StringIO(decoded),strict=True)
        elif ext=='.xlsx':
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries=archive.infolist()
                if len(entries)>1000 or sum(e.file_size for e in entries)>50*1024*1024:raise ValueError
                for e in entries:
                    if e.flag_bits&1 or e.filename.endswith('vbaProject.bin'):raise ValueError
                    if e.filename.endswith(('.xml','.rels')):
                        content=archive.read(e).upper()
                        if b'<!DOCTYPE' in content or b'<!ENTITY' in content:raise ValueError
            book=openpyxl.load_workbook(io.BytesIO(data),read_only=True,data_only=False,keep_links=False)
            if len(book.worksheets)!=1:raise ValueError
            # Producer-written dimensions can omit real cells. Iterate actual
            # XML rows and enforce our own row/column limits below.
            book.worksheets[0].reset_dimensions()
            rows=book.worksheets[0].iter_rows(values_only=True)
        else:raise ValueError
        for _ in range(header_row-1):next(rows,None)
        headers=[str(v if v is not None else '').strip() for v in next(rows,[])]
        if not 1<=len(headers)<=100 or not any(headers) or any(len(h)>200 or h.startswith('=') for h in headers):raise DataError('100개 이하의 열 제목을 확인해 주세요. 제목은 200자 이내여야 합니다.')
        result=[]
        for line,values in enumerate(rows,header_row+1):
            if line>header_row+25000:raise DataError('한 번에 제목 아래 25,000행 이하로 올려 주세요.')
            if not any(v is not None and str(v).strip() for v in values):continue
            if len(values)>len(headers):raise DataError(f'{line}행의 열 개수가 제목과 다릅니다.')
            result.append((line,list(values)+[None]*(len(headers)-len(values))))
        if not result:raise DataError('입력된 일별 보고 수치가 없습니다.')
        return headers,result
    except DataError:raise
    except Exception:raise DataError('암호 없는 단일 시트 XLSX 또는 UTF-8/CP949 CSV를 사용해 주세요.') from None
    finally:
        if book:book.close()


def column_index(value,width):
    if type(value)!=int or not 0<=value<width:raise DataError('파일에 있는 열을 선택해 주세요.')
    return value


def campaign_values(rows,column):
    values=set()
    for line,row in rows:
        value=str(row[column] if row[column] is not None else '').strip()
        if not value or len(value)>200 or value.startswith('='):raise DataError(f'{line}행의 원본 캠페인 값을 확인해 주세요.')
        values.add(value)
        if len(values)>100:raise DataError('한 번에 원본 캠페인 100개 이하로 올려 주세요.')
    return sorted(values)


def inspect_upload(filename,data,*,header_row=1,campaign_column=None):
    headers,rows=read_table(filename,data,header_row)
    result={'header_row':header_row,'columns':[{'index':i,'label':h or '빈 제목'} for i,h in enumerate(headers)],'row_count':len(rows),'sha256':hashlib.sha256(data).hexdigest()}
    if campaign_column is not None:result['campaign_values']=campaign_values(rows,column_index(campaign_column,len(headers)))
    return result


def mapped_rows(headers,rows,mapping):
    allowed={'header_row','columns','date_format','campaign_column','campaign_bindings','campaign_id','single_campaign_confirmed','expense_id'}
    if set(mapping)!=allowed or not isinstance(mapping['columns'],dict) or set(mapping['columns'])!=METRICS:raise DataError('필수 열과 캠페인 연결 설정을 확인해 주세요.')
    columns={k:column_index(v,len(headers)) for k,v in mapping['columns'].items()}
    if len(set(columns.values()))!=len(columns):raise DataError('일자·수치마다 서로 다른 열을 선택해 주세요.')
    formats={'iso':'-','dot':'.','slash':'/'}
    if not isinstance(mapping['date_format'],str) or mapping['date_format'] not in formats:raise DataError('날짜 표기 형식을 선택해 주세요.')
    bindings=mapping['campaign_bindings'];campaign_column=mapping['campaign_column']
    if not isinstance(bindings,dict):raise DataError('원본 캠페인 연결을 확인해 주세요.')
    try:
        expense=opaque(mapping['expense_id']) if mapping['expense_id'] else None
        if campaign_column is None:
            if mapping['single_campaign_confirmed'] is not True or bindings:raise ValueError
            fixed=opaque(mapping['campaign_id'])
        else:
            column_index(campaign_column,len(headers))
            if campaign_column in columns.values() or mapping['campaign_id'] is not None:raise ValueError
            values=campaign_values(rows,campaign_column)
            if set(bindings)!=set(values):raise DataError('파일에 있는 모든 캠페인을 연결해 주세요. 행은 임의로 제외하지 않습니다.')
            bindings={k:opaque(v) for k,v in bindings.items()}
    except (ValueError,TypeError,AttributeError):raise DataError('병원 캠페인을 선택하고 단일 캠페인 여부를 확인해 주세요.') from None
    result=[]
    for line,values in rows:
        try:
            row={key:values[index] for key,index in columns.items()}
            rawday=row['date']
            if isinstance(rawday,datetime):stamp=rawday.date().isoformat()
            elif isinstance(rawday,date):stamp=rawday.isoformat()
            else:
                value=str(rawday).strip();separator=formats[mapping['date_format']]
                if not re.fullmatch(r'[0-9]{4}'+re.escape(separator)+r'[0-9]{2}'+re.escape(separator)+r'[0-9]{2}',value):raise ValueError
                stamp=value.replace(separator,'-')
            row['date']=stamp
            for key in METRICS-{'date'}:
                value=str(row[key]).strip()
                if isinstance(row[key],bool) or not re.fullmatch(r'(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,3})?',value):raise ValueError
                value=value.replace(',','');number=Decimal(value)
                if key!='conversions':
                    if number!=number.to_integral_value():raise ValueError
                    value=str(int(number))
                row[key]=value
            row['campaign_id']=fixed if campaign_column is None else bindings[str(values[campaign_column]).strip()]
            row['expense_id']=expense
            result.append((line,row))
        except (ValueError,TypeError,InvalidOperation):raise DataError(f'{line}행의 날짜 형식·수치를 확인해 주세요. 빈칸·수식·통화기호·요약 행은 반영하지 않습니다.') from None
    return result


def parse_upload(filename,data,mapping=None):
    if mapping is not None and not isinstance(mapping,dict):raise DataError('열 연결 설정을 확인해 주세요.')
    headers,source=read_table(filename,data,mapping.get('header_row') if mapping is not None else 1)
    if mapping is None:
        if len(headers)!=7 or set(headers)!=set(HEADERS):raise DataError('표준 7개 열을 사용하거나 원본 열 직접 연결을 선택해 주세요.')
        rows=[(line,{HEADERS[h]:v for h,v in zip(headers,values)}) for line,values in source]
    else:rows=mapped_rows(headers,source,mapping)
    result=[];seen=set()
    for line,row in rows:
        try:
            rawday=row['date'];stamp=rawday.date().isoformat() if isinstance(rawday,datetime) else str(rawday).strip()
            row['date']=date.fromisoformat(stamp).isoformat()
            if row['date']>today() or row['date']<'2000-01-01':raise ValueError
            row['campaign_id']=opaque(row['campaign_id']);row['expense_id']=opaque(row['expense_id']) if row['expense_id'] else None
            key=(row['date'],row['campaign_id'])
            if key in seen:raise DataError(f'{line}행의 일자·캠페인이 중복됩니다. 일별 캠페인 합계 자료를 사용해 주세요. 자동 합산하지 않습니다.')
            for k in ('impressions','clicks','spend'):
                val=row[k]
                if isinstance(val,bool) or not str(val).strip().isdigit():raise ValueError
                row[k]=int(val)
                if not 0<=row[k]<=10**12:raise ValueError
            value=str(row['conversions']).strip()
            if len(value)>30:raise ValueError
            conv=Decimal(value)
            if not conv.is_finite() or conv<0 or conv>10**12 or conv.as_tuple().exponent < -3:raise ValueError
            row['conversions']=format(conv.normalize(),'f') if conv else '0';seen.add(key);result.append(row)
        except (ValueError,TypeError,InvalidOperation,AttributeError):raise DataError(f'{line}행의 일자·ID·수치를 확인해 주세요. 빈 수치는 0으로 바꾸지 않으며 전환은 소수 3자리까지 받습니다.') from None
    return result
