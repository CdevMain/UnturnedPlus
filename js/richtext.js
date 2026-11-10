// ============================================================
// richtext.js — Renderiza o RICH TEXT do Unturned como HTML.
//
// O Unturned usa o rich text do TextMesh Pro (Unity) na descrição
// do servidor, em placas, no chat e nos nomes. É por isso que a
// descrição chega assim:
//
//   <b><color=#00ff00><size=25>Лучший СНГ сервер </color>
//   <color=#00ffff>с тематикой PVP!</color></size></b>
//
// ...e o app antes mostrava esse texto CRU na tela.
//
// DETALHE QUE IMPORTA: o TextMesh Pro NÃO trata as tags como uma
// árvore aninhada. Cada atributo (cor, tamanho, negrito...) tem a
// sua PRÓPRIA pilha. No exemplo acima o `</color>` fecha só a cor —
// o `<size=25>` continua valendo no segundo trecho, mesmo o
// `</size>` aparecendo "fora de ordem" no final.
//
// Por isso aqui NÃO montamos spans aninhados espelhando as tags.
// Mantemos uma pilha por atributo e emitimos um <span> por trecho
// de texto, com o estilo calculado naquele ponto. O resultado é
// idêntico ao do jogo e é imune a tags mal fechadas — que são a
// regra, não a exceção, em descrição de servidor.
//
// Referências:
//   https://docs.smartlydressedgames.com/en/stable/data/rich-text.html
//   https://unturned.wiki.gg/wiki/Rich_text
// ============================================================

