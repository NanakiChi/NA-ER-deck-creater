import json, io, os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "data", "cards_raw.json")
DST = os.path.join(BASE, "data", "cards.json")

with io.open(SRC, encoding="utf-8") as f:
    raw = json.load(f)

def fix_effect_html(html):
    def repl(m):
        src = m.group(1)
        if src.startswith("/"):
            src = "http://nivelarena.jp" + src
        name = src.rsplit("/", 1)[-1]
        return m.group(0).replace(m.group(1), f"images/icons/{name}")
    return re.sub(r'src="([^"]+)"', repl, html)

def has_trigger_ability(html):
    # "triger_box" (sic) marks an actual triggered ability. Cards that merely
    # *reference* the trigger icon (e.g. "cards without [trigger]") contain the
    # icon image but not this wrapper, so a plain "ico_trigger" substring check
    # over-counts them.
    return "triger_box" in html

def to_int_or_none(v):
    v = (v or "").strip()
    if v in ("", "-"):
        return None
    try:
        return int(v)
    except ValueError:
        return v

cards = []
for c in raw:
    effect_html = fix_effect_html(c.get("effectHtml", ""))
    cards.append({
        "id": c["wr_id"],
        "cardNo": c["cardNo"],
        "name": c["name"],
        "cardType": c["cardType"],       # リーダー/ユニット/スキル/アイテム
        "attribute": c["attribute"],     # 炎/大地/嵐/波濤/稲妻
        "cost": to_int_or_none(c["cost"]),
        "rarity": c["rarity"],
        "power": to_int_or_none(c["power"]),
        "hit": to_int_or_none(c["hit"]),
        "affiliation": c["affiliation"],
        "keyword": c["keyword"],
        "effectHtml": effect_html,
        "productName": c["productName"],
        "maxCopies": 3,  # same identification number (cardNo): always max 3
        "hasTrigger": has_trigger_ability(c.get("effectHtml", "")),  # deck-wide cap of 8, separate from maxCopies
        "image": f"images/cards/{c['wr_id']}.png",
    })

# sort: cardNo asc for stable browsing
def sort_key(c):
    return (c["cardNo"], c["id"])
cards.sort(key=sort_key)

with io.open(DST, "w", encoding="utf-8") as f:
    json.dump(cards, f, ensure_ascii=False, indent=2)

print("wrote", len(cards), "cards to", DST)

# sanity: group by cardNo, check maxCopies consistent within group
from collections import defaultdict
groups = defaultdict(list)
for c in cards:
    groups[c["cardNo"]].append(c)
inconsistent = [k for k, v in groups.items() if len(set(x["maxCopies"] for x in v)) > 1]
print("cardNo groups:", len(groups), "inconsistent maxCopies groups:", inconsistent)
inconsistent_trigger = [k for k, v in groups.items() if len(set(x["hasTrigger"] for x in v)) > 1]
print("inconsistent hasTrigger groups:", inconsistent_trigger)
trigger_cards = sorted(set(c["cardNo"] for c in cards if c["hasTrigger"]))
print("trigger cardNo count:", len(trigger_cards), trigger_cards)
