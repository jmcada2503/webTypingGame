# Word list build

Builds `src/words/en.json` and `src/words/es.json` (`{"short":[...],"medium":[...],"long":[...]}`,
each tier in frequency order). Recipe and source choice: `docs/research/word-lists.md` on branch
`research/word-lists` (issue #41). License and credits: `src/words/NOTICE.md`.

The JSON files are committed. Rebuild only when the recipe or a denylist changes, then run
`npm test`.

## Rebuild

Raw inputs stay outside the repo:

```sh
RAW=/some/tmp/dir
mkdir -p $RAW/dict-en $RAW/dict-es $RAW/bad
D=https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries
L=https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master
for l in en es; do
  curl -sfL -o $RAW/dict-$l/index.dic $D/$l/index.dic
  curl -sfL -o $RAW/dict-$l/index.aff $D/$l/index.aff
  curl -sfL -o $RAW/bad/$l $L/$l
done
python3 -m venv $RAW/venv && $RAW/venv/bin/pip install wordfreq==3.1.1
$RAW/venv/bin/python -I scripts/wordlists/build_wordlists.py --raw $RAW
```

It prints word counts per tier and how many words each filter dropped.

## Denylists

`denylist/en.txt` and `denylist/es.txt`: one word per line, `#` for comments. Use them for
anything the automatic filters miss (names, abbreviations, crude words). Unaccented Spanish
typos (`linea` for `línea`) are dropped by a build rule, so they don't go here.
