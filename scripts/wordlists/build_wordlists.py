#!/usr/bin/env python3
"""Build the game's word lists (English + Spanish) into src/words/{en,es}.json.

Recipe and source choice: docs/research/word-lists.md on branch `research/word-lists`
(issue #41). Inputs live outside the repo; see scripts/wordlists/README.md.

    venv/bin/python -I scripts/wordlists/build_wordlists.py --raw RAW_DIR

RAW_DIR holds:
    dict-en/index.{dic,aff}   Hunspell en_US (wooorm/dictionaries, SCOWL)
    dict-es/index.{dic,aff}   Hunspell es    (wooorm/dictionaries, LibreOffice es)
    bad/{en,es}               LDNOOBW profanity lists (CC BY 4.0)
Frequency ranking comes from the `wordfreq` pip package (3.1.1).

Per language, in wordfreq rank order:
  1. stop below --min-zipf
  2. NFC + lowercase; typeable chars only (en: a-z; es: a-z + áéíóúñ; no ü)
  3. length 2-20; 2-letter words only from a whitelist
  4. must be a lowercase form in the Hunspell dictionary (drops proper nouns, typos, slang)
  5. drop words that are also a proper noun (outside the top 250 ranks)
  6. drop words that are much more common in the other language
  7. drop abbreviations / interjections / junk
  8. drop profanity, sexual, slur, drug and violence words
  9. ES: drop unaccented typos whose accented twin is ~3x more common (linea -> línea)
 10. drop the committed denylist (scripts/wordlists/denylist/{en,es}.txt)
 11. dedupe, split into tiers short 2-4 / medium 5-7 / long 8-20 (each in frequency order)
"""
import argparse
import json
import os
import re
import unicodedata
from collections import Counter

from wordfreq import top_n_list, zipf_frequency

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

LANGS = ("en", "es")
OTHER = {"en": "es", "es": "en"}
# ü is dropped on purpose: 7 words, hard to type without a dead-key combo.
ALLOWED = {
    "en": re.compile(r"^[a-z]+$"),
    "es": re.compile(r"^[a-zñáéíóú]+$"),
}
VOWELS = re.compile(r"[aeiouyáéíóú]")
TIERS = (("short", 2, 4), ("medium", 5, 7), ("long", 8, 20))
DUAL_CASE_EXEMPT_RANK = 250  # core words (will, may, house...) skip the proper-noun drop
CROSS_LANG_MARGIN = 0.8      # drop if the other language's zipf is this much higher
# ES: drop an unaccented word whose accented twin is this much more common (0.5 zipf = ~3x).
# Its frequency is mostly typos (linea for línea, ademas for además); the twin stays in the list.
ACCENT_TWIN_MARGIN = 0.5

