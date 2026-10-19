(() => {
  'use strict';

  const VERSION = '1.3.0';
  const LOCK_AFTER_MS = 3 * 60 * 1000;

  /* ================= armazenamento local ================= */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('caixa.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('caixa.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem('caixa.' + k); } catch (e) { /* ignore */ } }
  };

  const S = {
    cfg: LS.get('cfg', null),
    data: LS.get('data', null),
    queue: LS.get('queue', []),
    lastSync: LS.get('lastSync', null),
    screen: 'inicio',
    statsTab: 'categorias',
    filtro: { q: '', tipo: 'todos' },
    mesSel: null,
    porMes: {},
    abertos: new Set(),
    syncing: false,
    gate: null,
    hiddenAt: null
  };

  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  const $sheet = document.getElementById('sheet-root');
  const $toast = document.getElementById('toast');

  /* ================= utilidades ================= */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = (n) => fmtBRL.format(Number(n) || 0);
  const brlShort = (n) => 'R$ ' + Math.round(Number(n) || 0).toLocaleString('pt-BR');
  const pct = (n) => (Number(n) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%';
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayIso = () => isoOf(new Date());
  const fromIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const monthName = (iso) => MESES[fromIso(iso).getMonth()];
  const monthShort = (iso) => { const d = fromIso(iso); return MES_CURTO[d.getMonth()] + '/' + String(d.getFullYear()).slice(2); };
  const monthStartIso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
  const dayLabel = (iso) => {
    const t = todayIso();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (iso === t) return 'Hoje';
    if (iso === isoOf(y)) return 'Ontem';
    const d = fromIso(iso);
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  };
  const uid = (p) => (p || '') + Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const parseMoney = (s) => {
    let v = String(s || '').replace(/\s|R\$/g, '');
    if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
  };
  const firstName = () => (S.cfg && S.cfg.nome ? S.cfg.nome.trim().split(/\s+/)[0] : '');

  /* ================= ícones ================= */
  const svg = (d, size) => `<svg width="${size || 22}" height="${size || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', s),
    sync: (s) => svg('<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1"/><path d="M18 3v4.5h-4.5M6 21v-4.5h4.5"/>', s),
    grid: (s) => svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>', s),
    list: (s) => svg('<path d="M4 7h16M4 12h16M4 17h10"/>', s),
    chart: (s) => svg('<path d="M6 20V11M12 20V5M18 20v-6"/>', s),
    cart: (s) => svg('<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>', s),
    fuel: (s) => svg('<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M5 10h10"/><path d="M15 8l3 3v6a1.5 1.5 0 0 0 3 0V9l-2-2"/>', s),
    receipt: (s) => svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>', s),
    bulb: (s) => svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>', s),
    close: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
    check: (s) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s),
    search: (s) => svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', s),
    home: (s) => svg('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', s),
    bolt: (s) => svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', s),
    paw: (s) => svg('<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M8 17c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.5-1.2 2.5-2.6 2.2-.9-.2-1-.4-1.4-.4s-.5.2-1.4.4C9.2 19.5 8 18.5 8 17z"/>', s),
    car: (s) => svg('<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M4 11h16"/><circle cx="8" cy="13.5" r="0.6"/><circle cx="16" cy="13.5" r="0.6"/>', s),
    book: (s) => svg('<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/>', s),
    star: (s) => svg('<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>', s),
    heart: (s) => svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>', s),
    card: (s) => svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>', s),
    tag: (s) => svg('<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.2"/>', s),
    lock: (s) => svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s),
    back: (s) => svg('<path d="M15 5l-7 7 7 7"/>', s),
    piggy: (s) => svg('<path d="M19 10.5c.8.3 1.5 1 1.5 2v1.5h-1.6a6.5 6.5 0 0 1-2.4 2.8V19h-2.5v-1.5h-4V19H7.5v-2.4A6 6 0 0 1 5 11.5C5 8.5 8 6 12 6c1.3 0 2.5.2 3.5.7L18 5.5v3z"/><circle cx="15.5" cy="10.5" r="0.7"/><path d="M3.5 10.5c0 1 .7 1.6 1.5 1.6"/>', s)
  };
  const CAT_ICON = {
    'Moradia': 'home', 'Contas da casa': 'bolt', 'Compras da casa': 'cart', 'Alimentação': 'cart', 'Pets': 'paw',
    'Transporte': 'car', 'Estudos': 'book', 'Lazer': 'star', 'Saúde': 'heart', 'Dívidas': 'card', 'Outros': 'tag'
  };
  const catIcon = (c) => (I[CAT_ICON[c]] || I.tag)(20);
  const BAR_COLORS = ['var(--lime)', 'var(--orange)', 'var(--yellow)', '#8FC7BA', '#3B3B38'];

  /* ================= dados derivados (aplica o que ainda não foi enviado) ================= */
  function view() {
    const d = S.data || {};
    const deletes = new Set(S.queue.filter((o) => o.op === 'deleteLancamento').map((o) => o.data.id));
    const pend = [];
    S.queue.forEach((o) => {
      if (o.op === 'addLancamento') pend.push(Object.assign({}, o.data, { id: o.id, minhaParte: o.data.tipo === 'Casa' ? o.data.valor * ((d.config && d.config.minhaParteCasa) || 0.5) : o.data.valor, pending: true }));
      if (o.op === 'addAbastecimento') pend.push({ id: 'AB-' + o.id, data: o.data.data, mes: monthStartIso(fromIso(o.data.data)), descricao: 'Abastecimento posto ' + o.data.posto, categoria: 'Transporte', tipo: 'Pessoal', forma: o.data.forma, valor: o.data.total, minhaParte: o.data.total, pending: true });
      if (o.op === 'addMercado') pend.push({ id: 'MK-' + o.id, data: o.data.data, mes: monthStartIso(fromIso(o.data.data)), descricao: 'Mercado ' + o.data.mercado, categoria: o.data.tipo === 'Casa' ? 'Compras da casa' : 'Alimentação', tipo: o.data.tipo, forma: o.data.forma, valor: o.data.valor, minhaParte: o.data.tipo === 'Casa' ? o.data.valor * 0.5 : o.data.valor, pending: true });
    });
    const lancamentos = pend.concat((d.lancamentos || []).filter((l) => !deletes.has(l.id)))
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

    const toggles = {};
    S.queue.forEach((o) => { if (o.op === 'toggleLista') toggles[o.data.id] = o.data.comprado; });
    const lista = (d.lista || []).map((it) => (it.id in toggles ? Object.assign({}, it, { comprado: toggles[it.id] }) : it));
    S.queue.forEach((o) => { if (o.op === 'addListaItem') lista.push({ id: o.id, produto: o.data.produto, quantidade: o.data.quantidade, categoria: o.data.categoria, comprado: o.id in toggles ? toggles[o.id] : false, pending: true }); });

    const cxBase = d.caixinha || { total: 0, movimentos: [] };
    const cxDel = new Set(S.queue.filter((o) => o.op === 'deleteCaixinha').map((o) => o.data.id));
    const cxPend = S.queue.filter((o) => o.op === 'addCaixinha').map((o) => ({ id: o.id, data: o.data.data, mes: monthStartIso(fromIso(o.data.data)), mov: o.data.mov, valor: o.data.valor, obs: o.data.obs, pending: true }));
    const sinal = (m) => (m.mov === 'Resgatar' ? -1 : 1);
    const removidos = cxBase.movimentos.filter((m) => cxDel.has(m.id));
    const caixinha = {
      total: Math.round((cxBase.total + cxPend.reduce((t, m) => t + sinal(m) * m.valor, 0) - removidos.reduce((t, m) => t + sinal(m) * m.valor, 0)) * 100) / 100,
      movimentos: cxPend.concat(cxBase.movimentos.filter((m) => !cxDel.has(m.id))).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)),
      ajuste: (mes) => cxPend.filter((m) => m.mes === mes && m.mov !== 'Saldo inicial').reduce((t, m) => t + sinal(m) * m.valor, 0) - removidos.filter((m) => m.mes === mes && m.mov !== 'Saldo inicial').reduce((t, m) => t + sinal(m) * m.valor, 0)
    };

    return { d, lancamentos, lista, caixinha };
  }

  /* ================= mês escolhido ================= */
  function mesesLista(d, lancamentos) {
    const set = new Set((d.meses || []).concat(lancamentos.map((l) => l.mes).filter(Boolean)));
    if (d.mes) set.add(d.mes);
    return Array.from(set).sort();
  }
  const mesAtivo = (d) => S.mesSel || d.mes;

  function dadosMes(d) {
    const m = mesAtivo(d);
    if (!m || m === d.mes) {
      let resumo = d.resumo;
      const aj = resumo ? view().caixinha.ajuste(d.mes) : 0;
      if (aj) resumo = Object.assign({}, resumo, { saldo: resumo.saldo - aj, guardadoMes: (resumo.guardadoMes || 0) + Math.max(0, aj), resgatadoMes: (resumo.resgatadoMes || 0) + Math.max(0, -aj) });
      return { mes: d.mes, resumo, categorias: d.categorias || [], separadas: d.separadas || [], itens: d.itens || [], atual: true };
    }
    const c = S.porMes[m];
    return c && c.data ? Object.assign({}, c.data, { atual: false }) : { mes: m, carregando: true, atual: false, categorias: [], separadas: [], itens: [] };
  }

  async function carregarMes(m, force) {
    if (!S.cfg || !m) return;
    const c = S.porMes[m];
    if (c && c.busy) return;
    if (!force && c && c.data && Date.now() - c.ts < 120000) return;
    S.porMes[m] = Object.assign({}, c, { busy: true });
    try {
      const res = await api({ action: 'mes', mes: m });
      S.porMes[m] = { data: res.data, ts: Date.now() };
    } catch (err) {
      if (c && c.data) S.porMes[m] = c; else delete S.porMes[m];
      toast(err.network ? 'Sem conexão para buscar esse mês.' : 'Não foi possível buscar o mês: ' + err.message);
      if (!(c && c.data) && S.mesSel === m) S.mesSel = null;
    }
    render();
  }

  function escolherMes(m) {
    S.mesSel = S.data && m === S.data.mes ? null : m;
    render();
    if (S.mesSel) carregarMes(m);
  }

  function mesLabel(iso, atualIso) {
    const d = fromIso(iso);
    const nome = MESES[d.getMonth()];
    return d.getFullYear() === fromIso(atualIso || todayIso()).getFullYear() ? nome : nome + ' de ' + d.getFullYear();
  }

  function mesChips(d, lancamentos) {
    const meses = mesesLista(d, lancamentos);
    const at = mesAtivo(d);
    return `<div class="chips scroll mes-chips" role="group" aria-label="Mês">${meses.map((m) => `<button class="chip" data-act="mes" data-arg="${m}" aria-pressed="${m === at}">${monthShort(m)}${m === d.mes ? ' <em>atual</em>' : ''}</button>`).join('')}</div>`;
  }

  const GRUPOS = ['Casa: contas fixas', 'Casa: gastos do mês', 'Pessoais: contas fixas', 'Pessoais: gastos do mês', 'Fatura Nubank', 'Parcelas de dívidas'];
  const GRUPO_NOME = { 'Casa: contas fixas': ['Contas fixas', 'Casa'], 'Casa: gastos do mês': ['Gastos do mês', 'Casa'], 'Pessoais: contas fixas': ['Contas fixas', 'Pessoais'], 'Pessoais: gastos do mês': ['Gastos do mês', 'Pessoais'] };
  const grupoTitulo = (g) => (GRUPO_NOME[g] ? GRUPO_NOME[g][0] : g);
  const grupoDono = (g) => (GRUPO_NOME[g] ? GRUPO_NOME[g][1] + ', ' : '');
  const grupoIcon = (g) => (/^Casa/.test(g) ? I.home : /^Fatura/.test(g) ? I.card : /dívidas/i.test(g) ? I.card : I.tag)(20);

  /** Tudo o que pesa no mês: fixas, parcelas e dívidas (da planilha) + lançamentos do mês. */
  function itensDoMes(dm, lancamentos) {
    const lanc = lancamentos.filter((l) => l.mes === dm.mes).map((l) => ({
      origem: 'Lançamento', id: l.id, data: l.data, pending: l.pending,
      grupo: l.forma === 'Nubank' ? 'Fatura Nubank' : l.tipo === 'Casa' ? 'Casa: gastos do mês' : 'Pessoais: gastos do mês',
      descricao: l.descricao, categoria: l.categoria || 'Sem categoria', tipo: l.tipo, forma: l.forma,
      valor: Number(l.valor) || 0, minhaParte: Number(l.minhaParte) || Number(l.valor) || 0
    }));
    return (dm.itens || []).concat(lanc);
  }

  function itemRow(it) {
    const sub = [it.origem === 'Lançamento' ? (it.data ? it.data.slice(8, 10) + '/' + it.data.slice(5, 7) : 'Lançamento') : it.origem, it.categoria, it.forma].filter(Boolean).join(', ');
    const parte = Math.abs(it.minhaParte - it.valor) > 0.009 ? `<small>de ${brl(it.valor)}</small>` : '';
    const inner = `<span class="row-main"><span>${it.pending ? '<i class="pending-dot" aria-label="aguardando envio"></i>' : ''}${esc(it.descricao)}</span><small>${esc(sub)}</small></span><span class="row-value">${brl(it.minhaParte)}${parte}</span>`;
    return it.origem === 'Lançamento' ? `<button class="row" data-act="lanc" data-id="${esc(it.id)}">${inner}</button>` : `<div class="row">${inner}</div>`;
  }

  function bloco(key, icon, titulo, sub, valor, itens) {
    const open = S.abertos.has(key) ? ' open' : '';
    const corpo = itens.length ? itens.sort((a, b) => b.minhaParte - a.minhaParte).map(itemRow).join('') : '<p class="hint xp-empty">Nenhum item detalhado.</p>';
    return `<details class="xp" data-key="${esc(key)}"${open}><summary class="row"><span class="row-icon">${icon}</span><span class="row-main"><span>${esc(titulo)}</span><small>${sub}</small></span><span class="row-value">${brl(valor)}</span><span class="xp-chev" aria-hidden="true"></span></summary><div class="xp-body">${corpo}</div></details>`;
  }

  function despesasSeparadas(dm, lancamentos, total) {
    const itens = itensDoMes(dm, lancamentos);
    const sep = dm.separadas && dm.separadas.length ? dm.separadas : GRUPOS.map((g) => ({ nome: g, valor: itens.filter((i) => i.grupo === g).reduce((s, i) => s + i.minhaParte, 0) }));
    const html = sep.map((g) => {
      const its = itens.filter((i) => i.grupo === g.nome);
      if (!(g.valor > 0) && !its.length) return '';
      const sub = `${grupoDono(g.nome)}${its.length} ${its.length === 1 ? 'item' : 'itens'}${total ? ', ' + pct(g.valor / total) : ''}`;
      return bloco('g:' + g.nome, grupoIcon(g.nome), grupoTitulo(g.nome), sub, g.valor, its);
    }).join('');
    return html || '<div class="empty">Nenhuma despesa neste mês.</div>';
  }

  /* ================= conversa com a planilha ================= */
  async function api(body) {
    let r;
    try {
      r = await fetch(S.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, body, { key: S.cfg.key })),
        redirect: 'follow'
      });
    } catch (e) {
      const err = new Error('Sem conexão'); err.network = true; throw err;
    }
    const j = await r.json().catch(() => null);
    if (!j) throw new Error('A planilha respondeu de um jeito inesperado');
    if (!j.ok) { const err = new Error(j.error || 'erro'); err.code = j.error; throw err; }
    return j;
  }

  async function sync(manual) {
    if (!S.cfg || S.syncing) return;
    S.syncing = true; paintSyncButton();
    const ops = S.queue.slice();
    try {
      const res = ops.length
        ? await api({ action: 'batch', ops: ops.map((o) => ({ op: o.op, id: o.id, data: o.data })) })
        : await api({ action: 'bootstrap' });
      if (ops.length) {
        const sent = new Set(ops.map((o) => o.id));
        S.queue = S.queue.filter((o) => !sent.has(o.id));
        const failed = (res.results || []).filter((x) => !x.ok);
        if (failed.length) toast(`${failed.length === 1 ? 'Um item não foi salvo' : failed.length + ' itens não foram salvos'}: ${failed[0].error}`);
        else if (ops.some((o) => o.op !== 'toggleLista')) toast(ops.length === 1 ? 'Salvo na planilha' : `${ops.length} itens salvos na planilha`);
      }
      S.data = res.data;
      S.lastSync = Date.now();
      LS.set('data', S.data); LS.set('queue', S.queue); LS.set('lastSync', S.lastSync);
      if (ops.length) Object.keys(S.porMes).forEach((m) => { if (S.porMes[m].data) S.porMes[m].ts = 0; });
      if (S.mesSel) setTimeout(() => carregarMes(S.mesSel), 0);
    } catch (err) {
      if (err.code === 'unauthorized') toast('A chave foi recusada. Abra as configurações e confira.');
      else if (err.code === 'blocked') toast('Acesso pausado por excesso de tentativas. Tente em 15 minutos.');
      else if (err.network) { if (manual) toast('Sem conexão. O que você lançar fica guardado e vai depois.'); }
      else toast('Não foi possível sincronizar: ' + err.message);
    } finally {
      S.syncing = false;
      render();
      const st = document.getElementById('sheet-title');
      if (st && st.textContent === 'Caixinha' && !document.getElementById('f-cx')) telaCaixinha();
    }
  }

  function enqueue(op, data, id) {
    const item = { op, id: id || uid(), data, ts: Date.now() };
    S.queue.push(item);
    LS.set('queue', S.queue);
    render();
    sync();
    return item;
  }

  /* ================= avisos ================= */
  let toastTimer = null;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.hidden = true; }, 3600);
  }
  function paintSyncButton() {
    document.querySelectorAll('[data-act="sync"]').forEach((b) => b.classList.toggle('spin', S.syncing));
  }

  /* ================= cálculo do período ================= */
  function periodo() {
    const cfg = (S.data && S.data.config) || { diaPagamento: 5, diaVale: 20, valorVale: 0, valorPagamento: 0 };
    const now = new Date();
    const dia = now.getDate();
    const dp = cfg.diaPagamento || 5;
    const dv = cfg.diaVale || 20;
    let atual, proximo, alvo;
    if (dia >= dp && dia < dv) {
      atual = 'pagamento'; proximo = 'vale'; alvo = new Date(now.getFullYear(), now.getMonth(), dv);
    } else {
      atual = 'vale'; proximo = 'pagamento';
      alvo = dia >= dv ? new Date(now.getFullYear(), now.getMonth() + 1, dp) : new Date(now.getFullYear(), now.getMonth(), dp);
    }
    const hoje = new Date(now.getFullYear(), now.getMonth(), dia);
    const dias = Math.round((alvo - hoje) / 86400000);
    return { atual, proximo, dias, alvo, valorProximo: proximo === 'vale' ? cfg.valorVale : cfg.valorPagamento };
  }

  function dica(r) {
    const p = periodo();
    const sobra = p.atual === 'pagamento' ? r.sobraPagamento : r.sobraVale;
    const quando = p.dias === 0 ? 'Hoje cai o ' + p.proximo : p.dias === 1 ? 'Amanhã cai o ' + p.proximo : `Faltam <strong>${p.dias} dias</strong> para o ${p.proximo}`;
    if (sobra < 0) return `${quando}. A sobra do ${p.atual} está negativa em ${brl(-sobra)}: segure tudo que não for essencial até lá.`;
    if (sobra < 200) return `${quando}. Com ${brlShort(sobra)} de sobra, segure o lazer até o dia ${p.alvo.getDate()}.`;
    return `${quando}. Ainda restam ${brlShort(sobra)} de sobra do ${p.atual} neste período.`;
  }

  /* ================= telas ================= */
  function topBar() {
    const nome = firstName();
    const hoje = new Date();
    return `<header class="top">
      <button class="avatar" data-act="settings" aria-label="Configurações">${esc((nome || 'C').charAt(0).toUpperCase())}</button>
      <div class="top-text"><small>${MESES[hoje.getMonth()].replace(/^./, (c) => c.toUpperCase())} de ${hoje.getFullYear()}</small><h1>${nome ? 'Olá, ' + esc(nome) : 'Seu caixa'}</h1></div>
      <button class="icon-btn${S.syncing ? ' spin' : ''}" data-act="sync" aria-label="Sincronizar">${I.sync(20)}</button>
    </header>`;
  }

  function pendingBanner() {
    if (!S.queue.length) return '';
    const n = S.queue.length;
    return `<div class="banner"><span class="pending-dot"></span><span>${n === 1 ? '1 item aguardando envio' : n + ' itens aguardando envio'}</span><button data-act="sync">Enviar agora</button></div>`;
  }

  function loading() {
    return `<div class="empty">Carregando seus números…</div>`;
  }

  function lancRow(l) {
    const sub = [l.categoria || 'Sem categoria', l.forma].filter(Boolean).join(', ');
    const parte = l.tipo === 'Casa' && l.minhaParte && Math.abs(l.minhaParte - l.valor) > 0.009 ? `<small>sua parte ${brl(l.minhaParte)}</small>` : '';
    return `<button class="row" data-act="lanc" data-id="${esc(l.id)}">
      <span class="row-icon">${catIcon(l.categoria)}</span>
      <span class="row-main"><span>${l.pending ? '<i class="pending-dot" aria-label="aguardando envio"></i>' : ''}${esc(l.descricao)}</span><small>${esc(sub)}</small></span>
      <span class="row-value">${brl(l.valor)}${parte}</span>
    </button>`;
  }

  function sobraTile(label, valor) {
    const cls = valor < 0 ? 'red' : valor < 200 ? 'orange' : 'lime';
    const nota = valor < 0 ? 'no vermelho' : valor < 200 ? 'abaixo de R$ 200' : '';
    return `<div class="tile ${cls}"><b>${label}</b><span><strong>${brl(valor)}</strong>${nota ? `<br><em>${nota}</em>` : ''}</span></div>`;
  }

  function telaInicio() {
    const { d, lancamentos, caixinha } = view();
    if (!d.resumo) return topBar() + pendingBanner() + loading();
    const dm = dadosMes(d);
    const chips = mesChips(d, lancamentos);
    if (dm.carregando) return `${topBar()}${pendingBanner()}${chips}<div class="empty">Buscando ${mesLabel(dm.mes, d.mes)} na planilha…</div>`;
    const r = dm.resumo;
    const p = periodo();
    const usado = r.receitas ? Math.min(1, r.despesas / r.receitas) : 0;
    const top = (dm.categorias || []).slice().sort((a, b) => b.valor - a.valor)[0];
    const chip = !dm.atual ? (dm.mes > d.mes ? 'Previsão' : 'Mês fechado') : p.dias === 0 ? `${p.proximo === 'vale' ? 'Vale' : 'Pagamento'} hoje` : `${p.proximo === 'vale' ? 'Vale' : 'Pagamento'} em ${p.dias} dia${p.dias === 1 ? '' : 's'}`;
    const doMes = lancamentos.filter((l) => l.mes === dm.mes);
    const recentes = doMes.slice(0, 5);
    const sep = (dm.separadas || []).filter((g) => g.valor > 0);
    const guardLiq = Math.round(((r.guardadoMes || 0) - (r.resgatadoMes || 0)) * 100) / 100;
    const cxSub = guardLiq > 0 ? `${brl(guardLiq)} guardados em ${monthName(dm.mes)}` : guardLiq < 0 ? `${brl(-guardLiq)} resgatados em ${monthName(dm.mes)}` : `Nada guardado em ${monthName(dm.mes)}`;
    return `${topBar()}${pendingBanner()}${chips}
    <div class="home"><div class="home-main">
    <section class="balance" aria-label="Saldo do mês">
      <div class="balance-head"><span>Saldo de ${mesLabel(dm.mes, d.mes)}</span><span class="pill">${chip}</span></div>
      <span class="balance-value${r.saldo < 0 ? ' neg' : ''}">${brl(r.saldo)}</span>
      <div class="bar${usado > 0.9 ? ' warn' : ''}" role="img" aria-label="${pct(usado)} da renda comprometida"><i style="width:${(usado * 100).toFixed(1)}%"></i></div>
      <div class="balance-foot"><span>Receitas <strong>${brl(r.receitas)}</strong></span><span>Despesas <strong>${brl(r.despesas)}</strong></span>${guardLiq ? `<span>${guardLiq > 0 ? 'Guardado' : 'Resgatado'} <strong>${brl(Math.abs(guardLiq))}</strong></span>` : ''}</div>
    </section>
    ${dm.atual ? `<div class="actions">
      <button class="action main" data-act="novo-lanc"><span>${I.plus(24)}</span>Lançar</button>
      <button class="action" data-act="novo-abast"><span>${I.fuel()}</span>Abastecer</button>
      <button class="action" data-act="novo-mercado"><span>${I.receipt()}</span>Mercado</button>
      <button class="action" data-act="go" data-arg="lista"><span>${I.cart()}</span>Lista</button>
    </div>` : ''}
    <div class="tiles">
      ${sobraTile('Sobra do pagamento', r.sobraPagamento)}
      ${sobraTile('Sobra do vale', r.sobraVale)}
      <div class="tile"><b>Fatura Nubank</b><strong>${brl(r.fatura)}</strong></div>
      <div class="tile yellow"><b>Maior gasto</b><span><strong>${top ? esc(top.nome) : '—'}</strong>${top ? `<br><em>${brl(top.valor)}, ${pct(r.despesas ? top.valor / r.despesas : 0)}</em>` : ''}</span></div>
    </div>
    <div class="card cx-card"><button class="row" data-act="caixinha"><span class="row-icon lime">${I.piggy(20)}</span><span class="row-main"><span>Caixinha</span><small>${cxSub}</small></span><span class="row-value">${brl(caixinha.total)}<small>guardado no total</small></span></button></div>
    ${sep.length ? `<div class="section-head"><h2>Despesas separadas</h2><button class="link" data-act="go" data-arg="estatisticas">Detalhar</button></div>
    <div class="card">${sep.map((g) => `<button class="row" data-act="ver-grupo" data-arg="${esc(g.nome)}"><span class="row-icon">${grupoIcon(g.nome)}</span><span class="row-main"><span>${esc(grupoTitulo(g.nome))}</span><small>${grupoDono(g.nome)}${pct(r.despesas ? g.valor / r.despesas : 0)} das despesas</small></span><span class="row-value">${brl(g.valor)}</span></button>`).join('')}</div>` : ''}
    ${dm.atual ? `<div class="tip">${I.bulb()}<p>${dica(r)}</p></div>` : ''}
    ${r.acertoLabel ? `<div class="card"><div class="row"><span class="row-icon">${I.home(20)}</span><span class="row-main"><span>${esc(r.acertoLabel)}</span><small>Acerto da casa em ${mesLabel(dm.mes, d.mes)}</small></span><span class="row-value">${brl(r.acertoValor)}</span></div></div>` : ''}
    </div><aside class="home-side">
    <div class="section-head"><h2>${dm.atual ? 'Últimos lançamentos' : 'Lançamentos de ' + monthName(dm.mes)}</h2><button class="link" data-act="go" data-arg="lancamentos">Ver todos</button></div>
    <div class="card">${recentes.length ? recentes.map(lancRow).join('') : '<div class="empty">Nada lançado neste mês.</div>'}</div>
    </aside></div>`;
  }

  function telaLancamentos() {
    const { d, lancamentos } = view();
    const mes = mesAtivo(d);
    const q = S.filtro.q.trim().toLowerCase();
    const TIPOS = [['todos', 'Tudo'], ['Casa', 'Casa'], ['Pessoal', 'Pessoais'], ['Nubank', 'Nubank']];
    const okTipo = (l) => S.filtro.tipo === 'todos' || (S.filtro.tipo === 'Nubank' ? l.forma === 'Nubank' : l.tipo === S.filtro.tipo);
    const lista = lancamentos.filter((l) => (!mes || l.mes === mes) && okTipo(l) && (!q || (l.descricao + ' ' + l.categoria + ' ' + (l.obs || '')).toLowerCase().includes(q)));
    const total = lista.reduce((s, l) => s + (Number(l.minhaParte) || Number(l.valor) || 0), 0);
    let html = `<header class="top"><h1 class="page-title">Lançamentos</h1><button class="icon-btn" data-act="novo-lanc" aria-label="Novo lançamento">${I.plus(20)}</button></header>
      <label class="search">${I.search(18)}<span class="sr">Buscar</span><input type="search" id="busca" placeholder="Buscar por descrição ou categoria" value="${esc(S.filtro.q)}"></label>
      ${mesChips(d, lancamentos)}
      <div class="seg" role="group" aria-label="Tipo de despesa">${TIPOS.map(([k, label]) => `<button data-act="filtro-tipo" data-arg="${k}" aria-pressed="${S.filtro.tipo === k}">${label}</button>`).join('')}</div>`;
    if (!lista.length) return html + `<div class="empty">${q ? 'Nenhum lançamento encontrado para essa busca.' : S.filtro.tipo !== 'todos' ? 'Nenhum lançamento desse tipo neste mês.' : 'Nenhum lançamento neste mês.'}<br><button class="btn dark" data-act="novo-lanc">Lançar um gasto</button></div>`;
    html += `<p class="hint">${lista.length} lançamento${lista.length === 1 ? '' : 's'}, sua parte somando ${brl(total)}</p>`;
    html += `<div class="ltable-wrap"><table class="ltable"><thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col">Forma</th><th scope="col" class="num">Valor</th><th scope="col" class="num">Sua parte</th></tr></thead><tbody>${lista.map((l) => `<tr data-act="lanc" data-id="${esc(l.id)}" tabindex="0"><td>${l.data ? l.data.slice(8, 10) + '/' + l.data.slice(5, 7) : ''}</td><td>${l.pending ? '<i class="pending-dot" aria-label="aguardando envio"></i>' : ''}${esc(l.descricao)}</td><td>${esc(l.categoria || 'Sem categoria')}</td><td>${esc(l.forma || '')}</td><td class="num">${brl(l.valor)}</td><td class="num">${brl(l.minhaParte || l.valor)}</td></tr>`).join('')}</tbody></table></div><div class="lgroups">`;
    let dia = null;
    let open = false;
    lista.forEach((l) => {
      if (l.data !== dia) {
        if (open) html += '</div>';
        dia = l.data;
        html += `<div class="day-label">${dayLabel(dia)}</div><div class="card">`;
        open = true;
      }
      html += lancRow(l);
    });
    if (open) html += '</div>';
    html += '</div>';
    return html;
  }

  function colsChart(meses, key, nowIso) {
    const ult = meses.slice(-6);
    if (!ult.length) return '';
    const max = Math.max.apply(null, ult.map((m) => m[key])) || 1;
    return `<div class="cols" role="img" aria-label="Gasto por mês">${ult.map((m) => `<div class="col${m.mes === nowIso ? ' now' : ''}"><b>${brlShort(m[key])}</b><i style="height:${Math.max(4, (m[key] / max) * 100)}px"></i><small>${monthShort(m.mes)}</small></div>`).join('')}</div>`;
  }

  function telaEstatisticas() {
    const { d } = view();
    let html = `<header class="top"><h1 class="page-title">Estatísticas</h1></header>
      <div class="seg" role="group" aria-label="Assunto">
        <button data-act="stats-tab" data-arg="categorias" aria-pressed="${S.statsTab === 'categorias'}">Categorias</button>
        <button data-act="stats-tab" data-arg="mercado" aria-pressed="${S.statsTab === 'mercado'}">Mercado</button>
      </div>`;
    if (!d.resumo) return html + loading();
    if (S.statsTab === 'categorias') {
      const { lancamentos } = view();
      const dm = dadosMes(d);
      html += mesChips(d, lancamentos);
      if (dm.carregando) return html + `<div class="empty">Buscando ${mesLabel(dm.mes, d.mes)} na planilha…</div>`;
      const r = dm.resumo;
      const nome = mesLabel(dm.mes, d.mes);
      const cats = (dm.categorias || []).filter((c) => c.valor > 0).sort((a, b) => b.valor - a.valor);
      const top = cats.slice(0, 5);
      const max = top.length ? top[0].valor : 1;
      const itens = itensDoMes(dm, lancamentos);
      html += `<div class="duo"><div class="stat dark"><span>Despesas de ${nome}</span><strong>${brl(r.despesas)}</strong></div><div class="stat lime"><span>Renda comprometida</span><strong>${pct(r.rendaComprometida)}</strong></div></div>`;
      html += `<div class="split"><div class="split-col"><div class="section-head"><h2>Despesas separadas</h2></div><p class="hint">Toque num grupo para ver o que entrou nele. Valores da sua parte.</p><div class="card">${despesasSeparadas(dm, lancamentos, r.despesas)}</div></div>`;
      html += `<div class="split-col">${top.length ? `<div class="card pad"><div class="card-title"><h3>Para onde foi</h3><small>As categorias que mais pesaram em ${nome}</small></div>
        <div class="pills">${top.map((c, i) => `<div class="pillbar"><div class="track"><div class="fill" style="height:${Math.max(24, (c.valor / max) * 100)}%;background:${BAR_COLORS[i]};${i === 4 ? 'color:#fff;' : ''}">${pct(r.despesas ? c.valor / r.despesas : 0)}</div></div><small title="${esc(c.nome)}">${esc(c.nome.split(' ')[0])}</small></div>`).join('')}</div></div>` : ''}
        <div class="section-head"><h2>Por categoria</h2></div>
        <div class="card">${cats.length ? cats.map((c) => { const its = itens.filter((i) => i.categoria === c.nome); return bloco('c:' + c.nome, catIcon(c.nome), c.nome, `${pct(r.despesas ? c.valor / r.despesas : 0)} das despesas`, c.valor, its); }).join('') : '<div class="empty">Nenhuma despesa neste mês.</div>'}</div></div></div>`;
      return html;
    }
    const m = d.mercado || { compras: [], meses: [] };
    const atual = monthStartIso(new Date());
    const doMes = m.meses.find((x) => x.mes === atual) || { gasto: 0, compras: 0 };
    html += `<div class="duo"><div class="stat dark"><span>Mercado em ${monthName(atual)}</span><strong>${brl(doMes.gasto)}</strong></div><div class="stat"><span>Compras no mês</span><strong>${doMes.compras}</strong></div></div>`;
    if (!m.compras.length) return html + `<div class="empty">Nenhuma compra de mercado registrada ainda. Registre a próxima nota e o comparativo mês a mês aparece aqui.<br><button class="btn dark" data-act="novo-mercado">Registrar compra</button></div>`;
    html += `<div class="card pad"><div class="card-title"><h3>Mês a mês</h3><small>Total das notas de mercado</small></div>${colsChart(m.meses, 'gasto', atual)}</div>`;
    html += `<div class="section-head"><h2>Últimas compras</h2><button class="link" data-act="novo-mercado">Registrar compra</button></div>`;
    html += `<div class="card">${m.compras.slice(0, 10).map((c) => `<div class="row"><span class="row-icon">${I.receipt(20)}</span><span class="row-main"><span>${esc(c.mercado)}</span><small>${dayLabel(c.data)}, ${esc(c.tipo)}</small></span><span class="row-value">${brl(c.valor)}</span></div>`).join('')}</div>`;
    return html;
  }

  function telaCombustivel() {
    const { d } = view();
    let html = `<header class="top"><h1 class="page-title">Combustível</h1></header>
      <button class="btn primary block" data-act="novo-abast">${I.fuel()} Registrar abastecimento</button>`;
    if (!d.resumo) return html + loading();
    const c = d.combustivel || { registros: [], postos: [], meses: [] };
    const atual = monthStartIso(new Date());
    const doMes = c.meses.find((x) => x.mes === atual) || { gasto: 0, litros: 0 };
    const precoMes = doMes.litros ? doMes.gasto / doMes.litros : 0;
    html += `<div class="duo"><div class="stat dark"><span>Gasto em ${monthName(atual)}</span><strong>${brl(doMes.gasto)}</strong></div><div class="stat lime"><span>Preço médio do litro</span><strong>${precoMes ? 'R$ ' + precoMes.toFixed(2).replace('.', ',') : '—'}</strong></div></div>`;
    if (!c.registros.length) return html + `<div class="empty">Nenhum abastecimento registrado ainda.</div>`;
    html += `<div class="split"><div class="card pad"><div class="card-title"><h3>Mês a mês</h3><small>Quanto foi para o tanque</small></div>${colsChart(c.meses, 'gasto', atual)}</div><div class="split-col">`;
    if (c.postos.length) {
      html += `<div class="section-head"><h2>Postos</h2></div><div class="card">${c.postos.map((p, i) => `<div class="row"><span class="row-icon">${I.fuel(20)}</span><span class="row-main"><span>${esc(p.posto || 'Sem nome')}${i === 0 && c.postos.length > 1 ? '<span class="badge">mais barato</span>' : ''}</span><small>${p.vezes} abastecimento${p.vezes === 1 ? '' : 's'}, ${p.litros.toFixed(1).replace('.', ',')} L</small></span><span class="row-value">R$ ${p.precoMedio.toFixed(3).replace('.', ',')}<small>por litro</small></span></div>`).join('')}</div>`;
    }
    html += '</div></div>';
    html += `<div class="section-head"><h2>Histórico</h2></div><div class="card">${c.registros.slice(0, 10).map((r) => `<div class="row"><span class="row-icon">${I.fuel(20)}</span><span class="row-main"><span>${esc(r.posto)}</span><small>${dayLabel(r.data)}${r.litros ? ', ' + r.litros.toFixed(1).replace('.', ',') + ' L' : ''}${r.consumo ? ', ' + String(r.consumo).replace('.', ',') + ' km/l' : ''}</small></span><span class="row-value">${brl(r.total)}</span></div>`).join('')}</div>`;
    return html;
  }

  function telaLista() {
    const { lista } = view();
    const feitos = lista.filter((i) => i.comprado).length;
    let html = `<header class="top"><h1 class="page-title">Lista de mercado</h1><button class="icon-btn" data-act="novo-item" aria-label="Adicionar item">${I.plus(20)}</button></header>`;
    if (!lista.length) return html + `<div class="empty">Sua lista está vazia.<br><button class="btn dark" data-act="novo-item">Adicionar item</button></div>`;
    html += `<div class="list-progress"><div class="bar"><i style="width:${(feitos / lista.length) * 100}%"></i></div><span>${feitos} de ${lista.length} no carrinho</span></div>`;
    if (feitos) html += `<button class="btn ghost block" data-act="limpar-lista">Desmarcar todos</button>`;
    const grupos = {};
    const ordem = [];
    lista.forEach((it) => { const g = it.categoria || 'Outros'; if (!grupos[g]) { grupos[g] = []; ordem.push(g); } grupos[g].push(it); });
    html += '<div class="groups">';
    ordem.forEach((g) => {
      const itens = grupos[g].slice().sort((a, b) => Number(a.comprado) - Number(b.comprado));
      const ok = itens.filter((i) => i.comprado).length;
      html += `<section class="group"><div class="group-label"><span>${esc(g)}</span><span>${ok}/${itens.length}</span></div><div class="card">`;
      html += itens.map((it) => `<button class="item${it.comprado ? ' done' : ''}" data-act="toggle-item" data-id="${esc(it.id)}" aria-pressed="${it.comprado}"><span class="check">${it.comprado ? I.check(16) : ''}</span><span class="item-name">${it.pending ? '<i class="pending-dot"></i>' : ''}${esc(it.produto)}</span><span class="item-qty">${it.quantidade ? String(it.quantidade).replace('.', ',') + 'x' : ''}</span></button>`).join('');
      html += '</div></section>';
    });
    html += '</div>';
    return html;
  }

  /* ================= portão: configuração e PIN ================= */
  function telaSetup() {
    return `<div class="gate">
      <div class="logo">C</div>
      <h1>Conectar o Caixa</h1>
      <p>Abra o link de configuração que você recebeu ou preencha os dados abaixo. Eles ficam guardados só neste aparelho.</p>
      <form class="setup-form" id="setup-form">
        <div class="field"><label for="s-nome">Como você quer ser chamado</label><input class="input" id="s-nome" autocomplete="given-name" value="${esc((S.cfg && S.cfg.nome) || '')}"></div>
        <div class="field"><label for="s-url">Endereço do script</label><input class="input" id="s-url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="field"><label for="s-key">Chave de acesso</label><input class="input" id="s-key" autocomplete="off" type="password"></div>
        <p class="error" id="s-err" hidden></p>
        <button class="btn primary block" type="submit">Conectar</button>
      </form>
    </div>`;
  }

  function telaGate() {
    const g = S.gate;
    const titulos = { unlock: 'Digite seu PIN', create: 'Crie um PIN de 4 dígitos', confirm: 'Repita o PIN' };
    const textos = {
      unlock: g.wait ? `Muitas tentativas. Aguarde ${g.wait} segundos.` : 'Para proteger seus números neste aparelho.',
      create: 'Ele será pedido sempre que você abrir o app depois de alguns minutos fora.',
      confirm: 'Só para garantir que você digitou certo.'
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return `<div class="gate">
      <div class="logo">${I.lock(34)}</div>
      <h1>${titulos[g.mode]}</h1>
      <p>${g.msg ? esc(g.msg) : textos[g.mode]}</p>
      <div class="dots" aria-label="${g.buf.length} de 4 dígitos">${[0, 1, 2, 3].map((i) => `<i class="${i < g.buf.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="keypad">${keys.map((k) => `<button data-act="pin" data-arg="${k}">${k}</button>`).join('')}
        <button class="ghost" data-act="${g.mode === 'unlock' ? 'pin-noop' : 'pin-skip'}">${g.mode === 'unlock' ? '' : 'Agora não'}</button>
        <button data-act="pin" data-arg="0">0</button>
        <button class="ghost" data-act="pin-del" aria-label="Apagar">Apagar</button>
      </div>
    </div>`;
  }

  async function hashPin(pin) {
    const salt = LS.get('salt', null) || (() => { const s = uid('s') + uid(); LS.set('salt', s); return s; })();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function pinDigit(k) {
    const g = S.gate;
    if (g.wait) return;
    g.buf += k; g.msg = '';
    render();
    if (g.buf.length < 4) return;
    if (g.mode === 'unlock') {
      const ok = (await hashPin(g.buf)) === LS.get('pin', null);
      if (ok) { S.gate = null; render(); sync(); return; }
      g.fails = (g.fails || 0) + 1; g.buf = ''; g.msg = 'PIN incorreto.';
      if (g.fails >= 5) {
        g.wait = 30; g.fails = 0;
        const t = setInterval(() => { g.wait -= 1; if (g.wait <= 0) { clearInterval(t); g.wait = 0; } render(); }, 1000);
      }
      render();
    } else if (g.mode === 'create') {
      g.first = g.buf; g.buf = ''; g.mode = 'confirm'; render();
    } else if (g.mode === 'confirm') {
      if (g.buf === g.first) { LS.set('pin', await hashPin(g.buf)); S.gate = null; toast('PIN criado'); render(); }
      else { g.mode = 'create'; g.buf = ''; g.first = ''; g.msg = 'Os PINs não batem. Comece de novo.'; render(); }
    }
  }

  /* ================= folhas (formulários) ================= */
  function openSheet(title, body, onMount) {
    $sheet.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Fechar">${I.close(20)}</button></div>
        ${body}
      </div>`;
    document.body.style.overflow = 'hidden';
    if (onMount) onMount($sheet.querySelector('.sheet'));
  }
  function closeSheet() { $sheet.innerHTML = ''; document.body.style.overflow = ''; }

  const chips = (group, options, selected, labelFn) => `<div class="chips" role="group">${options.map((o) => `<button type="button" class="chip" data-group="${group}" data-value="${esc(o)}" aria-pressed="${o === selected}">${esc(labelFn ? labelFn(o) : o)}</button>`).join('')}</div>`;
  const picked = (root, group) => { const b = root.querySelector(`.chip[data-group="${group}"][aria-pressed="true"], .seg [data-group="${group}"][aria-pressed="true"]`); return b ? b.dataset.value : ''; };
  const segOf = (group, options, selected) => `<div class="seg" role="group">${options.map((o) => `<button type="button" data-group="${group}" data-value="${esc(o)}" aria-pressed="${o === selected}">${esc(o)}</button>`).join('')}</div>`;
  const showError = (root, msg) => { const e = root.querySelector('.error'); e.textContent = msg; e.hidden = !msg; };

  function cfgLists() {
    const c = (S.data && S.data.config) || {};
    return {
      categorias: c.categorias && c.categorias.length ? c.categorias : ['Moradia', 'Contas da casa', 'Compras da casa', 'Alimentação', 'Pets', 'Transporte', 'Estudos', 'Lazer', 'Saúde', 'Dívidas', 'Outros'],
      formas: c.formas && c.formas.length ? c.formas : ['Pix', 'Débito', 'Dinheiro', 'Boleto', 'Nubank'],
      pagoPor: c.pagoPor && c.pagoPor.length ? c.pagoPor : ['Eu', 'Parceiro(a)']
    };
  }

  function formLancamento() {
    const L = cfgLists();
    const { lancamentos } = view();
    const descs = Array.from(new Set(lancamentos.map((l) => l.descricao))).slice(0, 60);
    const agora = new Date();
    const mesAtual = monthStartIso(agora);
    const mesProx = monthStartIso(new Date(agora.getFullYear(), agora.getMonth() + 1, 1));
    openSheet('Novo lançamento', `
      <form id="f-lanc" class="setup-form" novalidate>
        <label class="money"><span>R$</span><span class="sr">Valor</span><input id="f-valor" inputmode="decimal" autocomplete="off" placeholder="0,00" enterkeyhint="next"></label>
        <div class="field"><label for="f-desc">Descrição</label><input class="input" id="f-desc" list="f-desc-list" autocomplete="off" placeholder="Ex.: Almoço, Uber, Farmácia"><datalist id="f-desc-list">${descs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><span class="label">Categoria</span>${chips('categoria', L.categorias, '')}</div>
        <div class="field"><span class="label">Forma de pagamento</span>${chips('forma', L.formas, 'Pix')}</div>
        <div class="field"><span class="label">É um gasto</span>${segOf('tipo', ['Pessoal', 'Casa'], 'Pessoal')}</div>
        <div class="field" id="f-pagopor" hidden><span class="label">Quem pagou</span>${chips('pagoPor', L.pagoPor, 'Eu')}<p class="hint">Gastos da casa são divididos pelo percentual da planilha.</p></div>
        <div class="grid-2">
          <div class="field"><label for="f-data">Data</label><input class="input" type="date" id="f-data" value="${todayIso()}"></div>
          <div class="field"><span class="label">Entra no mês</span>${chips('mes', [mesAtual, mesProx], mesAtual, monthShort)}</div>
        </div>
        <p class="hint" id="f-nubank-hint" hidden>No Nubank, escolha o mês da fatura em que a compra vai cair.</p>
        <div class="field"><label for="f-obs">Observações</label><input class="input" id="f-obs" autocomplete="off"></div>
        <p class="error" hidden></p>
        <button class="btn primary block" type="submit">Salvar lançamento</button>
      </form>`, (root) => {
      const valor = root.querySelector('#f-valor');
      setTimeout(() => valor.focus(), 250);
      root.querySelector('#f-desc').addEventListener('change', (e) => {
        const prev = lancamentos.find((l) => l.descricao.toLowerCase() === e.target.value.trim().toLowerCase());
        if (!prev) return;
        selectChip(root, 'categoria', prev.categoria);
        selectChip(root, 'forma', prev.forma);
        selectChip(root, 'tipo', prev.tipo);
        syncLancForm(root);
      });
      root.addEventListener('chip', () => syncLancForm(root));
      root.querySelector('#f-lanc').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = parseMoney(valor.value);
        const desc = root.querySelector('#f-desc').value.trim();
        if (!(v > 0)) return showError(root, 'Digite o valor do gasto.');
        if (!desc) return showError(root, 'Escreva uma descrição curta.');
        const categoria = picked(root, 'categoria');
        if (!categoria) return showError(root, 'Escolha uma categoria.');
        const tipo = picked(root, 'tipo') || 'Pessoal';
        enqueue('addLancamento', {
          valor: v, descricao: desc, categoria, forma: picked(root, 'forma') || 'Pix', tipo,
          pagoPor: tipo === 'Casa' ? picked(root, 'pagoPor') || 'Eu' : 'Eu',
          data: root.querySelector('#f-data').value || todayIso(), mes: picked(root, 'mes') || mesAtual,
          obs: root.querySelector('#f-obs').value.trim()
        }, uid());
        closeSheet();
        toast('Lançamento guardado. Enviando para a planilha…');
      });
    });
  }

  function syncLancForm(root) {
    root.querySelector('#f-pagopor').hidden = picked(root, 'tipo') !== 'Casa';
    root.querySelector('#f-nubank-hint').hidden = picked(root, 'forma') !== 'Nubank';
  }

  function selectChip(root, group, value) {
    if (!value) return;
    root.querySelectorAll(`[data-group="${group}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
  }

  function formAbastecimento() {
    const L = cfgLists();
    const c = (S.data && S.data.combustivel) || { postos: [], registros: [] };
    const postos = c.postos.map((p) => p.posto).filter(Boolean);
    const ultimo = c.registros[0];
    const barato = c.postos.length > 1 ? c.postos[0] : null;
    openSheet('Abastecimento', `
      <form id="f-ab" class="setup-form" novalidate>
        ${barato ? `<p class="hint">Mais barato até agora: <strong>${esc(barato.posto)}</strong>, R$ ${barato.precoMedio.toFixed(3).replace('.', ',')} o litro.</p>` : ''}
        <div class="field"><label for="a-posto">Posto</label><input class="input" id="a-posto" list="a-postos" autocomplete="off" value="${esc(ultimo ? ultimo.posto : '')}"><datalist id="a-postos">${postos.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
        <div class="grid-2">
          <div class="field"><label for="a-litros">Litros</label><input class="input" id="a-litros" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>
          <div class="field"><label for="a-preco">Preço do litro</label><input class="input" id="a-preco" inputmode="decimal" autocomplete="off" placeholder="0,000" value="${ultimo && ultimo.preco ? String(ultimo.preco).replace('.', ',') : ''}"></div>
        </div>
        <label class="money"><span>R$</span><span class="sr">Total pago</span><input id="a-total" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
        <p class="hint">O total é calculado pelos litros e pelo preço. Se pagou um valor redondo, digite direto aqui.</p>
        <div class="grid-2">
          <div class="field"><label for="a-km">Km no painel</label><input class="input" id="a-km" inputmode="numeric" autocomplete="off" placeholder="Opcional"></div>
          <div class="field"><label for="a-data">Data</label><input class="input" type="date" id="a-data" value="${todayIso()}"></div>
        </div>
        <div class="field"><span class="label">Forma de pagamento</span>${chips('forma', L.formas, (ultimo && ultimo.forma) || 'Pix')}</div>
        <div class="field"><label for="a-obs">Observações</label><input class="input" id="a-obs" autocomplete="off" placeholder="Ex.: gasolina comum"></div>
        <p class="error" hidden></p>
        <button class="btn primary block" type="submit">Salvar abastecimento</button>
      </form>`, (root) => {
      const litros = root.querySelector('#a-litros');
      const preco = root.querySelector('#a-preco');
      const total = root.querySelector('#a-total');
      let manual = false;
      total.addEventListener('input', () => { manual = total.value.trim() !== ''; });
      const calc = () => {
        if (manual) return;
        const l = parseMoney(litros.value), p = parseMoney(preco.value);
        total.value = l > 0 && p > 0 ? (Math.round(l * p * 100) / 100).toFixed(2).replace('.', ',') : '';
      };
      litros.addEventListener('input', calc); preco.addEventListener('input', calc);
      root.querySelector('#f-ab').addEventListener('submit', (e) => {
        e.preventDefault();
        const posto = root.querySelector('#a-posto').value.trim();
        const t = parseMoney(total.value);
        const l = parseMoney(litros.value), p = parseMoney(preco.value);
        if (!posto) return showError(root, 'Diga em qual posto abasteceu.');
        if (!(t > 0)) return showError(root, 'Preencha litros e preço, ou o total pago.');
        enqueue('addAbastecimento', {
          posto, litros: l > 0 ? l : '', preco: p > 0 ? p : '', total: t, km: parseMoney(root.querySelector('#a-km').value) || '',
          data: root.querySelector('#a-data').value || todayIso(), forma: picked(root, 'forma') || 'Pix', obs: root.querySelector('#a-obs').value.trim()
        }, uid('A'));
        closeSheet();
        toast('Abastecimento guardado. Ele também entra nos lançamentos.');
      });
    });
  }

  function formMercado() {
    const L = cfgLists();
    const m = (S.data && S.data.mercado) || { compras: [] };
    const nomes = Array.from(new Set(m.compras.map((c) => c.mercado))).filter(Boolean);
    openSheet('Compra de mercado', `
      <form id="f-mk" class="setup-form" novalidate>
        <label class="money"><span>R$</span><span class="sr">Valor da nota</span><input id="m-valor" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
        <div class="field"><label for="m-nome">Mercado</label><input class="input" id="m-nome" list="m-nomes" autocomplete="off" value="${esc(nomes[0] || '')}"><datalist id="m-nomes">${nomes.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="field"><span class="label">Compra para</span>${segOf('tipo', ['Casa', 'Pessoal'], 'Casa')}</div>
        <div class="field" id="m-pagopor"><span class="label">Quem pagou</span>${chips('pagoPor', L.pagoPor, 'Eu')}</div>
        <div class="field"><span class="label">Forma de pagamento</span>${chips('forma', L.formas, 'Pix')}</div>
        <div class="field"><label for="m-data">Data</label><input class="input" type="date" id="m-data" value="${todayIso()}"></div>
        <div class="field"><label for="m-obs">Observações</label><input class="input" id="m-obs" autocomplete="off"></div>
        <p class="error" hidden></p>
        <button class="btn primary block" type="submit">Salvar compra</button>
      </form>`, (root) => {
      setTimeout(() => root.querySelector('#m-valor').focus(), 250);
      root.addEventListener('chip', () => { root.querySelector('#m-pagopor').hidden = picked(root, 'tipo') !== 'Casa'; });
      root.querySelector('#f-mk').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = parseMoney(root.querySelector('#m-valor').value);
        const nome = root.querySelector('#m-nome').value.trim();
        if (!(v > 0)) return showError(root, 'Digite o valor da nota.');
        if (!nome) return showError(root, 'Diga em qual mercado foi.');
        const tipo = picked(root, 'tipo') || 'Casa';
        enqueue('addMercado', {
          valor: v, mercado: nome, tipo, pagoPor: tipo === 'Casa' ? picked(root, 'pagoPor') || 'Eu' : 'Eu',
          forma: picked(root, 'forma') || 'Pix', data: root.querySelector('#m-data').value || todayIso(), obs: root.querySelector('#m-obs').value.trim()
        }, uid('M'));
        closeSheet();
        toast('Compra guardada. Ela também entra nos lançamentos.');
      });
    });
  }

  /* ================= caixinha ================= */
  const MOV_LABEL = { 'Guardar': 'Guardado', 'Resgatar': 'Resgatado', 'Saldo inicial': 'Já estava guardado' };

  function telaCaixinha() {
    const { caixinha } = view();
    const movs = caixinha.movimentos;
    openSheet('Caixinha', `
      <div class="cx-total"><small>Guardado no total</small><strong>${brl(caixinha.total)}</strong><p class="hint">Dinheiro guardado não conta como despesa. Ele só sai do saldo do mês em que você guardou, porque deixa de estar disponível para gastar.</p></div>
      <div class="cx-actions"><button class="btn primary" data-act="cx-form" data-arg="Guardar">Guardar</button><button class="btn ghost" data-act="cx-form" data-arg="Resgatar">Resgatar</button></div>
      ${movs.length ? `<div class="card">${movs.map((m) => `<div class="row"><span class="row-main"><span>${m.pending ? '<i class="pending-dot" aria-label="aguardando envio"></i>' : ''}${esc(MOV_LABEL[m.mov] || m.mov)}</span><small>${esc([m.data ? m.data.slice(8, 10) + '/' + m.data.slice(5, 7) + '/' + m.data.slice(0, 4) : '', m.obs].filter(Boolean).join(', '))}</small></span><span class="row-value${m.mov === 'Resgatar' ? ' neg' : ''}">${m.mov === 'Resgatar' ? '−' : '+'}${brl(m.valor)}</span><button class="icon-btn sm" data-act="cx-del" data-id="${esc(m.id)}" aria-label="Apagar este movimento">${I.close(16)}</button></div>`).join('')}</div>` : `<div class="empty">Nada registrado ainda. Se você já tem dinheiro na caixinha, registre como “Já estava guardado”.<br><button class="btn dark" data-act="cx-form" data-arg="Saldo inicial">Registrar o que já tenho</button></div>`}`);
  }

  function formCaixinha(mov) {
    const OPC = ['Guardar', 'Resgatar', 'Já tinha'];
    const toMov = (o) => (o === 'Já tinha' ? 'Saldo inicial' : o);
    const sel = mov === 'Saldo inicial' ? 'Já tinha' : mov || 'Guardar';
    openSheet('Caixinha', `
      <form id="f-cx" class="setup-form" novalidate>
        <div class="field">${segOf('mov', OPC, sel)}</div>
        <label class="money"><span>R$</span><span class="sr">Valor</span><input id="cx-valor" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
        <p class="hint" id="cx-hint"></p>
        <div class="field" id="cx-data-f"><label for="cx-data">Data</label><input class="input" type="date" id="cx-data" value="${todayIso()}"></div>
        <div class="field"><label for="cx-obs">Observações</label><input class="input" id="cx-obs" autocomplete="off" placeholder="Ex.: caixinha Nubank, reserva"></div>
        <p class="error" hidden></p>
        <button class="btn primary block" type="submit">Salvar</button>
      </form>`, (root) => {
      const HINT = {
        'Guardar': 'Sai do saldo deste mês, mas não entra nas despesas.',
        'Resgatar': 'Volta para o saldo do mês e sai do total guardado.',
        'Já tinha': 'Só entra no total guardado. Não mexe no saldo de nenhum mês.'
      };
      const upd = () => { const o = picked(root, 'mov') || 'Guardar'; root.querySelector('#cx-hint').textContent = HINT[o]; root.querySelector('#cx-data-f').hidden = o === 'Já tinha'; };
      upd();
      root.addEventListener('chip', upd);
      setTimeout(() => root.querySelector('#cx-valor').focus(), 250);
      root.querySelector('#f-cx').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = parseMoney(root.querySelector('#cx-valor').value);
        if (!(v > 0)) return showError(root, 'Digite o valor.');
        const m = toMov(picked(root, 'mov') || 'Guardar');
        if (m === 'Resgatar' && v > view().caixinha.total + 0.001) return showError(root, `Na caixinha há ${brl(view().caixinha.total)}. Confira o valor.`);
        enqueue('addCaixinha', { mov: m, valor: v, data: m === 'Saldo inicial' ? todayIso() : root.querySelector('#cx-data').value || todayIso(), obs: root.querySelector('#cx-obs').value.trim() }, uid('C'));
        telaCaixinha();
        toast(m === 'Resgatar' ? 'Resgate registrado' : 'Guardado na caixinha');
      });
    });
  }

  function formItem() {
    const { lista } = view();
    const cats = Array.from(new Set(lista.map((i) => i.categoria).filter(Boolean)));
    if (!cats.includes('Outros')) cats.push('Outros');
    openSheet('Adicionar à lista', `
      <form id="f-item" class="setup-form" novalidate>
        <div class="field"><label for="i-prod">Produto</label><input class="input" id="i-prod" autocomplete="off" placeholder="Ex.: Café 500g"></div>
        <div class="field"><label for="i-qtd">Quantidade</label><input class="input" id="i-qtd" inputmode="decimal" value="1"></div>
        <div class="field"><span class="label">Seção do mercado</span>${chips('categoria', cats, cats[0])}</div>
        <p class="error" hidden></p>
        <button class="btn primary block" type="submit">Adicionar</button>
      </form>`, (root) => {
      setTimeout(() => root.querySelector('#i-prod').focus(), 250);
      root.querySelector('#f-item').addEventListener('submit', (e) => {
        e.preventDefault();
        const produto = root.querySelector('#i-prod').value.trim();
        if (!produto) return showError(root, 'Escreva o nome do produto.');
        enqueue('addListaItem', { produto, quantidade: parseMoney(root.querySelector('#i-qtd').value) || 1, categoria: picked(root, 'categoria') || 'Outros' }, uid('L'));
        closeSheet();
      });
    });
  }

  function detalheLanc(id) {
    const { lancamentos } = view();
    const l = lancamentos.find((x) => x.id === id);
    if (!l) return;
    const linha = (k, v) => v ? `<div class="row"><span class="row-main"><small>${k}</small><span>${esc(v)}</span></span></div>` : '';
    const auto = /^(AB|MK)-/.test(l.id);
    openSheet(esc(l.descricao), `
      <label class="money" style="pointer-events:none"><span>R$</span><input value="${brl(l.valor).replace('R$', '').trim()}" readonly tabindex="-1" aria-label="Valor"></label>
      <div class="card">
        ${linha('Data', dayLabel(l.data))}
        ${linha('Categoria', l.categoria || 'Sem categoria')}
        ${linha('Forma de pagamento', l.forma)}
        ${linha('Tipo', l.tipo)}
        ${l.tipo === 'Casa' ? linha('Sua parte', brl(l.minhaParte)) : ''}
        ${linha('Sai de', l.pagoCom)}
        ${linha('Pago por', l.tipo === 'Casa' ? l.pagoPor : '')}
        ${linha('Entra no mês', l.mes ? monthName(l.mes) : '')}
        ${linha('Observações', l.obs)}
      </div>
      ${l.pending ? '<p class="hint"><span class="pending-dot"></span>Ainda não chegou à planilha. Será enviado quando houver conexão.</p>' : ''}
      ${auto ? '<p class="hint">Este lançamento foi criado por um registro de abastecimento ou de mercado. Para apagar, use a planilha.</p>'
        : `<button class="btn danger block" data-act="${l.pending ? 'cancel-pend' : 'delete-lanc'}" data-id="${esc(l.id)}">${l.pending ? 'Cancelar este lançamento' : 'Apagar lançamento'}</button>`}`);
  }

  function telaConfig() {
    const temPin = !!LS.get('pin', null);
    const quando = S.lastSync ? new Date(S.lastSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca';
    openSheet('Configurações', `
      <div class="field"><label for="c-nome">Seu nome</label><input class="input" id="c-nome" value="${esc((S.cfg && S.cfg.nome) || '')}"></div>
      <button class="btn dark block" data-act="save-name">Salvar nome</button>
      <div class="card">
        <div class="row"><span class="row-main"><small>Última sincronização</small><span>${quando}</span></span></div>
        <div class="row"><span class="row-main"><small>Aguardando envio</small><span>${S.queue.length} item(ns)</span></span></div>
        <div class="row"><span class="row-main"><small>Versão</small><span>${VERSION}</span></span></div>
      </div>
      <button class="btn ghost block" data-act="sync-close">Sincronizar agora</button>
      <button class="btn ghost block" data-act="${temPin ? 'pin-change' : 'pin-create'}">${temPin ? 'Trocar PIN' : 'Criar PIN de abertura'}</button>
      ${temPin ? '<button class="btn ghost block" data-act="pin-remove">Remover PIN</button>' : ''}
      <button class="btn danger block" data-act="disconnect">Desconectar este aparelho</button>
      <p class="hint">Desconectar apaga deste aparelho a chave, o PIN e a cópia dos dados. Nada é apagado da planilha.</p>`);
  }

  /* ================= navegação ================= */
  const NAV = [
    ['inicio', 'Início', I.grid],
    ['lancamentos', 'Lançamentos', I.list],
    ['estatisticas', 'Estatísticas', I.chart],
    ['lista', 'Lista de mercado', I.cart],
    ['combustivel', 'Combustível', I.fuel]
  ];
  function renderNav(show) {
    $nav.hidden = !show;
    if (!show) return;
    $nav.innerHTML = '<div class="nav-brand" aria-hidden="true"><span>C</span>Caixa</div>' + NAV.map(([id, label, ic]) => `<button data-act="go" data-arg="${id}" aria-label="${label}"${S.screen === id ? ' aria-current="page"' : ''}>${ic()}<span class="nav-label">${label}</span></button>`).join('');
  }

  const TELAS = { inicio: telaInicio, lancamentos: telaLancamentos, estatisticas: telaEstatisticas, lista: telaLista, combustivel: telaCombustivel };

  function render() {
    const focusId = document.activeElement && document.activeElement.id === 'busca' ? 'busca' : null;
    const caret = focusId ? document.activeElement.selectionStart : 0;
    $app.dataset.screen = !S.cfg || S.gate ? 'gate' : S.screen;
    if (!S.cfg) { $app.innerHTML = telaSetup(); renderNav(false); bindSetup(); return; }
    if (S.gate) { $app.innerHTML = telaGate(); renderNav(false); return; }
    const prevScroll = {};
    $app.querySelectorAll('.mes-chips').forEach((c, i) => { prevScroll[i] = c.scrollLeft; });
    $app.innerHTML = (TELAS[S.screen] || telaInicio)();
    renderNav(true);
    $app.querySelectorAll('.mes-chips').forEach((c, i) => {
      const on = c.querySelector('[aria-pressed="true"]');
      if (i in prevScroll) c.scrollLeft = prevScroll[i];
      if (on && (on.offsetLeft < c.scrollLeft || on.offsetLeft + on.offsetWidth > c.scrollLeft + c.clientWidth)) c.scrollLeft = on.offsetLeft - (c.clientWidth - on.offsetWidth) / 2;
    });
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
  }

  function bindSetup() {
    const f = document.getElementById('setup-form');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('s-url').value.trim();
      const key = document.getElementById('s-key').value.trim();
      const nome = document.getElementById('s-nome').value.trim();
      const err = document.getElementById('s-err');
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { err.textContent = 'O endereço precisa ser do tipo https://script.google.com/macros/s/…/exec'; err.hidden = false; return; }
      if (key.length < 16) { err.textContent = 'A chave parece curta demais. Copie a chave completa.'; err.hidden = false; return; }
      await connect({ url, key, nome }, err);
    });
  }

  async function connect(cfg, errEl) {
    const prev = S.cfg;
    S.cfg = cfg;
    try {
      const res = await api({ action: 'bootstrap' });
      S.data = res.data; S.lastSync = Date.now();
      LS.set('cfg', cfg); LS.set('data', S.data); LS.set('lastSync', S.lastSync);
      S.gate = LS.get('pin', null) ? null : { mode: 'create', buf: '' };
      render();
    } catch (e) {
      S.cfg = prev;
      const msg = e.code === 'unauthorized' ? 'A chave não confere com a do script.' : e.network ? 'Sem conexão com o script. Confira o endereço e a internet.' : 'Não foi possível conectar: ' + e.message;
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; } else { toast(msg); render(); }
    }
  }

  /* ================= cliques ================= */
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-group]');
    if (chip && chip.closest('#sheet-root')) {
      const root = chip.closest('.sheet');
      root.querySelectorAll(`[data-group="${chip.dataset.group}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
      root.dispatchEvent(new CustomEvent('chip', { detail: chip.dataset.group }));
      return;
    }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, arg = t.dataset.arg, id = t.dataset.id;
    switch (act) {
      case 'go': S.screen = arg; closeSheet(); render(); window.scrollTo(0, 0); break;
      case 'sync': sync(true); break;
      case 'sync-close': closeSheet(); sync(true); break;
      case 'novo-lanc': formLancamento(); break;
      case 'novo-abast': formAbastecimento(); break;
      case 'novo-mercado': formMercado(); break;
      case 'novo-item': formItem(); break;
      case 'lanc': detalheLanc(id); break;
      case 'close-sheet': closeSheet(); break;
      case 'mes': escolherMes(arg); break;
      case 'filtro-tipo': S.filtro.tipo = arg; render(); break;
      case 'ver-grupo': S.abertos.add('g:' + arg); S.screen = 'estatisticas'; S.statsTab = 'categorias'; render(); window.scrollTo(0, 0); break;
      case 'stats-tab': S.statsTab = arg; render(); break;
      case 'toggle-item': {
        const it = view().lista.find((x) => x.id === id);
        if (!it) break;
        S.queue = S.queue.filter((o) => !(o.op === 'toggleLista' && o.data.id === id));
        enqueue('toggleLista', { id, comprado: !it.comprado });
        break;
      }
      case 'limpar-lista': {
        const feitos = view().lista.filter((x) => x.comprado);
        S.queue = S.queue.filter((o) => o.op !== 'toggleLista');
        feitos.forEach((x) => S.queue.push({ op: 'toggleLista', id: uid(), data: { id: x.id, comprado: false }, ts: Date.now() }));
        LS.set('queue', S.queue); render(); sync();
        break;
      }
      case 'delete-lanc':
        if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Toque de novo para apagar'; break; }
        enqueue('deleteLancamento', { id }); closeSheet(); toast('Lançamento apagado');
        break;
      case 'cancel-pend':
        S.queue = S.queue.filter((o) => o.id !== id && 'AB-' + o.id !== id && 'MK-' + o.id !== id);
        LS.set('queue', S.queue); closeSheet(); render(); toast('Lançamento cancelado');
        break;
      case 'settings': telaConfig(); break;
      case 'caixinha': telaCaixinha(); break;
      case 'cx-form': formCaixinha(arg); break;
      case 'cx-del': {
        if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.classList.add('confirm'); t.setAttribute('aria-label', 'Toque de novo para apagar'); toast('Toque no X de novo para apagar'); break; }
        const pend = S.queue.find((o) => o.op === 'addCaixinha' && o.id === id);
        if (pend) { S.queue = S.queue.filter((o) => o !== pend); LS.set('queue', S.queue); render(); } else enqueue('deleteCaixinha', { id });
        telaCaixinha();
        break;
      }
      case 'save-name': {
        const n = document.getElementById('c-nome').value.trim();
        S.cfg = Object.assign({}, S.cfg, { nome: n }); LS.set('cfg', S.cfg); closeSheet(); render(); toast('Nome salvo');
        break;
      }
      case 'pin-create': case 'pin-change': closeSheet(); S.gate = { mode: 'create', buf: '' }; render(); break;
      case 'pin-remove': LS.del('pin'); closeSheet(); toast('PIN removido'); break;
      case 'disconnect':
        if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Toque de novo para desconectar'; break; }
        ['cfg', 'data', 'queue', 'lastSync', 'pin', 'salt'].forEach(LS.del);
        Object.assign(S, { cfg: null, data: null, queue: [], lastSync: null, gate: null });
        closeSheet(); render();
        break;
      case 'pin': pinDigit(arg); break;
      case 'pin-del': if (S.gate) { S.gate.buf = S.gate.buf.slice(0, -1); render(); } break;
      case 'pin-skip': S.gate = null; render(); break;
      default: break;
    }
  });

  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('details.xp')) return;
    if (el.open) S.abertos.add(el.dataset.key); else S.abertos.delete(el.dataset.key);
  }, true);

  document.addEventListener('input', (e) => {
    if (e.target.id === 'busca') { S.filtro.q = e.target.value; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $sheet.innerHTML) closeSheet();
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-act]')) e.target.click();
    if (S.gate && /^[0-9]$/.test(e.key)) pinDigit(e.key);
    if (S.gate && e.key === 'Backspace') { S.gate.buf = S.gate.buf.slice(0, -1); render(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { S.hiddenAt = Date.now(); return; }
    if (S.cfg && LS.get('pin', null) && S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) { closeSheet(); S.gate = { mode: 'unlock', buf: '' }; render(); return; }
    if (S.cfg && !S.gate && (!S.lastSync || Date.now() - S.lastSync > 60000 || S.queue.length)) sync();
  });
  window.addEventListener('online', () => { if (S.cfg && !S.gate) sync(); });

  /* ================= início ================= */
  function readSetupLink() {
    const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const o = JSON.parse(json);
      if (o && o.u && o.k) return { url: o.u, key: o.k, nome: o.n || '' };
    } catch (e) { /* link inválido */ }
    return null;
  }

  const link = readSetupLink();
  if (link) {
    $app.innerHTML = '<div class="gate"><div class="logo">C</div><h1>Conectando…</h1></div>';
    connect(link, null);
  } else {
    if (S.cfg && LS.get('pin', null)) S.gate = { mode: 'unlock', buf: '' };
    render();
    if (S.cfg && !S.gate) sync();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
