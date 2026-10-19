"""Conservative address-to-polygon matching; no network/geocoding calls."""
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / 'static' / 'data'
PROVINCES = {
    '서울특별시':['서울','서울시','서울특별시'],
    '부산광역시':['부산','부산시','부산광역시'],
    '대구광역시':['대구','대구시','대구광역시'],
    '인천광역시':['인천','인천시','인천광역시'],
    '광주광역시':['광주','광주시','광주광역시'],
    '대전광역시':['대전','대전시','대전광역시'],
    '울산광역시':['울산','울산시','울산광역시'],
    '세종특별자치시':['세종','세종시','세종특별자치시'],
    '경기도':['경기','경기도'],
    '강원특별자치도':['강원','강원도','강원특별자치도'],
    '충청북도':['충북','충청북도'], '충청남도':['충남','충청남도'],
    '전라북도':['전북','전라북도','전북특별자치도'],
    '전라남도':['전남','전라남도'], '경상북도':['경북','경상북도'],
    '경상남도':['경남','경상남도'], '제주특별자치도':['제주','제주도','제주특별자치도'],
}


class RegionIndex:
    def __init__(self, data_dir=DATA_DIR, road_path=None):
        self.features = {}
        self.names = {}
        self.districts = defaultdict(list)
        self.dongs = defaultdict(list)
        for level in ('sig','emd'):
            doc=json.loads((data_dir/f'{level}.geojson').read_text(encoding='utf-8'))
            self.features[level]=doc['features']
            self.names[level]={}
            for feature in doc['features']:
                p=feature['properties']; code=p['SIG_CD'] if level=='sig' else p['EMD_CD']
                self.names[level][code]=p['FULL_NM']
                if level=='sig': self.districts[p['SIDO_NM']].append((p['SIG_KOR_NM'],code))
                else: self.dongs[p['SIG_CD']].append((p['EMD_KOR_NM'],code))
        self.provenance=json.loads((data_dir/'provenance.json').read_text(encoding='utf-8'))
        from .road_addresses import RoadLookup
        self.roads=RoadLookup(road_path)
        self.address_source=self.roads.metadata

    def refresh(self):
        fingerprint=self.roads.refresh();self.address_source=self.roads.metadata
        return fingerprint

    def _parent_candidates(self,parents,text):
        candidates=[]
        for name,code in parents:
            match=re.match(r'\s*'.join(map(re.escape,name.split())),text)
            if not match:continue
            suffix=text[match.end():]
            if suffix and not suffix[0].isspace():
                legal=any(re.match(re.escape(dong)+r'(?=$|[\s,\d(])',suffix) for dong,_ in self.dongs[code])
                road_start=re.match(r'[가-힣A-Za-z0-9·.]+(?:대로|로|길)\s*(?:지하\s*)?\d',suffix)
                if not legal and not road_start:continue
            candidates.append((len(name.replace(' ','')),code,suffix.lstrip()))
        return candidates

    def match(self,address):
        result={'sig':None,'emd':None,'address_present':bool(str(address or '').strip()),'method':None,'reason':'no_address'}
        if not result['address_present']:return result
        text=unicodedata.normalize('NFKC',str(address)).strip()
        text=re.sub(r'^\s*[\[(]?\s*(?:\d{3}-\d{3}|\d{5,6})\s*[\])]?\s*','',text)
        text=re.sub(r'\s+',' ',text)
        text=re.sub(r'(?<=\d)\s*-\s*(?=\d)','-',text)
        province=None;rest=text
        for alias,p in sorted(((alias,p) for p,aliases in PROVINCES.items() for alias in aliases),key=lambda x:len(x[0]),reverse=True):
            if text.startswith(alias):province=p;rest=text[len(alias):].lstrip();break
        # Some boundary sources retain the older provincial name.
        if province=='강원특별자치도' and province not in self.districts:province='강원도'
        result['reason']='unknown_parent'
        all_parents=[item for items in self.districts.values() for item in items]
        candidates=self._parent_candidates(self.districts.get(province,[]) if province else all_parents,rest)
        if province=='세종특별자치시' and len(self.districts[province])==1:
            candidates=[(1,self.districts[province][0][1],rest)]
        # 광주시/제주시/부산진구 can begin with a province alias. Retry the full
        # official district name only when the explicit province parse found none.
        if not candidates and province:candidates=self._parent_candidates(all_parents,text)
        if not candidates:return result
        longest=max(x[0] for x in candidates)
        codes={c for n,c,_ in candidates if n==longest}
        if len(codes)!=1:return result
        result['sig']=codes.pop()
        rest=next(t for n,c,t in candidates if n==longest and c==result['sig'])
        result['reason']='no_legal_dong'
        # Exact tokens only: 역삼1동 is not silently converted to 법정동 역삼동.
        dong_codes={code for name,code in self.dongs[result['sig']] if re.search(r'(?:^|[\s,(\[])'+re.escape(name)+r'(?=$|[\s,\])\d])',rest)}
        if len(dong_codes)>1:result['reason']='ambiguous_dong';return result
        road=re.match(r'([가-힣A-Za-z0-9·.]+(?:대로|로|길))\s*(지하)?\s*(\d+)(?:-(\d+))?(?!\s*-)(?=$|[\s,(])',rest)
        road_codes=set()
        if road:
            name,basement,main,sub=road.groups()
            road_codes=self.roads.lookup(result['sig'],name,int(bool(basement)),int(main),int(sub or 0))
            if road_codes and dong_codes and not dong_codes.issubset(road_codes):result['reason']='conflicting_evidence';return result
        if dong_codes:
            result.update(emd=dong_codes.pop(),method='explicit_legal_dong',reason='matched')
        elif len(road_codes)==1:
            result.update(emd=road_codes.pop(),method='road_building',reason='matched')
        elif road:
            result['reason']='ambiguous_road' if road_codes else 'road_not_found' if self.roads.covers(result['sig']) else 'road_reference_unavailable'
        return result

    def public_geojson(self,level):
        if level not in ('sig','emd'):raise ValueError('지원하지 않는 지도 단위입니다.')
        # Only public administrative geometry; no patient attributes.
        return {'type':'FeatureCollection','features':self.features[level]}