# Prefix stems (startswith), on top of LDNOOBW. Conservative: family-friendly game.
BAD_STEMS = {
    "en": ["fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "whore", "slut", "nigg",
           "fagg", "bastard", "asshole", "penis", "vagina", "porn", "rape", "rapist", "nazi",
           "retard", "tits", "boob", "masturb", "orgasm", "erotic", "horny", "sperm",
           "nude", "naked", "sex", "damn", "crap", "piss", "wank", "twat", "bullshit", "prostitut",
           "genital", "kill", "murder", "suicid", "cocaine", "heroin", "gay", "lesbian",
           "genocid", "terroris", "holocaust"],
    "es": ["puta", "puto", "mierd", "joder", "jodid", "coño", "cojon", "polla", "verga", "pendej",
           "culo", "cabron", "cabrón", "follar", "folla", "chingar", "chingad", "marica", "maricon",
           "maricón", "gilipoll", "capullo", "zorra", "sexo", "sexual", "sexy", "porno", "pene",
           "vagina", "violar", "violaci", "nazi", "negrata", "mamada", "pajero", "tetas",
           "orgasmo", "erótic", "erotic", "desnud", "esperma", "cagar", "hostia",
           "carajo", "joto", "mamón", "mamon", "idiota", "imbécil", "imbecil", "estúpid",
           "estupid", "prostitu", "caga", "cagó", "cagu", "jod", "genital", "asesin", "suicid", "cocaín",
           "heroín", "lesbi", "pija", "matar", "mató", "genocid", "terroris", "holocaust"],
}
BAD_SUBSTR = ["sexual", "porn", "erotic", "erótic", "genital", "masturb", "prostitu", "homosex"]
# Would over-block as prefixes (cockpit, pajaro, cacahuete), so exact match only.
BAD_EXACT = {
    "en": {"cock", "cocks", "dick", "anal", "tit", "ass", "hell", "pee", "poo", "butt"},
    "es": {"pene", "paja", "pajas", "pedo", "pedos", "caca", "teta", "cago", "semen", "culo",
           "culos", "coño", "pis", "mear", "puto", "puta", "putas", "putos", "gay", "gays"},
}
TWO_LETTER_OK = {
    "en": set("of to in is it on be as at he by my or we an so me if up do no go us am hi".split()),
    "es": set("de la el en un se no es lo su al me si te mi le ya ha yo ir ni va he él sí tú mí ti da ve di fe os tu".split()),
}
JUNK = {
    "en": {"ok", "oh", "ah", "eh", "uh", "um", "hm", "hmm", "mm", "ha", "aa", "ii", "iii", "vs",
           "ie", "eg", "tv", "pm", "am", "dr", "mr", "mrs", "ms", "st", "ft", "lb", "oz", "kg",
           "km", "cm", "mg", "ml", "pc", "cd", "dj", "ad", "co", "inc", "ltd", "etc",
           "vol", "ted", "lee", "tom", "bob", "jay", "mar", "ken", "vii", "sen", "hes", "cox",
           "min", "sec", "ref", "mac", "doc", "rep", "gen", "sub", "com", "ave", "mil", "val",
           "reg", "def", "int", "res", "eds", "ops", "sim", "alt", "ins", "hon", "med", "dos",
           "gal", "cal", "col", "jun", "sci", "uni", "abs", "quo", "lib", "ole", "tel", "dis",
           "aka", "est", "thy", "huh", "ugh", "ooh", "nah", "yep", "yup", "yea", "tho", "woo",
           "boo", "aye", "bro", "mag", "sis", "exp", "var", "rec", "sic", "gee", "cos", "til", "gov", "bio",
           "cam", "pic", "mod", "kin", "bros", "mic", "amp", "ups", "ads", "yr", "thru", "govt", "capt",
           "dept", "prof", "corp", "asap", "oops", "gosh", "whoa", "heck", "blah", "nope"},
    "es": {"ah", "eh", "oh", "uh", "ay", "ja", "jaja", "ok", "vs", "sr", "sra", "dr", "pm", "cd",
           "tv", "etc", "km", "cm", "kg", "mg", "ml", "ee", "uu",
           "ing", "evo", "núm", "pág", "ej", "tel", "lic", "abc", "ben", "che", "une", "gil", "ali",
           "bla", "gral", "luis", "carmen", "anal", "art", "web", "pop", "rap", "kit", "vol", "der", "ara",
           "efe", "ésa", "cap", "col", "gen", "res", "tic", "rol", "ende", "osea", "ésto", "ése", "pos", "sos", "san", "non", "xi", "ta",
           "mu", "ra", "ap", "op", "qu", "fu", "ne", "je", "jo", "id", "ea", "uy", "pe", "pro"},
}


def nfc(s):
    return unicodedata.normalize("NFC", s)


# ---------------------------------------------------------------- Hunspell expansion
def parse_aff(path):
    """Affix rules per flag. Approximation: no compounding."""
    pfx, sfx, skip = {}, {}, ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.split("#", 1)[0].split()
            if not p:
                continue
            if p[0] in ("ONLYINCOMPOUND", "NEEDAFFIX") and len(p) > 1:
                skip += p[1]
            if p[0] in ("PFX", "SFX") and len(p) >= 5:
                flag, strip, add, cond = p[1], p[2], p[3], p[4]
                strip = "" if strip == "0" else strip
                add = add.split("/")[0]
                add = "" if add == "0" else add
                rx = None if cond == "." else re.compile(("^" + cond) if p[0] == "PFX" else (cond + "$"))
                (pfx if p[0] == "PFX" else sfx).setdefault(flag, []).append((strip, add, rx))
    return pfx, sfx, skip


