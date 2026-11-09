/*! Jetsam v0.1 - a tiny engine for intro/blog pages. One file. Reads txt.jet. */
(function () {
  'use strict';

  var script = typeof document !== 'undefined' ? document.currentScript : null;
  var SRC = (script && script.dataset.src) || 'txt.jet';
  var FONT_DIR = (script && script.dataset.fonts) || 'fonts/';

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

  // ---------- statement parsers ----------
  function parseText(id, tk) {
    var segs = [], font = null;
    for (var i = 0; i < tk.length; i++) {
      var k = tk[i];
      if (k.t === 'word' && k.v.toLowerCase() === 'font') {
        if (tk[i + 1] && tk[i + 1].t === 'str') { font = tk[i + 1].v; i++; }
      } else if (k.t === 'str') {
        segs.push({ font: font, text: k.v });
      }
    }
    return { id: id, kind: 'text', segs: segs };
  }

  function parseOpts(raw) {
    var o = {}, m;
    if ((m = /size\s*[:=]\s*([\d.]+\s*(?:%|px|vw|em|rem)?)/i.exec(raw))) o.size = m[1].replace(/\s+/g, '');
    if ((m = /caption\s*[:=]?\s*"((?:[^"\\]|\\.)*)"/i.exec(raw))) o.caption = m[1].replace(/\\(.)/g, '$1');
    if ((m = /alt\s*[:=]?\s*"((?:[^"\\]|\\.)*)"/i.exec(raw))) o.alt = m[1].replace(/\\(.)/g, '$1');
    if ((m = /align\s*[:=]\s*(left|right|center)/i.exec(raw))) o.align = m[1].toLowerCase();
    return o;
  }

  function parseImg(id, tk) {
    var img = { id: id, kind: 'img', url: '', place: null, target: null, opts: {} };
    for (var i = 1; i < tk.length; i++) {
      var k = tk[i];
      if (k.t === 'str' && !img.url) img.url = k.v;
      else if (k.t === 'opts') img.opts = parseOpts(k.v);
      else if (k.t === 'word' && /^(below|above)$/i.test(k.v)) {
        var nx = tk[i + 1], m = nx && nx.t === 'word' && /^s?(\d+)$/i.exec(nx.v);
        if (m) { img.place = k.v.toLowerCase(); img.target = +m[1]; i++; }
      }
    }
    return img;
  }

  function parse(text) {
    var stmts = [], auto = 0;
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.slice(0, 2) === '//') return;
      var m = /^(\d+)\s+(.*)$/.exec(line), id, body;
      if (m) { id = +m[1]; body = m[2]; auto = id; } else { id = ++auto; body = line; }
      var tk = tokenize(body);
      if (!tk.length) return;
      if (tk[0].t === 'word' && tk[0].v.toLowerCase() === 'img') stmts.push(parseImg(id, tk));
      else stmts.push(parseText(id, tk));
    });
    return stmts;
  }

  // ---------- renderer ----------
  function renderText(st, fontsUsed, info) {
    if (!st.segs.length) return '';
    var level = 0;
    var first = /^(#{1,6})\s*([\s\S]*)$/.exec(st.segs[0].text);
    var html = st.segs.map(function (seg, idx) {
      var text = seg.text;
      if (idx === 0 && first) { level = first[1].length; text = first[2]; }
      else text = text.replace(/^#{1,6}\s*/, '');
      var style = '';
      if (seg.font) {
        fontsUsed[seg.font] = true;
        style = ' style="font-family:&quot;' + esc(seg.font) + '&quot;,system-ui,sans-serif"';
      }
      return '<span' + style + '>' + inline(text) + '</span>';
    }).join('');
    if (level && !info.title) info.title = st.segs[0].text.replace(/^#{1,6}\s*/, '').trim();
    var tag = level ? 'h' + level : 'p';
    return '<' + tag + '>' + html + '</' + tag + '>';
  }

  function renderImg(im) {
    var url = safeUrl(im.url);
    if (!url) return '';
    var o = im.opts, style = '';
    if (o.size) style += 'width:' + (/^[\d.]+$/.test(o.size) ? o.size + 'px' : o.size) + ';';
    var cls = 'jet-img' + (o.align ? ' jet-' + o.align : '');
    return '<figure class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' +
      '<img src="' + esc(url) + '" alt="' + esc(o.alt || o.caption || '') + '" loading="lazy">' +
      (o.caption ? '<figcaption>' + inline(o.caption) + '</figcaption>' : '') +
      '</figure>';
  }

  function render(stmts, fontsUsed, info) {
    fontsUsed = fontsUsed || {};
    info = info || {};
    stmts = stmts.map(function (s, i) { s._i = i; return s; })
      .sort(function (a, b) { return a.id - b.id || a._i - b._i; });

    var ids = {};
    stmts.forEach(function (s) { if (s.kind === 'text' && ids[s.id] == null) ids[s.id] = true; });

    var before = {}, after = {}, main = [];
    stmts.forEach(function (s) {
      if (s.kind === 'img' && s.place && ids[s.target]) {
        var bucket = s.place === 'above' ? before : after;
        (bucket[s.target] = bucket[s.target] || []).push(s);
      } else main.push(s);
    });

    return main.map(function (s) {
      if (s.kind === 'img') return renderImg(s);
      return (before[s.id] || []).map(renderImg).join('') +
        renderText(s, fontsUsed, info) +
        (after[s.id] || []).map(renderImg).join('');
    }).join('\n');
  }

  var CSS =
    ':root{color-scheme:light dark}' +
    'body{margin:0;font:18px/1.7 system-ui,sans-serif;background:#fff;color:#1a1a1a}' +
    '@media(prefers-color-scheme:dark){body{background:#121212;color:#e8e8e8}a{color:#8ab4ff}}' +
    '.jet-page{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}' +
    '.jet-page h1,.jet-page h2,.jet-page h3,.jet-page h4,.jet-page h5,.jet-page h6{line-height:1.25;margin:1.6em 0 .5em}' +
    '.jet-page p{margin:.8em 0}' +
    '.jet-page code{font-family:ui-monospace,monospace;background:rgba(128,128,128,.18);padding:.1em .35em;border-radius:4px;font-size:.9em}' +
    '.jet-img{margin:1.5rem auto;max-width:100%}' +
    '.jet-img.jet-left{margin-left:0}.jet-img.jet-right{margin-right:0}' +
    '.jet-img img{display:block;width:100%;height:auto;border-radius:6px}' +
    '.jet-img figcaption{font-size:.85em;opacity:.7;margin-top:.5rem;text-align:center}' +
    '.jet-error{color:#c0392b}';

  function injectStyle(css) {
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  function loadFonts(names) {
    var css = Object.keys(names).map(function (name) {
      var f = FONT_DIR.replace(/\/?$/, '/') + encodeURIComponent(name);
      return '@font-face{font-family:"' + name.replace(/"/g, '') + '";font-display:swap;src:' +
        'local("' + name.replace(/"/g, '') + '"),' +
        'url("' + f + '.woff2") format("woff2"),' +
        'url("' + f + '.woff") format("woff"),' +
        'url("' + f + '.ttf") format("truetype"),' +
        'url("' + f + '.otf") format("opentype")}';
    }).join('');
    if (css) injectStyle(css);
  }

  // ---------- boot ----------
  function boot() {
    var mount = document.getElementById('jetsam') || document.body;
    mount.classList.add('jet-page');
    injectStyle(CSS);

    function run(text) {
      var fonts = {}, info = {};
      mount.innerHTML = render(parse(text), fonts, info);
      loadFonts(fonts);
      if (info.title && !document.title) document.title = info.title;
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