const RichText = (() => {
  'use strict';

  // Cores nomeadas do Unity/TMP (as que <color=nome> aceita).
  const NAMED_COLORS = {
    aqua: '#00ffff', black: '#000000', blue: '#0000ff', brown: '#a52a2a',
    cyan: '#00ffff', darkblue: '#0000a0', fuchsia: '#ff00ff', green: '#008000',
    grey: '#808080', gray: '#808080', lightblue: '#add8e6', lime: '#00ff00',
    magenta: '#ff00ff', maroon: '#800000', navy: '#000080', olive: '#808000',
    orange: '#ffa500', purple: '#800080', red: '#ff0000', silver: '#c0c0c0',
    teal: '#008080', white: '#ffffff', yellow: '#ffff00'
  };

  // Tags que existem no TMP mas não têm efeito visual útil aqui.
  // São consumidas (não viram texto na tela) e ignoradas.
  const IGNORED = new Set([
    'font', 'material', 'style', 'link', 'nobr', 'page', 'sprite', 'space',
    'cspace', 'line-height', 'lineheight', 'indent', 'margin', 'pos',
    'voffset', 'width', 'gradient', 'mspace'
  ]);

  const BOOLEAN_TAGS = { b: 'b', i: 'i', s: 's', strike: 's', u: 'u', sub: 'sub', sup: 'sup' };
  const CASE_TAGS = { allcaps: 'upper', uppercase: 'upper', lowercase: 'lower', smallcaps: 'small' };

  const DEFAULTS = {
    baseSize: 14,     // "tamanho 1x": <size=14> não muda nada
    minScale: 0.72,   // trava de baixo — texto minúsculo fica ilegível
    maxScale: 2.0,    // trava de cima — <size=90> não pode explodir o layout
    allowMark: true,
    allowRotate: true,
    singleLine: false // true: <br> e quebras viram espaço (para cards)
  };

  // ---------------- utilidades ----------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Aceita #rgb, #rgba, #rrggbb, #rrggbbaa ou nome.
  function parseColor(value) {
    if (!value) return null;
    let v = String(value).trim().toLowerCase();
    if (NAMED_COLORS[v]) v = NAMED_COLORS[v];
    if (v[0] !== '#') return null;
    const hex = v.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;

    const exp = (c) => c + c;
    let r, g, b, a = 'ff';
    if (hex.length === 3 || hex.length === 4) {
      r = exp(hex[0]); g = exp(hex[1]); b = exp(hex[2]);
      if (hex.length === 4) a = exp(hex[3]);
    } else if (hex.length === 6 || hex.length === 8) {
      r = hex.slice(0, 2); g = hex.slice(2, 4); b = hex.slice(4, 6);
      if (hex.length === 8) a = hex.slice(6, 8);
    } else {
      return null;
    }
    return {
      r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16),
      a: parseInt(a, 16) / 255
    };
  }

  function cssColor(c, alphaOverride) {
    const a = alphaOverride != null ? alphaOverride : c.a;
    return a >= 0.999
      ? `rgb(${c.r},${c.g},${c.b})`
      : `rgba(${c.r},${c.g},${c.b},${Math.round(a * 1000) / 1000})`;
  }

  // Luminância relativa — usada só para decidir se o texto precisa
  // de um halo claro para continuar legível no tema escuro.
  function luminance(c) {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  // <size=25> | <size=+4> | <size=-2> | <size=120%> | <size=1.5em>
  function parseSize(value, opt) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    let scale = null;

    let m = /^([+-]?\d*\.?\d+)%$/.exec(v);
    if (m) scale = parseFloat(m[1]) / 100;

    if (scale == null) {
      m = /^([+-]?\d*\.?\d+)em$/.exec(v);
      if (m) scale = parseFloat(m[1]);
    }
    if (scale == null) {
      m = /^([+-])(\d*\.?\d+)(?:px)?$/.exec(v);
      if (m) {
        const delta = parseFloat(m[2]) * (m[1] === '-' ? -1 : 1);
        scale = (opt.baseSize + delta) / opt.baseSize;
      }
    }
    if (scale == null) {
      m = /^(\d*\.?\d+)(?:px)?$/.exec(v);
      if (m) scale = parseFloat(m[1]) / opt.baseSize;
    }
    if (scale == null || !Number.isFinite(scale) || scale <= 0) return null;
    return Math.min(opt.maxScale, Math.max(opt.minScale, scale));
  }

  // ---------------- tokenizador ----------------
  // Devolve [{ type:'text', value } | { type:'tag', name, value, closing }]
  function tokenize(input) {
    const tokens = [];
    const src = String(input);
    let i = 0;
    let buf = '';
    const flush = () => { if (buf) { tokens.push({ type: 'text', value: buf }); buf = ''; } };

    while (i < src.length) {
      const ch = src[i];
      if (ch !== '<') { buf += ch; i++; continue; }

      const end = src.indexOf('>', i + 1);
      // "<" solto no fim do texto: é texto mesmo.
      if (end < 0) { buf += src.slice(i); break; }

      const inner = src.slice(i + 1, end);
      // Tag vazia "<>" ou com espaço logo no início não é tag no TMP.
      if (!inner || /^\s/.test(inner)) { buf += src.slice(i, end + 1); i = end + 1; continue; }

      const closing = inner[0] === '/';
      const body = closing ? inner.slice(1) : inner;

      // <#rrggbb> — atalho de cor
      if (body[0] === '#') {
        flush();
        tokens.push({ type: 'tag', name: 'color', value: body, closing, raw: src.slice(i, end + 1) });
        i = end + 1;
        continue;
      }

      const eq = body.indexOf('=');
      const name = (eq >= 0 ? body.slice(0, eq) : body).trim().toLowerCase();
      let value = eq >= 0 ? body.slice(eq + 1).trim() : null;
      if (value && value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
        value = value.slice(1, -1);
      }

      // Nome de tag precisa parecer nome de tag.
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
        buf += src.slice(i, end + 1);
        i = end + 1;
        continue;
      }

      flush();
      tokens.push({ type: 'tag', name, value, closing, raw: src.slice(i, end + 1) });
      i = end + 1;
    }
    flush();
    return tokens;
  }

  // ---------------- estado por atributo ----------------
  function newState() {
    return {
      color: [], size: [], mark: [], alpha: [], align: [], case: [], rotate: [],
      b: 0, i: 0, s: 0, u: 0, sub: 0, sup: 0
    };
  }

  const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
  const pop = (arr) => { if (arr.length) arr.pop(); };

  // Traduz o estado atual em CSS inline para um trecho de texto.
  function styleFor(st, opt) {
    const css = [];
    const classes = ['urt'];

    const alpha = last(st.alpha);
    const col = last(st.color);
    if (col) {
      css.push(`color:${cssColor(col, alpha != null ? alpha * col.a : null)}`);
      if (luminance(col) < 0.16) classes.push('urt-dark');
    } else if (alpha != null) {
      css.push(`opacity:${Math.round(alpha * 100) / 100}`);
    }

    const size = last(st.size);
    if (size) css.push(`font-size:${Math.round(size * 1000) / 1000}em`);

    if (opt.allowMark) {
      const mk = last(st.mark);
      if (mk) css.push(`background-color:${cssColor(mk)}`);
    }

    if (st.b > 0) css.push('font-weight:700');
    if (st.i > 0) css.push('font-style:italic');

    const deco = [];
    if (st.u > 0) deco.push('underline');
    if (st.s > 0) deco.push('line-through');
    if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);

    if (st.sub > 0) { css.push('vertical-align:sub'); css.push('font-size:.7em'); }
    else if (st.sup > 0) { css.push('vertical-align:super'); css.push('font-size:.7em'); }

    const cs = last(st.case);
    if (cs === 'upper') css.push('text-transform:uppercase');
    else if (cs === 'lower') css.push('text-transform:lowercase');
    else if (cs === 'small') css.push('font-variant:small-caps');

    const al = last(st.align);
    if (al) css.push(`display:inline-block;width:100%;text-align:${al}`);

    if (opt.allowRotate) {
      const rot = last(st.rotate);
      if (rot) css.push(`display:inline-block;transform:rotate(${rot}deg)`);
    }

    return { css: css.join(';'), cls: classes.join(' ') };
  }

  // ---------------- conversão principal ----------------
  function toHtml(input, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    if (input == null || input === '') return '';

    const tokens = tokenize(String(input));
    const st = newState();
    const out = [];
    let noparse = false;

    const emitText = (raw) => {
      if (!raw) return;
      // "\n" literal (dois caracteres) aparece em config de servidor.
      let text = raw.replace(/\\n/g, '\n');
      let html = escapeHtml(text);
      html = opt.singleLine
        ? html.replace(/\s*\n\s*/g, ' ')
        : html.replace(/\n/g, '<br>');
      if (!html) return;
      const { css, cls } = styleFor(st, opt);
      out.push(css ? `<span class="${cls}" style="${css}">${html}</span>` : html);
    };

    for (const tk of tokens) {
      if (noparse) {
        if (tk.type === 'tag' && tk.closing && tk.name === 'noparse') { noparse = false; continue; }
        emitText(tk.type === 'text' ? tk.value : tk.raw);
        continue;
      }

      if (tk.type === 'text') { emitText(tk.value); continue; }

      const { name, value, closing } = tk;

      if (name === 'noparse') { if (!closing) noparse = true; continue; }
      if (name === 'br') { out.push(opt.singleLine ? ' ' : '<br>'); continue; }
      if (IGNORED.has(name)) continue;

      if (BOOLEAN_TAGS[name]) {
        const k = BOOLEAN_TAGS[name];
        if (closing) st[k] = Math.max(0, st[k] - 1); else st[k] += 1;
        continue;
      }
      if (CASE_TAGS[name]) {
        if (closing) pop(st.case); else st.case.push(CASE_TAGS[name]);
        continue;
      }

      switch (name) {
        case 'color': {
          if (closing) { pop(st.color); break; }
          const c = parseColor(value);
          // <color=lixo> no TMP não colore nada, mas também não vira
          // texto: empilhamos a cor atual para o </color> casar.
          st.color.push(c || last(st.color) || null);
          break;
        }
        case 'size': {
          if (closing) { pop(st.size); break; }
          const s = parseSize(value, opt);
          st.size.push(s || last(st.size) || null);
          break;
        }
        case 'mark': {
          if (closing) { pop(st.mark); break; }
          st.mark.push(parseColor(value) || { r: 255, g: 255, b: 0, a: 0.25 });
          break;
        }
        case 'alpha': {
          if (closing) { pop(st.alpha); break; }
          const m = /^#?([0-9a-f]{2})$/i.exec(String(value || '').trim());
          st.alpha.push(m ? parseInt(m[1], 16) / 255 : 1);
          break;
        }
        case 'align': {
          if (closing) { pop(st.align); break; }
          const v = String(value || '').trim().toLowerCase();
          st.align.push(['left', 'right', 'center', 'justified'].includes(v)
            ? (v === 'justified' ? 'justify' : v) : 'left');
          break;
        }
        case 'rotate': {
          if (closing) { pop(st.rotate); break; }
          const n = parseFloat(value);
          st.rotate.push(Number.isFinite(n) ? Math.max(-90, Math.min(90, n)) : 0);
          break;
        }
        default:
          // Tag desconhecida: o TMP mostra literalmente. Fazemos igual,
          // assim um servidor que escreveu "<3" continua legível.
          emitText(tk.raw);
          break;
      }
    }

    return out.join('');
  }

  // Texto puro — para busca, tooltips e title="".
  function toPlain(input) {
    if (input == null) return '';
    const tokens = tokenize(String(input));
    let out = '';
    let noparse = false;
    for (const tk of tokens) {
      if (noparse) {
        if (tk.type === 'tag' && tk.closing && tk.name === 'noparse') { noparse = false; continue; }
        out += tk.type === 'text' ? tk.value : tk.raw;
        continue;
      }
      if (tk.type === 'text') { out += tk.value.replace(/\\n/g, '\n'); continue; }
      if (tk.name === 'noparse') { if (!tk.closing) noparse = true; continue; }
      if (tk.name === 'br') { out += '\n'; continue; }
      if (IGNORED.has(tk.name) || BOOLEAN_TAGS[tk.name] || CASE_TAGS[tk.name]) continue;
      if (['color', 'size', 'mark', 'alpha', 'align', 'rotate'].includes(tk.name)) continue;
      out += tk.raw; // desconhecida: literal, igual ao toHtml
    }
    return out.replace(/[ \t]+/g, ' ').trim();
  }

  // Escreve direto num elemento (evita innerHTML espalhado pelo app).
  function render(el, input, options) {
    if (!el) return;
    const html = toHtml(input, options);
    el.innerHTML = html || '';
    el.classList.toggle('urt-empty', !html);
    const plain = toPlain(input);
    if (plain) el.setAttribute('title', plain);
    else el.removeAttribute('title');
    return el;
  }

  return { toHtml, toPlain, render, tokenize, parseColor, parseSize, NAMED_COLORS, escapeHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RichText;
