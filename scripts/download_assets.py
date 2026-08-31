import json, io, os, urllib.request, time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(BASE, "data", "cards_raw.json")
IMG_DIR = os.path.join(BASE, "images", "cards")
ICON_DIR = os.path.join(BASE, "images", "icons")

os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(ICON_DIR, exist_ok=True)

with io.open(DATA_PATH, encoding="utf-8") as f:
    cards = json.load(f)

headers = {"User-Agent": "Mozilla/5.0 (deck-builder personal tool)"}

def fetch(url, dest):
    if os.path.exists(dest):
        return "skip"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)
    return "ok"

# download card thumbnails
ok, skip, fail = 0, 0, 0
for c in cards:
    filename = c["filename"]
    stem = filename[:-4]  # strip .png
    thumb_url = f"http://nivelarena.jp/data/file/cardlists/thumb-{stem}_225x315.png"
    dest = os.path.join(IMG_DIR, f"{c['wr_id']}.png")
    try:
        r = fetch(thumb_url, dest)
        if r == "ok":
            ok += 1
        else:
            skip += 1
    except Exception as e:
        fail += 1
        print("FAIL", card_no, e)
    time.sleep(0.05)

print(f"cards: ok={ok} skip={skip} fail={fail}")

# collect + download icons referenced in effectHtml
import re
icon_urls = set()
for c in cards:
    for m in re.finditer(r'src="([^"]+)"', c.get("effectHtml", "")):
        src = m.group(1)
        if src.startswith("/"):
            src = "http://nivelarena.jp" + src
        icon_urls.add(src)

iok, iskip, ifail = 0, 0, 0
for url in icon_urls:
    name = url.rsplit("/", 1)[-1]
    dest = os.path.join(ICON_DIR, name)
    try:
        r = fetch(url, dest)
        if r == "ok":
            iok += 1
        else:
            iskip += 1
    except Exception as e:
        ifail += 1
        print("FAIL ICON", url, e)

print(f"icons: ok={iok} skip={iskip} fail={ifail} total={len(icon_urls)}")
