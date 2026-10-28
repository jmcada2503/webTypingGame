# Research: Word lists (English + Spanish)

Resolves issue #41 (map #38). Script: [`word-lists/build_wordlists.py`](word-lists/build_wordlists.py) (throwaway). Samples and raw counts: [`word-lists/samples/`](word-lists/samples/).

## TL;DR

- **Source (both languages): [`wordfreq`](https://github.com/rspeer/wordfreq) 3.1.1 frequency ranking**, filtered through a Hunspell dictionary. Multi-source (subtitles, Wikipedia, news, books, web, Twitter, Reddit), so far less subtitle-slang than a subtitles-only list.
- **License:** wordfreq code Apache-2.0; wordfreq **data CC BY-SA 4.0** (plus attribution terms of its sources). A list derived from it should be shipped with attribution and under CC BY-SA 4.0 (code stays separate). Not legal advice. See [Licenses](#licenses).
- **Recommended cut: zipf >= 3.5** (roughly the 3.2-per-million-words mark). Counts after all filters:

| | short 2-4 | medium 5-7 | long 8-20 | total |
|---|---:|---:|---:|---:|
| English | 1,395 | 5,218 | 4,982 | **11,595** |
| Spanish | 939 | 6,062 | 7,187 | **14,188** |

- Spanish: **2,605 of 14,188 (18.4%)** words need an accent/`ñ`/`ü`; they make up ~9% of running-text occurrences. `ñ`: 172 words (1.2%). `ü`: 7 words. Accent-free fallback pool: 791 / 4,940 / 5,852 (11,583).
- Size: JSON ~130 KB (EN) / ~170 KB (ES) raw, ~44 KB / ~54 KB gzipped. Fine to ship to the browser for Practice and to bundle in the Lambda for Attack words.
- The terminal version's list is **not** English at all: it is an 86k-word Spanish dictionary with accents stripped (and some mojibake like `chafarra\o`), no frequency ranking. Samples: `capellania`, `tridentifero`, `palacrana`, `supererogatorio`, `onecer`. Only 40.8% of the new Spanish list occurs in it (because it has no accents), and 4.3% of the new English list.

## Candidate sources

| Source | Langs | Ranking basis | License (data) | Verdict |
|---|---|---|---|---|
| **wordfreq** (Robyn Speer) | EN, ES (+40) | Merge of OpenSubtitles, SUBTLEX, Wikipedia, Leeds, ParaCrawl, Google Books, news, Reddit, Twitter; outliers dropped | CC BY-SA 4.0 (+ per-source attribution, see its `NOTICE.md`); code Apache-2.0 | **Chosen.** Cleanest ranking; pip package, deterministic. Caveat: project is unmaintained since ~2024 (data snapshot ~2021), irrelevant for a frozen list. |
| hermitdave/FrequencyWords (OpenSubtitles 2018) | EN, ES, many | Subtitles only (50k + full lists) | CC BY-SA 4.0 for content, MIT for code (README) | Good fallback / cross-check. More spoken slang, interjections, names, typos. 99.4% (EN) / 95.8% (ES) of our final lists appear in its top 50k, so the two sources agree. |
| Peter Norvig `count_1w.txt` (Google Web Trillion Word Corpus, 333k) | EN only | Web text | Page only states MIT for the *code*; corpus is distributed by LDC, data terms unclear | Rejected: English only, license unclear, lots of typos/URLs. |
| Wiktionary frequency lists | EN, ES (small) | Mixed corpora (TV, Gutenberg) | CC BY-SA | Rejected: short, uneven, not maintained per language. |
| RAE CREA / CORPES frequency lists | ES | Curated corpus | Not open for redistribution | Rejected on license. |
| Hunspell dictionaries ([wooorm/dictionaries](https://github.com/wooorm/dictionaries)) | EN (SCOWL en_US), ES (LibreOffice es) | None (validator only) | EN: SCOWL permissive (MIT/BSD-like/public domain mix); ES: GPL-3+ / LGPL-3+ / MPL-1.1+ (pick one) | Used only as a **validity filter**: a ranked word is kept iff it is a lowercase form in the dictionary. |
| LDNOOBW bad words (en 403, es 68 entries) | EN, ES | n/a | CC BY 4.0 | Used as a profanity denylist (single words), plus own stem list. |

## Filtering recipe (implemented in the script)

Per language, scanning wordfreq's rank order:

1. **NFC** normalise, lowercase.
2. **Typeable only:** EN `a-z`; ES `a-z` + `áéíóúüñ`. Drops digits, punctuation, apostrophes (so no `don't`, `it's`), other scripts, emoji.
3. **Length 2-20** (1-letter words dropped). 2-letter words only from a short whitelist (`of to in is it...`, `de la el en...`) because Hunspell accepts many 2-letter abbreviations.
4. **Must be a lowercase form in the Hunspell dictionary** (affixes expanded: ~124k EN, ~656k ES forms). This removes proper nouns (dictionary stores them capitalised), typos, slang, foreign words, most abbreviations. Biggest single filter: 2,156 EN / 2,024 ES candidates dropped.
5. **Also-a-proper-noun drop:** if the capitalised form also exists in the dictionary (`john`, `china`, `march`, `trump`, `google`) the word is dropped, except for the top 250 ranks (`will`, `may`, `can`, `house`...). 725 EN / 141 ES.
6. **Mostly-other-language drop:** word's zipf in the other language is >= 0.8 higher (removes English loanwords in the ES list like `show`, `time`, `film`, and vice versa).
7. **Abbreviation/junk:** no vowel, 3+ identical letters in a row, hand list of ~100 leftovers (`vol`, `ted`, `nah`, `dept`, `núm`, `pág`...).
8. **Profanity / sexual / slurs / drugs / violence:** LDNOOBW single words + prefix stems + a few substrings (`sexual`, `porn`, `prostitu`...) + a few exact-only words (to avoid blocking `cacahuete`, `pajaro`, `cockpit`). ~100 EN / ~120 ES removed. Deliberately conservative (also drops `kill*`, `murder*`, `asesin*`).
9. **Duplicates** removed after NFC (wordfreq is already unique; this guards merges).
10. **Tier split:** short 2-4, medium 5-7, long 8-20; cut by `--min-zipf`.

Inflections and conjugations are kept (needed in Spanish: `hablaron`, `dijeron`). Matching is exact, so `tambien` is not accepted for `también`.

Reproduce (raw data lives outside the repo):

```
python3 -m venv venv && venv/bin/pip install wordfreq
# raw/dict-en, raw/dict-es  <- wooorm/dictionaries/dictionaries/{en,es}/index.{dic,aff}
# raw/bad/{en,es}           <- LDNOOBW
venv/bin/python -I docs/research/word-lists/build_wordlists.py --raw RAW --out OUT --min-zipf 3.5
```

Output: `OUT/{en,es}.json` (`{"short":[...],"medium":[...],"long":[...]}`, each in frequency order), samples, `report.json`.

## Counts

By frequency cutoff (zipf = log10 of occurrences per billion words; 4.0 = 1 per 100k, 3.5 = 3.2 per 1M, 3.0 = 1 per 1M):

| zipf >= | EN short | EN medium | EN long | EN total | ES short | ES medium | ES long | ES total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 5.0 | 352 | 443 | 122 | 917 | 224 | 439 | 147 | 810 |
| 4.5 | 585 | 1,323 | 635 | 2,543 | 382 | 1,318 | 773 | 2,473 |
| 4.0 | 911 | 2,863 | 2,056 | 5,830 | 614 | 3,115 | 2,743 | 6,472 |
| **3.5** | **1,395** | **5,218** | **4,982** | **11,595** | **939** | **6,062** | **7,187** | **14,188** |
| 3.0 | 1,989 | 8,837 | 10,042 | 20,868 | 1,379 | 10,615 | 15,943 | 27,937 |

Variety: even a 10-minute endless Practice at 100 WPM is ~1,000 words, so 4.0 (5.8k / 6.5k) already never repeats noticeably; 3.5 is the recommended default and 3.0 is available if long words need more pool. Short Spanish is the thinnest tier (939; 614 at zipf 4.0) because Spanish words are longer on average; still ample for random pick, and it matters most early in a Match.

Candidate pipeline at zipf >= 3.5 (words scanned, then dropped by stage): EN 15,090 scanned: 266 not typeable, 26 bad length, 2,156 not in dictionary, 725 also proper noun, 34 other language, 187 junk, 100 profanity. ES 16,741 scanned: 61 not typeable, 28 length, 2,024 not in dictionary, 141 also proper noun, 66 other language, 109 junk, 123 profanity.

## Samples (random, from the 3.5 build)

**EN short:** apps, bail, bans, bat, bear, bed, blow, cues, does, eggs, flew, gala
**EN medium:** blame, booklet, brook, commute, default, delight, diaries, fight, focused, fuels, funding, genes
**EN long:** anticipation, appointment, backwards, borrowing, contrast, conversion, described, emphasized, evaluating, highlighting, inevitably
**EN most common:** the to and of in is for you it on / about their there which would people / something different government business anything

**ES short:** amor, aun, año, bits, bota, chef, comí, dice, filo, foto, hizo, jura
**ES medium:** amplias, barcos, caderas, ciega, cordial, dormía, electos, emblema
**ES long:** apuestas, aquellas, ayudamos, bilateral, bolsillo, búsquedas, comercial, compensar, criterios, diferencias, dirigente, dominación
**ES with accent/ñ:** aclaración, actúa, adición, análisis, aspiración, circulación, clínicas, comenzará, conducía, cuántos, dañar, desempeño, llevará
**ES most common:** de la que el en los no un se por / cuando sobre también todos tiene porque / personas gobierno nacional historia mientras

More in `word-lists/samples/{en,es}.sample.json`.

## Spanish accents on common keyboards

At zipf >= 3.5 (14,188 words):

| | words | % of list |
|---|---:|---:|
| any accent / `ñ` / `ü` | 2,605 | 18.4% |
| by tier: short / medium / long | 148 / 1,122 / 1,335 | 15.8% / 18.5% / 18.6% |
| `ó` | 1,090 | 7.7% |
| `í` | 620 | 4.4% |
| `á` | 398 | 2.8% |
| `é` | 259 | 1.8% |
| `ñ` | 172 | 1.2% |
| `ú` | 73 | 0.5% |
| `ü` | 7 | 0.05% |

- Weighted by real usage, accent words are only ~9% of running text (the commonest words `de la que el en` are unaccented), which is why the type-count share (18%) overstates the load.
- Spanish/LatAm layouts type `á é í ó ú ñ` directly or with one dead-key; US layout needs US-International dead keys, Alt codes, or macOS long-press. Players picking Spanish presumably have a suitable layout, but ES-learners on a US keyboard will find `ñ` and `ó`-endings (`-ción` is the biggest group) painful.
- **Recommendation:** keep accents in the default Spanish pool (matching is already exact per map notes). Optionally add a menu toggle "no accents" that filters at load time: pool becomes 791 short / 4,940 medium / 5,852 long (11,583), no second file needed. Drop the 7 `ü` words (`pingüino`-style) from the default pool; nobody can type them without a dead key combo.
- **Implementation risk to test:** dead-key input fires `keydown` with `key: "Dead"`, then the composed char; the typing handler must match on the final composed character (`beforeinput`/`input` or the keydown after composition), not on the first `keydown`. Verify in a Playwright test on Chromium/Firefox/Safari with an ES layout.

## Licenses

- **wordfreq data CC BY-SA 4.0**: attribution to Robyn Speer (name must be "Robyn Speer" per its NOTICE) and source credits (OpenSubtitles, SUBTLEX authors incl. "freely available data", Leeds, Wikipedia, ParaCrawl, Google Books Ngram link). **ShareAlike:** a filtered/reordered derivative of the wordlist must be offered under CC BY-SA 4.0. Practical plan: put the generated lists in their own files (`words/en.json`, `words/es.json`) with a `NOTICE`/LICENSE note, link it on a credits screen; game code keeps its own license. A plain word list is thin as a work and the two uses are separable (collection vs program), but if the project wants zero ambiguity, ask for legal advice.
- hermitdave/FrequencyWords is also CC BY-SA 4.0 (content), so swapping to it changes nothing license-wise.
- Hunspell dictionaries used only as a validator; the lists contain no dictionary data beyond membership. EN SCOWL is permissive; ES is GPL/LGPL/MPL tri-licensed (choose MPL/LGPL to be safe). Cite both in the credits.
- LDNOOBW: CC BY 4.0, used at build time only, not shipped.

## Caveats

- Residual junk: spot checks of ~300 random words found a handful of lowercase names/typos per few thousand (`carla`, `césar`, `linea` without accent in ES; `bits`, `chef` are fine-but-foreign). Plan one human skim pass of the generated lists plus a committed `denylist.txt` applied in the build.
- Short Spanish words are partly grammar words and a few acronym-ish entries; the 2-3 letter tier needed a hand whitelist/denylist. Re-check them whenever thresholds change.
- Hunspell affix expansion in the script is an approximation (no compounding, simple prefix x suffix cross product). Over-generated forms are only kept if they also rank in wordfreq, so the damage is bounded.
- Profanity filter is English/Spanish-centric and conservative; it also drops some neutral words (`kill*`, `gay`, `matar`). Tune `BAD_STEMS`/`BAD_EXACT` as wanted.
- Proper-noun filter removes ambiguous common words ranked below 250 that are also names (`march`, `god`, `art`, `mark`, `page`, `rose`): ~725 EN, ~141 ES words traded for cleanliness.
- Spanish dialect: wordfreq mixes Spain/LatAm; the Hunspell dictionary is RAE-based (Spain-leaning), so some LatAm-only words (`computadora`, `carro`) may be dropped. Not measured.
- Words are all-lowercase; the game must not add capitalised words. Hyphen/apostrophe words are excluded by design.
- Attack-word ramp (map note: longer words more probable over time) can use the tiers directly; weights are a design decision for the Attack-word ticket, not set here.
