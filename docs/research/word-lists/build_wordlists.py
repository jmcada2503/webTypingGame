#!/usr/bin/env python3
"""Throwaway: build common-word lists (EN + ES) for the typing game.

Research for issue #41. NOT production code. Run isolated:

    python3 -I build_wordlists.py --raw RAW_DIR --out OUT_DIR [--top N]

RAW_DIR (outside the repo, untrusted data) must hold:
    dict-en/index.{dic,aff}   Hunspell en_US  (wooorm/dictionaries, SCOWL)
    dict-es/index.{dic,aff}   Hunspell es     (wooorm/dictionaries, LibreOffice es)
    bad/{en,es}               LDNOOBW profanity lists (CC BY 4.0)
    hd/{en,es}_50k.txt        optional: hermitdave/FrequencyWords (cross-check only)
Frequency ranking comes from the `wordfreq` pip package (needs `pip install wordfreq`;
run with that venv's python, e.g. `venv/bin/python -I`).

Pipeline per language:
  1. take wordfreq top-N list (ranked by multi-source frequency)
  2. NFC-normalise, lowercase, keep only typeable chars (en: a-z; es: a-z + aeiou-acute, u-diaeresis, n-tilde)
  3. keep only words that are lowercase forms in the Hunspell dictionary (affixes expanded):
     drops proper nouns (dic entries are capitalised), typos, slang, foreign words, most abbreviations
  4. drop abbreviations/junk heuristically (no vowel, 3+ identical letters in a row, 1 letter)
  5. drop profanity/sexual/slur terms (LDNOOBW single words + stem list below)
  6. dedupe (after NFC) preserving frequency order, cap length 20
  7. split into tiers: short 2-4, medium 5-7, long 8-20; keep first `--top` survivors overall
"""
import argparse
import json
import os
import random
import re
import unicodedata
from collections import Counter

from wordfreq import top_n_list, zipf_frequency

