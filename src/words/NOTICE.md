# Word lists: license and attribution

`en.json` and `es.json` in this folder are licensed under
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
(CC BY-SA 4.0). This applies only to these two word lists. The game code is separate.

They are derived from the frequency data in [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1
by **Robyn Speer** (data CC BY-SA 4.0, code Apache-2.0;
citation: Robyn Speer (2022), rspeer/wordfreq v3.0, https://doi.org/10.5281/zenodo.7199437).

**Changes made:** words were taken in frequency order, cut at a minimum frequency (zipf 3.5),
filtered (typeable letters only, dictionary check, names, abbreviations, other-language words,
offensive words, a hand-picked denylist), and split into three length tiers. The build is
`scripts/wordlists/build_wordlists.py`.

## Sources credited by wordfreq

- OpenSubtitles: OPUS OpenSubtitles 2018 (http://opus.nlpl.eu/OpenSubtitles.php), data from
  the OpenSubtitles project (http://www.opensubtitles.org/).
- SUBTLEX word lists by Marc Brysbaert et al. (http://crr.ugent.be/programs-data/subtitle-frequencies).
  SUBTLEX is freely available data.
- Google Books Ngram Viewer (http://books.google.com/ngrams).
- The Leeds Internet Corpus, University of Leeds Centre for Translation Studies
  (http://corpus.leeds.ac.uk/list.html).
- Wikipedia, the free encyclopedia (http://www.wikipedia.org).
- ParaCrawl (https://paracrawl.eu).
- Word statistics from the Twitter streaming API (no Twitter content republished).

## Used at build time only (not shipped)

- Hunspell dictionaries from [wooorm/dictionaries](https://github.com/wooorm/dictionaries):
  English (SCOWL, en_US) and Spanish (LibreOffice `es`, used under MPL-1.1), as a spelling check.
- [List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
  (CC BY 4.0), as an offensive-word filter.
