#!/usr/bin/env python3
"""Builds public/shared/icons.js (inline SVG icon set from Material Design Icons, Apache-2.0)
and public/shared/fonts.css (subsetted Inter, embedded) so the app never depends on a CDN."""
import base64, io, json, os, sys, re
MDI = '/usr/local/lib/python3.12/dist-packages/material/templates/.icons/material'
ALIAS = {
 'book-2':'book-open-page-variant-outline','scale':'scale-balance','trending-up':'trending-up','calculator':'calculator-variant-outline','receipt-tax':'receipt-text-outline',
 'book':'book-open-variant','books':'bookshelf','school':'school-outline','crown':'crown-outline','lock':'lock-outline','lock-open':'lock-open-variant-outline',
 'chevron-left':'chevron-left','chevron-right':'chevron-right','chevron-down':'chevron-down','chevron-up':'chevron-up','heart':'heart-outline','heart-filled':'heart',
 'clock':'clock-outline','clock-plus':'clock-plus-outline','clock-x':'clock-remove-outline','player-play':'play','player-play-filled':'play','player-pause-filled':'pause','player-pause':'pause',
 'file-text':'file-document-outline','building':'domain','user':'account-outline','users':'account-group-outline','shield-check':'shield-check-outline','shopping-cart':'cart-outline',
 'send':'send-outline','check':'check','x':'close','flame':'fire','trophy':'trophy-outline','trophy-filled':'trophy','trophy-off':'trophy-broken','smart-home':'home-outline','home':'home-outline',
 'layout-grid':'view-grid-outline','speakerphone':'bullhorn-outline','files':'file-multiple-outline','receipt':'receipt-text-outline','shield-lock':'shield-lock-outline','list-details':'format-list-bulleted-square',
 'database':'database-outline','key':'key-variant','tags':'tag-multiple-outline','tag':'tag-outline','file-type-pdf':'file-pdf-box','photo':'image-outline','notes':'note-text-outline','link':'link-variant',
 'file':'file-outline','user-check':'account-check-outline','user-off':'account-off-outline','user-minus':'account-minus-outline','user-plus':'account-plus-outline','user-x':'account-remove-outline',
 'eraser':'eraser','trash':'delete-outline','restore':'restore','archive':'archive-outline','arrows-exchange':'swap-horizontal','arrow-back-up':'undo-variant','alert-circle':'alert-circle-outline',
 'alert-triangle':'alert-outline','ban':'cancel','book-off':'book-remove-outline','bolt':'flash-outline','chart-bar':'chart-bar','calendar':'calendar-month-outline','checkbox':'checkbox-marked-outline',
 'square':'checkbox-blank-outline','circle-filled':'circle','copy':'content-copy','download':'download-outline','edit':'pencil-outline','pencil':'pencil-outline','eye':'eye-outline','eye-off':'eye-off-outline',
 'flag':'flag-outline','headset':'headset','hourglass':'timer-sand','inbox':'inbox-outline','list':'format-list-bulleted','loader-2':'loading','logout':'logout','medal':'medal-outline',
 'message-circle':'message-text-outline','moon':'weather-night','palette':'palette-outline','plus':'plus','power':'power','refresh':'refresh','search':'magnify','settings':'cog-outline',
 'share':'share-variant-outline','stopwatch':'timer-outline','target':'target','upload':'upload-outline','wifi-off':'wifi-off','world':'earth','award':'trophy-award','arrow-down':'arrow-down',
 'arrow-right':'arrow-right','arrow-left':'arrow-left','arrow-up':'arrow-up','star':'star-outline','diamond':'diamond-stone','gift':'gift-outline','shield':'shield-outline','plant':'sprout-outline',
 'infinity':'infinity','rocket':'rocket-launch-outline','tv':'television-classic','sparkles':'creation','whatsapp':'whatsapp','bell':'bell-outline','ticket':'ticket-percent-outline',
 'circle-check':'check-circle-outline','clipboard':'clipboard-text-outline','video':'video-outline','play-circle':'play-circle-outline','rupee':'currency-inr','filter':'filter-variant','history':'history',
 'menu':'menu','dots':'dots-vertical','sort':'sort','sun':'white-balance-sunny','info':'information-outline','headphones':'headphones','repeat':'shuffle-variant','layers':'layers-outline',
 'bookmark':'bookmark-outline','playlist':'playlist-play','podium':'podium','folder':'folder-outline','folder-plus':'folder-plus-outline','file-plus':'file-plus-outline','drag':'drag-vertical','up':'arrow-up',
 'down':'arrow-down','building-bank':'bank-outline','map-pin':'map-marker-outline','bulb':'lightbulb-outline','dots-circle':'dots-horizontal-circle-outline','rotate':'rotate-right','cut':'content-cut',
 'external':'open-in-new','broadcast':'broadcast','cash':'cash-multiple','user-circle':'account-circle-outline','flag-3':'flag-variant-outline','calendar-event':'calendar-star',
 'calendar-off':'calendar-remove-outline','pin':'pin-outline','pinned':'pin','brand-telegram':'send-circle-outline','telegram':'send-circle-outline',
}
missing=[k for k,v in ALIAS.items() if not os.path.exists(f'{MDI}/{v}.svg')]
if missing: print('MISSING', {k:ALIAS[k] for k in missing}); sys.exit(1)
icons={}
for k,v in ALIAS.items():
    svg=open(f'{MDI}/{v}.svg').read(); m=re.search(r'<path d="([^"]+)"',svg); icons[k]=m.group(1)
open('public/shared/icons.js','w').write('/* Generated by tools/build-assets.py - Material Design Icons (Apache-2.0). */\nwindow.ICONS='+json.dumps(icons,separators=(',',':'))+';\n')
print('icons',len(icons))
from fontTools import subset
from fontTools.ttLib import TTFont
css=[]
U=list(range(0x20,0x7f))+list(range(0xa0,0x100))+[0x2013,0x2014,0x2018,0x2019,0x201c,0x201d,0x2022,0x2026,0x20b9,0x2192,0x2190,0x2191,0x2193,0x00b7,0x2713,0x25cf]
for w,name in [(400,'Regular'),(500,'Medium'),(600,'SemiBold'),(700,'Bold')]:
    f=TTFont(f'/usr/share/fonts/opentype/inter/Inter-{name}.otf'); o=subset.Options(); o.flavor='woff'; o.layout_features=['kern','liga','tnum']; o.name_IDs=[]; o.notdef_outline=True
    s=subset.Subsetter(o); s.populate(unicodes=U); s.subset(f); b=io.BytesIO(); f.flavor='woff'; f.save(b)
    css.append("@font-face{font-family:'Inter';font-weight:%d;font-style:normal;font-display:swap;src:url(data:font/woff;base64,%s) format('woff')}"%(w,base64.b64encode(b.getvalue()).decode()))
open('public/shared/fonts.css','w').write('\n'.join(css)+'\n')
print('fonts bytes',sum(len(c) for c in css))