ALLOWED = {
    "en": re.compile(r"^[a-z]+$"),
    "es": re.compile(r"^[a-zñáéíóúü]+$"),
}
ACCENTED = re.compile(r"[áéíóúüñ]")
VOWELS = re.compile(r"[aeiouyáéíóúü]")
# extra PREFIX stems (startswith) on top of LDNOOBW; conservative, family-friendly game
BAD_STEMS = {
    "en": ["fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "whore", "slut", "nigg",
           "fagg", "bastard", "asshole", "penis", "vagina", "porn", "rape", "rapist", "nazi",
           "retard", "tits", "boob", "masturb", "orgasm", "erotic", "horny", "sperm",
           "nude", "naked", "sex", "damn", "crap", "piss", "wank", "twat", "bullshit", "prostitut",
           "genital", "kill", "murder", "suicid", "cocaine", "heroin", "gay", "lesbian"],
    "es": ["puta", "puto", "mierd", "joder", "jodid", "coño", "cojon", "polla", "verga", "pendej",
           "culo", "cabron", "cabrón", "follar", "folla", "chingar", "chingad", "marica", "maricon",
           "maricón", "gilipoll", "capullo", "zorra", "sexo", "sexual", "sexy", "porno", "pene",
           "vagina", "violar", "violaci", "nazi", "negrata", "mamada", "pajero", "tetas",
           "orgasmo", "erótic", "erotic", "desnud", "esperma", "cagar", "hostia",
           "carajo", "joto", "mamón", "mamon", "idiota", "imbécil", "imbecil", "estúpid",
           "estupid", "prostitu", "caga", "cagó", "cagu", "jod", "genital", "asesin", "suicid", "cocaín",
           "heroín", "lesbi", "pija", "matar", "mató"],
}
# blocked anywhere inside the word (long enough to be safe)
BAD_SUBSTR = ["sexual", "porn", "erotic", "erótic", "genital", "masturb", "prostitu", "homosex"]
# words that would be over-blocked as prefixes, so blocked only when exact
BAD_EXACT = {
    "en": {"cock", "cocks", "dick", "anal", "tit", "ass", "hell", "pee", "poo", "butt"},
    "es": {"pene", "paja", "pajas", "pedo", "pedos", "caca", "teta", "cago", "semen", "culo",
           "culos", "coño", "pis", "mear", "puto", "puta", "putas", "putos", "gay", "gays"},
}
# short words that are Hunspell-valid but are really abbreviations / interjections / letters
TWO_LETTER_OK = {
    "en": set("of to in is it on be as at he by my or we an so me if up do no go us am hi".split()),
    "es": set("de la el en un se no es lo su al me si te mi le ya ha yo ir ni va he él sí tú mí ti da ve di fe os tu".split()),
}
JUNK = {
    "en": {"ok", "oh", "ah", "eh", "uh", "um", "hm", "hmm", "mm", "ha", "aa", "ii", "iii", "vs",
           "ie", "eg", "tv", "pm", "am", "dr", "mr", "mrs", "ms", "st", "ft", "lb", "oz", "kg",
           "km", "cm", "mm", "mg", "ml", "pc", "cd", "dj", "ad", "co", "inc", "ltd", "etc",
           # 3-letter abbreviations / names / interjections that Hunspell accepts
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


# ---------------------------------------------------------------- Hunspell expansion
def parse_aff(path):
    pfx, sfx = {}, {}
    only_incompound = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.split("#", 1)[0].split()
            if not p:
                continue
            if p[0] in ("ONLYINCOMPOUND", "NEEDAFFIX") and len(p) > 1:
                only_incompound = (only_incompound or "") + p[1]
            if p[0] in ("PFX", "SFX") and len(p) >= 5:
                flag, strip, add, cond = p[1], p[2], p[3], p[4]
                strip = "" if strip == "0" else strip
                add = add.split("/")[0]
                add = "" if add == "0" else add
                if cond == ".":
                    rx = None
                else:
                    rx = re.compile(("^" + cond) if p[0] == "PFX" else (cond + "$"))
                (pfx if p[0] == "PFX" else sfx).setdefault(flag, []).append((strip, add, rx))
            # header lines (PFX flag Y/N count) have 4 fields: remember cross-product bit
            elif p[0] in ("PFX", "SFX") and len(p) == 4:
                pass
    return pfx, sfx, only_incompound or ""


def expand_dic(dic_path, aff_path):
    """Return set of all surface forms (original case) generated from the dictionary."""
    pfx, sfx, skip_flags = parse_aff(aff_path)
    forms = set()
    with open(dic_path, encoding="utf-8") as f:
        next(f)  # entry count
        for line in f:
            tok = line.split()
            if not tok:
                continue
            word, _, flags = tok[0].partition("/")
            if skip_flags and any(c in skip_flags for c in flags):
                continue
            forms.add(word)
            sfx_forms = []
            for fl in flags:
                for strip, add, rx in sfx.get(fl, ()):
                    if rx is not None and not rx.search(word):
                        continue
                    if strip and not word.endswith(strip):
                        continue
                    stem = word[: len(word) - len(strip)] if strip else word
                    sfx_forms.append(stem + add)
            forms.update(sfx_forms)
            for fl in flags:
                for strip, add, rx in pfx.get(fl, ()):
                    if rx is not None and not rx.search(word):
                        continue
                    if strip and not word.startswith(strip):
                        continue
                    base = word[len(strip):]
                    forms.add(add + base)
                    for sf in sfx_forms:  # cross product (approximation)
                        forms.add(add + sf[len(strip):] if strip else add + sf)
    return forms


# ---------------------------------------------------------------- filtering
def load_bad(raw, lang):
    out = set()
    p = os.path.join(raw, "bad", lang)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                w = unicodedata.normalize("NFC", line.strip().lower())
                if w and " " not in w:
                    out.add(w)
    return out


def tier(w):
    n = len(w)
    return "short" if n <= 4 else "medium" if n <= 7 else "long"


DUAL_CASE_EXEMPT_RANK = 250   # core words (will, may, right, house...) are exempt from the proper-noun drop
CROSS_LANG_MARGIN = 0.8       # drop word if its zipf in the *other* language is this much higher
OTHER = {"en": "es", "es": "en"}


def build(lang, raw, depth, top, min_zipf):
    forms = expand_dic(os.path.join(raw, f"dict-{lang}", "index.dic"),
                       os.path.join(raw, f"dict-{lang}", "index.aff"))
    forms = {unicodedata.normalize("NFC", x) for x in forms}
    lower_ok = {x for x in forms if x == x.lower()}  # drops capitalised = proper nouns
    capitalised = {x for x in forms if x != x.lower()}
    bad = load_bad(raw, lang)
    stems = BAD_STEMS[lang]
    stats = Counter()
    seen, kept = set(), []
    for rank, w0 in enumerate(top_n_list(lang, depth)):
        stats["candidates"] += 1
        if zipf_frequency(w0, lang) < min_zipf:
            break  # list is sorted by frequency
        w = unicodedata.normalize("NFC", w0).lower()
        if not ALLOWED[lang].match(w):
            stats["not_typeable(punct/digits/other-script)"] += 1
            continue
        if not 2 <= len(w) <= 20:
            stats["length"] += 1
            continue
        if w not in lower_ok:
            stats["not_in_dictionary(proper/typo/slang/foreign)"] += 1
            continue
        if len(w) == 2 and w not in TWO_LETTER_OK[lang]:
            stats["abbrev/junk"] += 1
            continue
        if rank >= DUAL_CASE_EXEMPT_RANK and w.capitalize() in capitalised:
            stats["also_proper_noun(john, china, march...)"] += 1
            continue
        if zipf_frequency(w, OTHER[lang]) > zipf_frequency(w, lang) + CROSS_LANG_MARGIN:
            stats["mostly_other_language"] += 1
            continue
        if not VOWELS.search(w) or re.search(r"(.)\1\1", w) or w in JUNK[lang]:
            stats["abbrev/junk"] += 1
            continue
        if w in bad or w in BAD_EXACT[lang] or any(w.startswith(s) for s in stems) \
                or any(x in w for x in BAD_SUBSTR):
            stats["profanity/sexual"] += 1
            continue
        if w in seen:
            stats["duplicate"] += 1
            continue
        seen.add(w)
        kept.append(w)
        if len(kept) >= top:
            break
    return kept, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--depth", type=int, default=250000, help="how deep into wordfreq rank to scan")
    ap.add_argument("--top", type=int, default=100000, help="max words kept per language")
    ap.add_argument("--min-zipf", type=float, default=3.0, help="stop below this wordfreq zipf score")
    ap.add_argument("--seed", type=int, default=41)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = random.Random(a.seed)
    report = {}
    for lang in ("en", "es"):
        kept, stats = build(lang, a.raw, a.depth, a.top, a.min_zipf)
        tiers = {"short": [], "medium": [], "long": []}
        for w in kept:
            tiers[tier(w)].append(w)
        r = {"total": len(kept), "min_zipf": round(zipf_frequency(kept[-1], lang), 2),
             "tiers": {t: len(v) for t, v in tiers.items()},
             "filter_stats": dict(stats)}
        if lang == "es":
            acc = [w for w in kept if ACCENTED.search(w)]
            r["accented"] = {
                "words": len(acc), "pct": round(100 * len(acc) / len(kept), 1),
                "with_n_tilde": sum("ñ" in w for w in kept),
                "with_u_diaeresis": sum("ü" in w for w in kept),
                "by_tier": {t: sum(bool(ACCENTED.search(w)) for w in v) for t, v in tiers.items()},
                "by_letter": {c: sum(c in w for w in kept) for c in "áéíóúüñ"},
                # share of running-text occurrences (wordfreq frequency mass)
                "freq_mass_pct": round(100 * sum(10 ** zipf_frequency(w, "es") for w in acc)
                                       / sum(10 ** zipf_frequency(w, "es") for w in kept), 1),
            }
        # accent-free ES variant sizes (if we decide to drop accent words)
        r["by_min_zipf"] = {}
        for z in (5.0, 4.5, 4.0, 3.5, 3.0):
            sub = [w for w in kept if zipf_frequency(w, lang) >= z]
            r["by_min_zipf"][str(z)] = {"total": len(sub), **{t: sum(tier(w) == t for w in sub)
                                                              for t in tiers}}
        if lang == "es":
            r["tiers_without_accents"] = {t: sum(not ACCENTED.search(w) for w in v)
                                          for t, v in tiers.items()}
        report[lang] = r
        with open(os.path.join(a.out, f"{lang}.json"), "w", encoding="utf-8") as f:
            json.dump(tiers, f, ensure_ascii=False)
        samp = {t: {"most_common": v[:15], "random": sorted(rng.sample(v, min(25, len(v))))}
                for t, v in tiers.items()}
        if lang == "es":
            acc = [w for w in kept if ACCENTED.search(w)]
            samp["accented_random"] = sorted(rng.sample(acc, min(25, len(acc))))
        with open(os.path.join(a.out, f"{lang}.sample.json"), "w", encoding="utf-8") as f:
            json.dump(samp, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
