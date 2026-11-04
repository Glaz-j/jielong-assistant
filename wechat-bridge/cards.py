"""Parse only the authorized service's mini-program card; never execute content."""
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, parse_qs
APPID = 'wx36ddf2a92cbb7814'
APP_USERNAME = 'gh_746ce96d7d09@app'

def parse_card(content):
    if not isinstance(content, str) or len(content) > 500000:
        return None
    if '<!DOCTYPE' in content.upper() or '<!ENTITY' in content.upper():
        return None
    try:
        root = ET.fromstring(content)
    except (ET.ParseError, ValueError):
        return None
    msg = root if root.tag == 'appmsg' else root.find('./appmsg')
    if msg is None or msg.findtext('type') not in ('33', '36'):
        return None
    infos = msg.findall('weappinfo')
    if len(infos) != 1:
        return None
    info=infos[0]
    if len(info.findall('appid'))>1 or len(info.findall('username'))>1:return None
    appid=info.findtext('appid','').strip();username=info.findtext('username','').strip()
    # Current Windows 4.1 cards leave appid empty. The immutable original ID
    # is verified against the same service in the supplied requirements card.
    if appid and appid!=APPID:return None
    if username and username!=APP_USERNAME:return None
    if not(appid==APPID or username==APP_USERNAME):return None
    page = infos[0].findtext('pagepath', '')
    if len(page) > 4096:
        return None
    u = urlsplit(page)
    if u.scheme or u.netloc or u.fragment:
        return None
    match = re.fullmatch(r'/?(form|event)/pages/(detail|formdetail)/index(?:\.html)?', u.path)
    if not match:
        return None
    if match[1]=='event' and match[2]!='detail':return None
    params = parse_qs(u.query)
    ids = params.get('threadId', [])
    if len(ids) != 1 or not re.fullmatch('[A-Za-z0-9]{6,32}', ids[0]):
        return None
    kind = 'f' if match[1] == 'form' else 'e'
    return {'id': ids[0], 'url': f'https://i.jielong.com/{kind}/{ids[0]}'}
