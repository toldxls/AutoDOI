/*
 * AutoDOI — title case <-> sentence case conversion with proper-noun protection.
 * Pure functions only (no DOM, no network) so the same file runs in the browser
 * page, in Node, and in Google Apps Script. ES5 syntax.
 *
 * The converter is deliberately conservative: a capitalised word is lowercased
 * ONLY when it is known to be a common English word (the list in
 * data/common-words.js, built by tools/build-common-words.py), and even then
 * not when it sits in a run of capitalised words that contains an unknown or
 * user-protected word ("Late Cretaceous Hell Creek Formation" stays intact
 * because "Cretaceous" is unknown). Anything the converter is unsure about is
 * left as it was, so a UI can show each token and let the user flip it.
 *
 *   var res = AutoDOICase.toSentenceCase(title, { words: AutoDOI_COMMON_WORDS, protect: mySet });
 *   res.text    -> converted string
 *   res.tokens  -> [{ text, changed, kind: 'word' | 'punct' | 'space' }, ...]
 */
(function (root) {
  'use strict';

  /* ---------- word classes ---------- */

  // Standard function words; always present in the common-words list.
  var FUNCTION_WORDS = 'a an the of in on and or for with from to by at as but nor via vs versus into onto over under between among within without during after before through toward towards upon about across along around against is are was were be been its their our this that these those new';

  // Words kept lowercase in headline (MLA/Chicago) style unless first, last or after a colon:
  // articles, coordinating conjunctions and prepositions. Verbs and pronouns ARE capitalised
  // in headline style, so they are not in this list.
  var SMALL_WORDS = 'a an the of in on and or for with from to by at as but nor via vs versus into onto over under between among within without during after before through toward towards upon about across along around against';

  // Words that in sentence case are always lowercased mid-title and that end a run of
  // capitalised words. "new" is deliberately absent ("New Zealand", "New South Wales").
  var BREAKERS = SMALL_WORDS + ' is are was were be been its their our this that these those';

  // Punctuation after which the next word starts a new "sentence" (APA subtitle rule).
  var SENTENCE_END = /[:?!\u2014\u2013]$/;          // colon, ?, !, em dash, en dash
  var OPENERS = /[(\[{"\u201C\u2018'\u00AB]$/;       // opening bracket / quote (must touch the word)
  var JOINERS = /[-\/\u2010\u2011]/;                 // split hyphenated words on these
  var JOINER_SPLIT = /([-\/\u2010\u2011])/;

  /* ---------- tiny Set shim (Apps Script legacy runtime has no Set) ---------- */

  function makeSet() {
    if (typeof Set === 'function') return new Set();
    var o = {};
    return {
      has: function (k) { return Object.prototype.hasOwnProperty.call(o, k); },
      add: function (k) { o[k] = 1; return this; }
    };
  }

  function isSetLike(x) { return !!x && typeof x.has === 'function'; }

  // Turn a space-separated string (or array) of words into a Set; the last string is cached.
  var cacheStr = null, cacheSet = null;
  function wordsFrom(src) {
    if (isSetLike(src)) return src;
    if (src === null || src === undefined) return makeSet();
    if (typeof src === 'string' && src === cacheStr) return cacheSet;
    var list = typeof src === 'string' ? src.split(/\s+/) : src;
    var set = makeSet();
    for (var i = 0; i < list.length; i++) if (list[i]) set.add(String(list[i]).toLowerCase());
    if (typeof src === 'string') { cacheStr = src; cacheSet = set; }
    return set;
  }

  var FUNCTION_SET = wordsFrom(FUNCTION_WORDS);
  var SMALL_SET = wordsFrom(SMALL_WORDS);
  var BREAKER_SET = wordsFrom(BREAKERS);

  function resolveWords(opts) {
    var src = opts && opts.words;
    if (src === undefined && typeof root.AutoDOI_COMMON_WORDS === 'string') src = root.AutoDOI_COMMON_WORDS;
    var set = wordsFrom(src);
    // the function words are always "common", whatever list the caller passed
    if (set.has('the')) return set;
    return { has: function (k) { return set.has(k) || FUNCTION_SET.has(k); } };
  }

  function resolveProtect(opts) {
    var p = opts && opts.protect;
    if (!p) return null;
    if (isSetLike(p)) return p;
    var list = typeof p === 'string' ? p.split(/\s+/) : p, set = makeSet(); // exact case, no lowercasing
    for (var i = 0; i < list.length; i++) if (list[i]) set.add(String(list[i]));
    return set;
  }

  /* ---------- character helpers ---------- */

  function isSpace(c) { return /\s/.test(c); }
  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isLetter(c) {
    if (c.toLowerCase() !== c.toUpperCase()) return true;               // cased letters (Latin, Greek, Cyrillic...)
    return /[\u00AA\u00BA\u01BB\u01C0-\u01C3\u0294]/.test(c);            // a few caseless letters
  }
  function isWordChar(c) { return isLetter(c) || isDigit(c); }
  function isUpper(c) { return isLetter(c) && c === c.toUpperCase() && c !== c.toLowerCase(); }
  function hasUpper(s) { for (var i = 0; i < s.length; i++) if (isUpper(s.charAt(i))) return true; return false; }
  function hasDigit(s) { return /\d/.test(s); }
  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- tokenizer ---------- */

  // Splits a title into word / punct / space tokens. Hyphens, apostrophes, periods and
  // slashes stay inside a word only when a word character follows them ("Early-Middle",
  // "Darwin's", "U.S", "C/N"); everything else becomes a separate punct token.
  function tokenize(title) {
    var s = String(title == null ? '' : title), n = s.length, toks = [], i = 0, j, c;
    while (i < n) {
      c = s.charAt(i);
      if (isSpace(c)) {
        j = i; while (j < n && isSpace(s.charAt(j))) j++;
        toks.push({ text: s.slice(i, j), changed: false, kind: 'space' });
      } else if (isWordChar(c)) {
        j = i;
        while (j < n) {
          var d = s.charAt(j);
          if (isWordChar(d)) { j++; continue; }
          if ((JOINERS.test(d) || d === "'" || d === '\u2019' || d === '.') && j + 1 < n && isWordChar(s.charAt(j + 1))) { j++; continue; }
          break;
        }
        toks.push({ text: s.slice(i, j), changed: false, kind: 'word' });
      } else {
        j = i; while (j < n && !isSpace(s.charAt(j)) && !isWordChar(s.charAt(j))) j++;
        toks.push({ text: s.slice(i, j), changed: false, kind: 'punct' });
      }
      i = j;
    }
    return toks;
  }

  /* ---------- dictionary lookup ---------- */

  // Lowercase lookup key for one hyphen part: drops a possessive 's and inner periods.
  function lookupKey(part) {
    return part.toLowerCase().replace(/['\u2019]s?$/, '').replace(/\./g, '');
  }

  // Is `key` (already lowercase) a common word? Falls back to stripping regular
  // -s/-es/-ies, -ing, -ed and -ly endings so that the stored list need not contain
  // inflections ("placentals" -> "placental", "scoping" -> "scope").
  function isCommon(key, words) {
    if (!key || !/^[a-z\u00DF-\u00FF\u0100-\u024F]+$/.test(key)) return false;
    if (words.has(key)) return true;
    if (key.length < 4) return false;
    var stems = [], b;
    if (key.length > 4 && /ies$/.test(key)) stems.push(key.slice(0, -3) + 'y');
    if (/[^s]s$/.test(key)) {
      stems.push(key.slice(0, -1));
      if (/es$/.test(key)) stems.push(key.slice(0, -2));
    }
    if (key.length > 5 && /ing$/.test(key)) {
      b = key.slice(0, -3); stems.push(b, b + 'e');
      if (/(.)\1$/.test(b)) stems.push(b.slice(0, -1));
    }
    if (key.length > 4 && /ed$/.test(key)) {
      b = key.slice(0, -2); stems.push(b, b + 'e');
      if (/ied$/.test(key)) stems.push(key.slice(0, -3) + 'y');
      if (/(.)\1$/.test(b)) stems.push(b.slice(0, -1));
    }
    if (key.length > 5 && /ly$/.test(key)) {
      stems.push(key.slice(0, -2));
      if (/ily$/.test(key)) stems.push(key.slice(0, -3) + 'y');
    }
    for (var i = 0; i < stems.length; i++) if (stems[i].length >= 3 && words.has(stems[i])) return true;
    return false;
  }

  /* ---------- classification ---------- */

  // Class of one hyphen part:
  //   protected  in opts.protect (exact match)            -> never touched, anchors a run
  //   fixed      digits, single letter, all-caps, inner capital (DNA, NaCl, pH, NumPy, U.S)
  //   lower      already all lowercase
  //   breaker    capitalised function word (Of, The, With) -> always lowercased mid-title
  //   candidate  capitalised common word                   -> lowercased unless its run is anchored
  //   unknown    capitalised word not in the list          -> kept, anchors its run
  function classifyPart(part, words, protect) {
    if (protect && protect.has(part)) return 'protected';
    if (hasDigit(part)) return 'fixed';
    var first = part.charAt(0), rest = part.slice(1);
    if (!isUpper(first)) return hasUpper(rest) ? 'fixed' : 'lower';
    if (part.length === 1 || hasUpper(rest)) return 'fixed';
    var key = lookupKey(part);
    if (BREAKER_SET.has(key)) return 'breaker';
    if (isCommon(key, words)) return 'candidate';
    return 'unknown';
  }

  // Splits a word token into parts + separators and classifies each part.
  function analyse(text, words, protect) {
    var pieces = text.split(JOINER_SPLIT), parts = [], cls = [], i;
    for (i = 0; i < pieces.length; i += 2) {
      parts.push(pieces[i]);
      cls.push(classifyPart(pieces[i], words, protect));
    }
    var info = { pieces: pieces, parts: parts, cls: cls, whole: 'neutral' };
    if (protect && protect.has(text)) info.whole = 'anchor';
    else {
      var hasCand = false, hasBreak = false, hasUnknown = false, hasProt = false;
      for (i = 0; i < cls.length; i++) {
        if (cls[i] === 'candidate') hasCand = true;
        else if (cls[i] === 'breaker') hasBreak = true;
        else if (cls[i] === 'unknown') hasUnknown = true;
        else if (cls[i] === 'protected') hasProt = true;
      }
      if (hasProt || hasUnknown) info.whole = 'anchor';
      else if (hasCand) info.whole = 'candidate';
      else if (hasBreak) info.whole = parts.length === 1 ? 'breaker' : 'candidate';
      else info.whole = 'neutral';
    }
    return info;
  }

  // Rebuilds the word text, lowercasing candidate/breaker parts (skipping the first part
  // when keepFirst is set, i.e. at a sentence start).
  function lowerParts(info, keepFirst) {
    var out = '', k = 0;
    for (var i = 0; i < info.pieces.length; i++) {
      if (i % 2 === 1) { out += info.pieces[i]; continue; }
      var c = info.cls[k], p = info.parts[k]; k++;
      if ((c === 'candidate' || c === 'breaker') && !(keepFirst && k === 1)) p = p.toLowerCase();
      out += p;
    }
    return out;
  }

  // Index of the previous non-space token, or -1.
  function prevSolid(toks, i) {
    for (var j = i - 1; j >= 0; j--) if (toks[j].kind !== 'space') return j;
    return -1;
  }

  // True when the word at toks[i] starts a sentence: first word, or after : ? ! — or right
  // after an opening bracket/quote.
  function isSentenceStart(toks, i, seenWord) {
    if (!seenWord) return true;
    var j = prevSolid(toks, i);
    if (j < 0 || toks[j].kind !== 'punct') return false;
    if (SENTENCE_END.test(toks[j].text)) return true;
    return j === i - 1 && OPENERS.test(toks[j].text);
  }

  function isDoubleQuote(t) { return /^["\u201C\u201D]+$/.test(t); }

  /* ---------- sentence case ---------- */

  function toSentenceCase(title, opts) {
    var words = resolveWords(opts), protect = resolveProtect(opts);
    var toks = tokenize(title), infos = [], i;
    var run = [], runAnchored = false, seenWord = false, inQuote = false;

    // run: indices of consecutive capitalised word tokens (candidates, anchors and the
    // sentence-start word, which keeps its first part). When the run holds no anchor every
    // candidate part in it is lowercased; otherwise the whole run is left as it was.
    function flush() {
      if (run.length && !runAnchored) {
        for (var r = 0; r < run.length; r++) {
          var t = toks[run[r].i];
          var txt = lowerParts(infos[run[r].i], run[r].keepFirst);
          if (txt !== t.text) { t.text = txt; t.changed = true; }
        }
      }
      run = []; runAnchored = false;
    }

    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'space') continue;
      if (tok.kind === 'punct') {
        flush();
        if (isDoubleQuote(tok.text)) inQuote = !inQuote;   // text inside double quotes is left alone
        continue;
      }
      var info = analyse(tok.text, words, protect);
      infos[i] = info;
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;

      if (inQuote) { flush(); continue; }

      if (start) {
        flush();
        // The first word stays capitalised (and a plain lowercase first word is capitalised).
        // Being first tells us nothing about whether it is a proper noun, so it does not
        // anchor the run that follows it unless the user protected it; its further hyphen
        // parts are treated like any other candidate in that run ("Nanometre-Scale" ->
        // "Nanometre-scale", but "Early-Middle Jurassic" keeps "Middle").
        if (info.cls[0] === 'lower' && !(protect && protect.has(info.parts[0]))) {
          tok.text = capitalise(tok.text); tok.changed = true;
        }
        if (info.whole === 'anchor' && info.cls[0] === 'protected') runAnchored = true;
        if (info.whole !== 'neutral' && info.whole !== 'breaker') run.push({ i: i, keepFirst: true });
        continue;
      }

      if (info.whole === 'anchor') { run.push({ i: i, keepFirst: false }); runAnchored = true; }
      else if (info.whole === 'candidate') { run.push({ i: i, keepFirst: false }); }
      else if (info.whole === 'breaker') {
        flush();
        var low = tok.text.toLowerCase();
        if (low !== tok.text) { tok.text = low; tok.changed = true; }
      } else { flush(); } // neutral: lowercase / fixed words end a run and stay as they are
    }
    flush();

    return { text: joinTokens(toks), tokens: toks };
  }

  /* ---------- title case (MLA / Chicago headline style) ---------- */

  function toTitleCase(title, opts) {
    var protect = resolveProtect(opts);
    var small = opts && opts.small ? wordsFrom(opts.small) : SMALL_SET;
    var toks = tokenize(title), i, lastWord = -1, seenWord = false, inQuote = false;
    for (i = toks.length - 1; i >= 0; i--) if (toks[i].kind === 'word') { lastWord = i; break; }

    for (i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind === 'space') continue;
      if (tok.kind === 'punct') { if (isDoubleQuote(tok.text)) inQuote = !inQuote; continue; }
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;
      if (inQuote) continue;
      if (protect && protect.has(tok.text)) continue;

      var pieces = tok.text.split(JOINER_SPLIT), out = '', k = 0;
      for (var p = 0; p < pieces.length; p++) {
        if (p % 2 === 1) { out += pieces[p]; continue; }
        var part = pieces[p], firstPart = (k === 0); k++;
        if (!part || (protect && protect.has(part)) || hasDigit(part) || hasUpper(part.slice(1))) { out += part; continue; }
        var key = lookupKey(part);
        var edge = start || i === lastWord;
        if (small.has(key) && !(edge && firstPart)) out += part.toLowerCase();
        else out += capitalise(part);
      }
      if (out !== tok.text) { tok.text = out; tok.changed = true; }
    }
    return { text: joinTokens(toks), tokens: toks };
  }

  /* ---------- detection ---------- */

  // 'upper'    : no lowercase letters at all
  // 'title'    : (almost) every eligible mid-title word is capitalised
  // 'sentence' : (almost) none is
  // 'mixed'    : anything in between (typical for sentence case with many proper nouns)
  // Eligible words exclude the first word / words after a colon, function words, all-caps,
  // mixed-case, digits and single letters. If opts.words is given (or the global list is
  // loaded) only known common words are counted, so proper nouns do not skew the result.
  function detectCase(title, opts) {
    var s = String(title == null ? '' : title);
    if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) return 'upper';
    var src = opts && opts.words;
    if (src === undefined && typeof root.AutoDOI_COMMON_WORDS === 'string') src = root.AutoDOI_COMMON_WORDS;
    var words = src ? wordsFrom(src) : null;
    var toks = tokenize(s), seenWord = false, cap = 0, low = 0;
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok.kind !== 'word') continue;
      var start = isSentenceStart(toks, i, seenWord);
      seenWord = true;
      if (start) continue;
      var part = tok.text.split(JOINER_SPLIT)[0];
      if (!part || part.length < 2 || hasDigit(part) || hasUpper(part.slice(1))) continue;
      var key = lookupKey(part);
      if (BREAKER_SET.has(key) || key === 'new') continue;
      if (words && !isCommon(key, words)) continue;
      if (isUpper(part.charAt(0))) cap++; else if (isLetter(part.charAt(0))) low++;
    }
    var total = cap + low;
    if (total === 0) return 'sentence';
    if (low === 0) return 'title';
    if (cap === 0) return 'sentence';
    var share = cap / total;
    if (share >= 0.8) return 'title';
    if (share <= 0.34) return 'sentence';
    return 'mixed';
  }

  /* ---------- misc ---------- */

  function joinTokens(toks) {
    var out = '';
    for (var i = 0; i < toks.length; i++) out += toks[i].text;
    return out;
  }

  var api = {
    toSentenceCase: toSentenceCase,
    toTitleCase: toTitleCase,
    detectCase: detectCase,
    wordsFrom: wordsFrom,
    tokenize: tokenize,
    isCommon: function (word, words) { return isCommon(lookupKey(String(word)), resolveWords({ words: words })); },
    FUNCTION_WORDS: FUNCTION_WORDS,
    SMALL_WORDS: SMALL_WORDS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AutoDOICase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
