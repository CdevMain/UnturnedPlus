// ============================================================
// i18n.js — carregamento e aplicação de idiomas
// ============================================================
const I18N = {
  strings: {},
  lang: 'pt-BR',

  // O arquivo de idioma é lido pelo PROCESSO PRINCIPAL (fs), não por
  // fetch: numa página file:// o Chromium bloqueia fetch de arquivo
  // local, e o app acabava mostrando as chaves cruas ("card.copied")
  // no lugar do texto. O fetch fica como último recurso.
  async load(lang) {
    this.lang = lang || 'pt-BR';
    this.strings = {};
    try {
      if (window.api && window.api.loadLanguage) {
        this.strings = (await window.api.loadLanguage(this.lang)) || {};
      }
    } catch (e) {
      console.warn('Falha ao carregar idioma pelo processo principal:', e);
    }
    if (!Object.keys(this.strings).length) {
      try {
        const res = await fetch(`languages/${this.lang}.json`);
        this.strings = await res.json();
      } catch (e) {
        console.error('Falha ao carregar idioma:', e);
        this.strings = {};
      }
    }
    this.apply();
  },

  t(key, vars = {}) {
    // `|| key` trocava uma tradução VAZIA DE PROPÓSITO pelo nome da
    // chave — e a chave aparecia na tela ("net.off"). String vazia é
    // uma tradução legítima: quer dizer "não mostre nada aqui".
    // Só cai no nome da chave quando a chave realmente não existe.
    const bruto = this.strings[key];
    let s = (bruto === undefined || bruto === null) ? key : String(bruto);
    Object.entries(vars).forEach(([k, v]) => {
      s = s.split(`{${k}}`).join(v);
    });
    return s;
  },

  apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const txt = this.t(el.dataset.i18n);
      // Botão com ícone: o ícone é FILHO deste elemento, e
      // `textContent = ...` apagaria ele junto com o texto antigo.
      // Acontecia a cada troca de idioma e na primeira pintura —
      // o botão nascia com ícone e ficava sem ele um instante
      // depois, sem nada no código dizendo por quê.
      const ico = el.querySelector(':scope > [data-icon], :scope > svg.ico');
      if (ico) {
        el.textContent = '';
        el.appendChild(ico);
        el.appendChild(document.createTextNode(' ' + txt));
        return;
      }
      el.textContent = txt;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPh);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.dataset.i18nTitle);
    });
  }
};
