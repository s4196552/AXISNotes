set -e
export PYTHONIOENCODING=utf-8
SK=~/.claude/skills/logo-design/scripts
for c in a-lambda b-origin c-own-axis; do
  d=kit/$c; b=$d/axis-$c; t="AXIS logo"
  python $SK/export_variants.py $b-symbol.svg --out-dir "${d:?}/digital" --title "$t" --only black white mono square favicon --mono "#16181D" --mono "#E4472B" --favicon-source $b-symbol-small.svg --png 64 512 1024 >/dev/null
  python $SK/export_variants.py $b-symbol-reversed.svg --out-dir "${d:?}/digital" --name axis-$c-app --title "$t" --only app-icon --icon-bg "#16181D" --icon-fg keep --png 1024 >/dev/null
  for l in horizontal stacked wordmark; do python $SK/export_variants.py $b-$l.svg --out-dir "${d:?}/digital" --title "$t" --only black white mono --mono "#16181D" --png 1200 >/dev/null; done
  python $SK/export_variants.py $b-symbol-small.svg --out-dir "${d:?}/web" --name axis-$c --title "$t" --web-icons --icon-bg "#16181D" --icon-fg keep >/dev/null
  python $SK/export_variants.py $b-symbol-small-reversed.svg --out-dir "${d:?}/tiles" --name axis-$c --title "$t" --web-icons --icon-bg "#16181D" --icon-fg keep >/dev/null
  cp "${d:?}"/tiles/{apple-touch-icon.png,icon-192.png,icon-512.png,maskable-512.png,axis-$c-app-icon.svg} "${d:?}/web/"
  rm -f "${d:?}"/tiles/*; rmdir "${d:?}/tiles"
  rm -f "${d:?}"/web/axis-$c-{black,white,square}.svg
  python -X utf8 -c "
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
s=s.replace('fill=\"#16181D\"','class=\"ink\" fill=\"#16181D\"').replace('<title>AXIS logo</title>','<title>AXIS logo</title><style>@media (prefers-color-scheme: dark){.ink{fill:#FFFFFF}}</style>',1)
open(p,'w',encoding='utf-8').write(s)" "$d/web/favicon.svg"
done
python -X utf8 $SK/presentation_board.py board-spec.json -o board.html --png-dir slides | tail -1
