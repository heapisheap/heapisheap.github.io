/*! Jetsam v0.2 - a tiny engine for intro/blog pages. One file. Reads txt.jet. */
(function () {
  'use strict';

  var script = typeof document !== 'undefined' ? document.currentScript : null;
  var SRC = (script && script.dataset.src) || 'txt.jet';
  var FONT_DIR = (script && script.dataset.fonts) || 'fonts/';
  var FADE = !(script && script.dataset.fade === 'off');

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    s = esc(s);
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, a, u) {
        if (/^\s*(javascript|data):/i.test(u)) return a;
        return '<a href="' + u + '">' + a + '</a>';
      });
  }

  function safeUrl(u) {
    return /^\s*(javascript|data):/i.test(u) ? '' : u;
  }

  // hex ("#rgb", "ff8800", "#rrggbbaa") or a plain colour name. Anything else is dropped.
  function safeColor(v) {
    v = String(v || '').trim().replace(/^["']|["']$/g, '');
    var m = /^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})$/i.exec(v);
    if (m) return '#' + m[1].toLowerCase();
    if (/^[a-z]{3,20}$/i.test(v)) return v.toLowerCase();
    return '';
  }

  function hexToRgb(h) {
    var m = /^#([0-9a-f]+)$/i.exec(h || '');
    if (!m) return null;
    var s = m[1];
    if (s.length <= 4) s = s.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(s.substr(0, 2), 16), parseInt(s.substr(2, 2), 16), parseInt(s.substr(4, 2), 16)];
  }

  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function len(v) {
    v = String(v || '').replace(/\s+/g, '');
    if (/^[\d.]+$/.test(v)) v += 'px';
    return /^[\d.]+(px|%|vw|vh|em|rem)$/i.test(v) ? v : '';
  }

  // ---------- tokenizer ----------
  function tokenize(src) {
    var t = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        var j = i + 1, s = '';
        while (j < n && src[j] !== '"') {
          if (src[j] === '\\' && j + 1 < n) {
            j++;
            s += src[j] === 'n' ? '\n' : src[j];
          } else s += src[j];
          j++;
        }
        t.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      if (src.substr(i, 2) === '->') { t.push({ t: 'arrow' }); i += 2; continue; }
      if (c === '(') {
        var depth = 0, k = i, inq = false;
        for (; k < n; k++) {
          var ch = src[k];
          if (inq && ch === '\\') { k++; continue; }
          if (ch === '"') inq = !inq;
          else if (!inq) {
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (!depth) break; }
          }
        }
        t.push({ t: 'opts', v: src.slice(i + 1, k) });
        i = k + 1;
        continue;
      }
      var w = i;
      while (w < n && !/[\s"()]/.test(src[w]) && src.substr(w, 2) !== '->') w++;
      if (w === i) w++;
      t.push({ t: 'word', v: src.slice(i, w) });
      i = w;
    }
    return t;
  }

  // ---------- options ----------
  var DIRS = { left: 'left', right: 'right', up: 'up', above: 'up', down: 'down', below: 'down' };

  // size / direction (a.k.a. "next to") / close / color
  function parseBasic(raw) {
    var o = {}, m, s;
    var noAlign = raw.replace(/align\s*[:=]\s*\w+/ig, ' ');
    if ((m = /(?:^|[,\s])size\s*[:=]\s*([\d.]+\s*(?:%|px|vw|vh|em|rem)?)/i.exec(raw)) && (s = len(m[1]))) o.size = s;
    if ((m = /(?:direction|next\s*-?\s*to)\s*[:=]\s*(left|right|up|down|above|below)/i.exec(noAlign)) ||
        (m = /(?:^|[,\s])(left|right|up|down)(?=$|[,\s])/i.exec(noAlign))) o.direction = DIRS[m[1].toLowerCase()];
    if ((m = /close\s*[:=]\s*([\d.]+\s*(?:px|em|rem|%|vw)?)/i.exec(raw)) && (s = len(m[1]))) o.close = s;
    if ((m = /(?:^|[,\s])color\s*[:=]\s*(#?[0-9a-z]+)/i.exec(raw))) {
      s = safeColor(m[1]);
      if (s) o.color = s;
    }
    return o;
  }

  function parseOpts(raw) {
    var o = {}, m;
    var alt = /alt\s*[:=]?\s*"((?:[^"\\]|\\.)*)"/i.exec(raw);
    if (alt) { o.alt = alt[1].replace(/\\(.)/g, '$1'); raw = raw.replace(alt[0], ' '); }
    var cap = /caption\s*[:=]?\s*"((?:[^"\\]|\\.)*)"\s*(?:\(([^)]*)\))?/i.exec(raw);
    if (cap) {
      o.caption = cap[1].replace(/\\(.)/g, '$1');
      o.captionOpts = cap[2] ? parseBasic(cap[2]) : {};
      raw = raw.replace(cap[0], ' ');
    }
    var b = parseBasic(raw);
    for (var k in b) o[k] = b[k];
    if ((m = /align\s*[:=]\s*(left|right|center)/i.exec(raw))) o.align = m[1].toLowerCase();
    return o;
  }

  function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }

  // "below s4" | "above s4" | "nextto s4" | "next to s4"
  function placeAt(tk, i) {
    var k = tk[i];
    if (!k || k.t !== 'word') return null;
    var w = k.v.toLowerCase(), n = 1, place = null;
    if (w === 'below' || w === 'above') place = w;
    else if (w === 'nextto' || w === 'next-to') place = 'nextto';
    else if (w === 'next' && tk[i + 1] && tk[i + 1].t === 'word' && tk[i + 1].v.toLowerCase() === 'to') { place = 'nextto'; n = 2; }
    if (!place) return null;
    var tg = tk[i + n], m = tg && tg.t === 'word' && /^s?(\d+)$/i.exec(tg.v);
    if (!m) return null;
    return { place: place, target: +m[1], n: n + 1 };
  }

  // ---------- statement parser ----------
  function parseStmt(id, tk, color) {
    var isImg = tk[0].t === 'word' && tk[0].v.toLowerCase() === 'img';
    var st = { id: id, kind: isImg ? 'img' : 'text', color: color || null, segs: [], url: '', place: null, target: null, opts: {} };
    var font = null, last = null;
    for (var i = isImg ? 1 : 0; i < tk.length; i++) {
      var k = tk[i], p = placeAt(tk, i);
      if (p) {
        st.place = p.place; st.target = p.target; i += p.n - 1;
        if (tk[i + 1] && tk[i + 1].t === 'opts') { merge(st.opts, parseOpts(tk[i + 1].v)); i++; last = null; }
        continue;
      }
      if (k.t === 'word' && !isImg && k.v.toLowerCase() === 'font') {
        if (tk[i + 1] && tk[i + 1].t === 'str') { font = tk[i + 1].v; i++; }
        continue;
      }
      if (k.t === 'str') {
        if (isImg) { if (!st.url) st.url = k.v; }
        else { last = { font: font, text: k.v, opts: {} }; st.segs.push(last); }
      } else if (k.t === 'opts') {
        var po = parseOpts(k.v);
        if (isImg || !last) merge(st.opts, po); else last.opts = po;
      }
    }
    return st;
  }

  function parse(text) {
    var cfg = { fonts: [], background: '', textColor: '' }, stmts = [], auto = 0, stack = [];

    function addStmt(line, color) {
      var m = /^(\d+)\s+(.*)$/.exec(line), id, body;
      if (m) { id = +m[1]; body = m[2]; auto = id; } else { id = ++auto; body = line; }
      var tk = tokenize(body);
      if (tk.length) stmts.push(parseStmt(id, tk, color));
    }

    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(), m;
      if (!line || line.slice(0, 2) === '//') return;

      if ((m = /^locnoneed-font\s*<-\s*(.+)$/i.exec(line))) {
        var found = m[1].match(/"[^"]+"/g);
        (found ? found.map(function (q) { return q.slice(1, -1); }) : [m[1].trim()]).forEach(function (n) {
          n = n.trim();
          if (n && cfg.fonts.indexOf(n) < 0) cfg.fonts.push(n);
        });
        return;
      }
      if ((m = /^background\s*->\s*(.+)$/i.exec(line))) { cfg.background = safeColor(m[1]); return; }

      if ((m = /^text-color\s*\(([^)]*)\)\s*\{\s*\}\s*$/i.exec(line))) { cfg.textColor = safeColor(m[1]); return; }
      if ((m = /^text-color\s*\(([^)]*)\)\s*\{(.+)\}\s*$/i.exec(line))) { addStmt(m[2].trim(), safeColor(m[1]) || null); return; }
      if ((m = /^text-color\s*\(([^)]*)\)\s*\{\s*$/i.exec(line))) { stack.push(safeColor(m[1]) || null); return; }
      if ((m = /^text-color\s*\(([^)]*)\)\s*$/i.exec(line))) { cfg.textColor = safeColor(m[1]); return; }

      if (line === '}') { stack.pop(); return; }
      var closes = stack.length && /\}\s*$/.test(line);
      if (closes) line = line.replace(/\}\s*$/, '').trim();
      if (line) addStmt(line, stack.length ? stack[stack.length - 1] : null);
      if (closes) stack.pop();
    });
    return { config: cfg, stmts: stmts };
  }

  // ---------- renderer ----------
  function renderText(st, fontsUsed, info) {
    if (!st.segs.length) return '';
    var level = 0;
    var first = /^(#{1,6})\s*([\s\S]*)$/.exec(st.segs[0].text);
    var html = st.segs.map(function (seg, idx) {
      var text = seg.text, css = '';
      if (idx === 0 && first) { level = first[1].length; text = first[2]; }
      else text = text.replace(/^#{1,6}\s*/, '');
      if (seg.font) {
        fontsUsed[seg.font] = true;
        css += 'font-family:&quot;' + esc(seg.font) + '&quot;,system-ui,sans-serif;';
      }
      if (seg.opts.size) css += 'font-size:' + seg.opts.size + ';';
      if (seg.opts.color) css += 'color:' + seg.opts.color + ';';
      return '<span' + (css ? ' style="' + css + '"' : '') + '>' + inline(text) + '</span>';
    }).join('');
    if (level && !info.title) info.title = st.segs[0].text.replace(/^#{1,6}\s*/, '').trim();
    var tag = level ? 'h' + level : 'p';
    return '<' + tag + (st.color ? ' style="color:' + st.color + '"' : '') + '>' + html + '</' + tag + '>';
  }

  function renderImg(im) {
    var url = safeUrl(im.url);
    if (!url) return '';
    var o = im.opts, cd = o.captionOpts || {};
    var cls = 'jet-img' + (o.align ? ' jet-' + o.align : '');
    var style = o.size ? 'width:' + o.size + ';' : '';
    var cs = '';
    if (o.caption && cd.direction) {
      var d = cd.direction, gap = cd.close || '8px';
      if (d === 'left' || d === 'right') {
        cls += ' jet-capside';
        style += 'flex-direction:' + (d === 'right' ? 'row' : 'row-reverse') + ';gap:' + gap + ';';
      } else if (d === 'up') {
        cls += ' jet-capcol';
        style += 'flex-direction:column-reverse;gap:' + gap + ';';
      } else if (cd.close) cs += 'margin-top:' + cd.close + ';';
    }
    if (cd.size) cs += 'font-size:' + cd.size + ';';
    var cc = cd.color || im.color;
    if (cc) cs += 'color:' + cc + ';';
    return '<figure class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' +
      '<img src="' + esc(url) + '" alt="' + esc(o.alt || o.caption || '') + '" loading="lazy">' +
      (o.caption ? '<figcaption' + (cs ? ' style="' + cs + '"' : '') + '>' + inline(o.caption) + '</figcaption>' : '') +
      '</figure>';
  }

  function render(doc, fontsUsed, info) {
    fontsUsed = fontsUsed || {};
    info = info || {};
    var stmts = (doc.stmts || doc).map(function (s, i) { s._i = i; return s; })
      .sort(function (a, b) { return a.id - b.id || a._i - b._i; });

    var byId = {}, atts = {}, done = {};
    stmts.forEach(function (s) { if (!byId[s.id]) byId[s.id] = s; });
    function placed(s) { return s.place && byId[s.target] && s.target !== s.id; }
    stmts.forEach(function (s) {
      if (placed(s)) (atts[s.target] = atts[s.target] || []).push(s);
    });

    function compose(s) {
      done[s._i] = true;
      var out = s.kind === 'img' ? renderImg(s) : renderText(s, fontsUsed, info);
      var list = (byId[s.id] === s && atts[s.id]) || [];
      list.forEach(function (a) {
        if (done[a._i]) return;
        var inner = compose(a);
        if (a.place === 'nextto') {
          var d = a.opts.direction || 'right', gap = a.opts.close || '16px';
          var col = d === 'up' || d === 'down', first = d === 'left' || d === 'up';
          out = '<div class="jet-group ' + (col ? 'jet-col' : 'jet-row') + '" style="gap:' + gap + '">' +
            (first ? inner + out : out + inner) + '</div>';
        } else if (a.place === 'above') out = inner + out;
        else out = out + inner;
      });
      return out;
    }

    var html = stmts.filter(function (s) { return !placed(s); }).map(compose);
    stmts.forEach(function (s) { if (!done[s._i]) html.push(compose(s)); }); // cycles / leftovers
    return html.join('\n');
  }

  // ---------- page: styles, fonts, config, fades ----------
  var CSS =
    ':root{color-scheme:light dark}' +
    'body{margin:0;font:18px/1.7 system-ui,sans-serif;background:#fff;color:#1a1a1a}' +
    '@media(prefers-color-scheme:dark){body{background:#121212;color:#e8e8e8}a{color:#8ab4ff}}' +
    '.jet-custom-bg a{color:inherit;text-decoration:underline}' +
    '.jet-page{max-width:42rem;margin:0 auto;padding:3.5rem 1.25rem 7rem}' +
    '.jet-page h1,.jet-page h2,.jet-page h3,.jet-page h4,.jet-page h5,.jet-page h6{line-height:1.25;margin:1.6em 0 .5em}' +
    '.jet-page p{margin:.8em 0}' +
    '.jet-page code{font-family:ui-monospace,monospace;background:rgba(128,128,128,.18);padding:.1em .35em;border-radius:4px;font-size:.9em}' +
    '.jet-img{margin:1.5rem auto;max-width:100%}' +
    '.jet-img.jet-left{margin-left:0}.jet-img.jet-right{margin-right:0}' +
    '.jet-img img{display:block;width:100%;height:auto;border-radius:6px}' +
    '.jet-img figcaption{font-size:.85em;opacity:.7;margin-top:.5rem;text-align:center}' +
    '.jet-capside,.jet-capcol{display:flex}.jet-capside{align-items:center}' +
    '.jet-capside img{flex:1 1 0;width:auto;min-width:0}' +
    '.jet-capside figcaption{flex:0 1 35%;margin:0;text-align:left}' +
    '.jet-capcol figcaption{margin:0}' +
    '.jet-group{display:flex;align-items:center;margin:1rem 0}' +
    '.jet-row{flex-direction:row}.jet-col{flex-direction:column;align-items:stretch}' +
    '.jet-group>:not(figure){flex:1 1 0;min-width:0;margin-top:0;margin-bottom:0}' +
    '.jet-col>:not(figure){flex:0 1 auto}' +
    '.jet-group>figure{margin:0;flex:0 0 auto}' +
    '@media(max-width:600px){.jet-row{flex-direction:column;align-items:stretch}.jet-group>figure{width:100%!important}}' +
    '.jet-fade{position:fixed;left:0;right:0;height:56px;pointer-events:none;z-index:50}' +
    '.jet-fade-top{top:0}.jet-fade-bottom{bottom:0;height:calc(56px + env(safe-area-inset-bottom,0px))}' +
    '.jet-error{color:#c0392b}';

  function injectStyle(css) {
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // fonts stored locally / in fonts/ (anything not declared with locnoneed-font)
  function loadFonts(names, skip) {
    var skipLow = skip.map(function (s) { return s.toLowerCase(); });
    var css = Object.keys(names).filter(function (n) {
      return skipLow.indexOf(n.toLowerCase()) < 0;
    }).map(function (name) {
      var f = FONT_DIR.replace(/\/?$/, '/') + encodeURIComponent(name), q = name.replace(/"/g, '');
      return '@font-face{font-family:"' + q + '";font-display:swap;src:' +
        'local("' + q + '"),' +
        'url("' + f + '.woff2") format("woff2"),' +
        'url("' + f + '.woff") format("woff"),' +
        'url("' + f + '.ttf") format("truetype"),' +
        'url("' + f + '.otf") format("opentype")}';
    }).join('');
    if (css) injectStyle(css);
  }

  // fonts declared with locnoneed-font<-"Name" come from Google Fonts on the fly
  function loadGoogleFonts(names) {
    if (!names.length) return;
    ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].forEach(function (h) {
      var p = document.createElement('link');
      p.rel = 'preconnect'; p.href = h;
      if (h.indexOf('gstatic') > -1) p.crossOrigin = '';
      document.head.appendChild(p);
    });
    names.forEach(function (name) {
      var base = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+');
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = base + ':ital,wght@0,400;0,700;1,400;1,700&display=swap';
      // some families have no bold/italic: retry with the plain regular weight
      l.onerror = function () { l.onerror = null; l.href = base + '&display=swap'; };
      document.head.appendChild(l);
    });
  }

  function cssToRgb(c) {
    var tmp = document.createElement('span');
    tmp.style.color = c;
    document.body.appendChild(tmp);
    var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(tmp).color);
    document.body.removeChild(tmp);
    return m ? m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
  }

  function applyConfig(cfg, mount) {
    var bg = cfg.background;
    if (bg) {
      document.documentElement.style.background = bg;
      document.body.style.background = bg;
      document.body.classList.add('jet-custom-bg');
      var rgb = hexToRgb(bg) || cssToRgb(bg);
      var dark = rgb ? luminance(rgb) < 0.179 : false;
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      if (!cfg.textColor) mount.style.color = dark ? '#f2f2f2' : '#1a1a1a'; // auto contrast
    }
    if (cfg.textColor) mount.style.color = cfg.textColor;
  }

  function bgRgb() {
    var els = [document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(els[i]).backgroundColor);
      if (m) {
        var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        if (p.length < 4 || p[3] > 0) return p.slice(0, 3);
      }
    }
    return [255, 255, 255];
  }

  // Gradient masks, tinted to the background, so text fades out at the top
  // (under a fixed/sticky <nav> or <header> if there is one) and bottom edge
  // of the screen instead of being cut off.
  function installFades() {
    var top = document.createElement('div'), bot = document.createElement('div');
    top.className = 'jet-fade jet-fade-top';
    bot.className = 'jet-fade jet-fade-bottom';
    top.setAttribute('aria-hidden', 'true');
    bot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(top);
    document.body.appendChild(bot);

    function update() {
      var c = bgRgb().join(',');
      top.style.background = 'linear-gradient(to bottom,rgba(' + c + ',1),rgba(' + c + ',0))';
      bot.style.background = 'linear-gradient(to top,rgba(' + c + ',1),rgba(' + c + ',0))';
      var off = 0, navs = document.querySelectorAll('nav,header');
      for (var i = 0; i < navs.length; i++) {
        var pos = getComputedStyle(navs[i]).position;
        if (pos === 'fixed' || pos === 'sticky') {
          var r = navs[i].getBoundingClientRect();
          if (r.top <= 2 && r.bottom > off && r.bottom < window.innerHeight / 2) off = r.bottom;
        }
      }
      top.style.top = off + 'px';
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('load', update);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', update);
    }
  }

  // ---------- boot ----------
  function boot() {
    var mount = document.getElementById('jetsam') || document.body;
    mount.classList.add('jet-page');
    injectStyle(CSS);

    function run(text) {
      var doc = parse(text), fonts = {}, info = {};
      mount.innerHTML = render(doc, fonts, info);
      applyConfig(doc.config, mount);
      loadGoogleFonts(doc.config.fonts);
      loadFonts(fonts, doc.config.fonts);
      if (info.title && !document.title) document.title = info.title;
      if (FADE) installFades();
    }

    var embedded = document.querySelector('script[type="text/jet"]');
    if (embedded) return run(embedded.textContent);

    fetch(SRC)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.text();
      })
      .then(run)
      .catch(function (e) {
        mount.innerHTML = '<p class="jet-error">Jetsam could not load <code>' + esc(SRC) +
          '</code> (' + esc(e.message || e) + '). If you opened this file directly, ' +
          'serve the folder with a local server, e.g. <code>python3 -m http.server</code>.</p>';
      });
  }

  var api = { parse: parse, render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.Jetsam = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