def expand_dic(dic_path, aff_path):
    """All surface forms (original case) the dictionary generates."""
    pfx, sfx, skip = parse_aff(aff_path)
    forms = set()
    with open(dic_path, encoding="utf-8") as f:
        next(f)  # entry count
        for line in f:
            tok = line.split()
            if not tok:
                continue
            word, _, flags = tok[0].partition("/")
            if skip and any(c in skip for c in flags):
                continue
            forms.add(word)
            sfx_forms = []
            for fl in flags:
                for strip, add, rx in sfx.get(fl, ()):
                    if rx is not None and not rx.search(word):
                        continue
                    if strip and not word.endswith(strip):
                        continue
                    sfx_forms.append((word[: len(word) - len(strip)] if strip else word) + add)
            forms.update(sfx_forms)
            for fl in flags:
                for strip, add, rx in pfx.get(fl, ()):
                    if rx is not None and not rx.search(word):
                        continue
                    if strip and not word.startswith(strip):
                        continue
                    forms.add(add + word[len(strip):])
                    for sf in sfx_forms:  # cross product (approximation)
                        forms.add(add + sf[len(strip):] if strip else add + sf)
    return {nfc(x) for x in forms}


# ---------------------------------------------------------------- filtering
def read_word_file(path):
    """One word per line; `#` starts a comment; blank lines ignored."""
    out = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                w = nfc(line.split("#", 1)[0].strip().lower())
                if w and " " not in w:
                    out.add(w)
    return out


def strip_accents(w):
    return nfc("".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn"))


def accent_twins(lang, depth):
    """Unaccented spelling -> zipf of its most common accented spelling (ES only)."""
    best = {}
    if lang != "es":
        return best
    for v in top_n_list(lang, depth):
        v = nfc(v)
        base = strip_accents(v)
        if base != v:
            best[base] = max(best.get(base, 0.0), zipf_frequency(v, lang))
    return best


def tier_of(w):
    return next(name for name, lo, hi in TIERS if lo <= len(w) <= hi)


def build(lang, raw, denylist, min_zipf, depth):
    forms = expand_dic(os.path.join(raw, f"dict-{lang}", "index.dic"),
                       os.path.join(raw, f"dict-{lang}", "index.aff"))
    lower_ok = {x for x in forms if x == x.lower()}
    capitalised = {x for x in forms if x != x.lower()}
    bad = read_word_file(os.path.join(raw, "bad", lang))
    twins = accent_twins(lang, depth)
    stats = Counter()
    seen, kept = set(), []
    for rank, w0 in enumerate(top_n_list(lang, depth)):
        if zipf_frequency(w0, lang) < min_zipf:
            break  # sorted by frequency
        w = nfc(w0).lower()
        if not ALLOWED[lang].match(w):
            stats["not_typeable"] += 1
        elif not 2 <= len(w) <= 20:
            stats["length"] += 1
        elif w not in lower_ok:
            stats["not_in_dictionary"] += 1
        elif len(w) == 2 and w not in TWO_LETTER_OK[lang]:
            stats["junk"] += 1
        elif rank >= DUAL_CASE_EXEMPT_RANK and w.capitalize() in capitalised:
            stats["also_proper_noun"] += 1
        elif zipf_frequency(w, OTHER[lang]) > zipf_frequency(w, lang) + CROSS_LANG_MARGIN:
            stats["other_language"] += 1
        elif not VOWELS.search(w) or re.search(r"(.)\1\1", w) or w in JUNK[lang]:
            stats["junk"] += 1
        elif (w in bad or w in BAD_EXACT[lang] or any(w.startswith(s) for s in BAD_STEMS[lang])
              or any(x in w for x in BAD_SUBSTR)):
            stats["profanity"] += 1
        elif twins.get(w, 0.0) >= zipf_frequency(w, lang) + ACCENT_TWIN_MARGIN:
            stats["accent_typo"] += 1
        elif w in denylist:
            stats["denylist"] += 1
        elif w in seen:
            stats["duplicate"] += 1
        else:
            seen.add(w)
            kept.append(w)
    tiers = {name: [] for name, _, _ in TIERS}
    for w in kept:
        tiers[tier_of(w)].append(w)
    return tiers, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="dir with dict-{en,es}/ and bad/{en,es}")
    ap.add_argument("--out", default=os.path.join(REPO, "src", "words"))
    ap.add_argument("--min-zipf", type=float, default=3.5)
    ap.add_argument("--depth", type=int, default=250000, help="how deep into the wordfreq rank to scan")
    a = ap.parse_args()
    report = {}
    for lang in LANGS:
        denylist = read_word_file(os.path.join(HERE, "denylist", f"{lang}.txt"))
        tiers, stats = build(lang, a.raw, denylist, a.min_zipf, a.depth)
        with open(os.path.join(a.out, f"{lang}.json"), "w", encoding="utf-8") as f:
            json.dump(tiers, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        report[lang] = {"tiers": {t: len(v) for t, v in tiers.items()},
                        "total": sum(len(v) for v in tiers.values()),
                        "dropped": dict(stats)}
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
