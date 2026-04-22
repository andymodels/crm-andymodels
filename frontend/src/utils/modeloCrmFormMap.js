import { onlyDigits } from './brValidators';
import { formatCpfDisplay } from './brMasks';
import { formatPhoneBRMask } from './brValidators';
import { toDateInputValue } from './dateInput';

function parsePerfil(row) {
  const p = row?.perfil_site;
  if (p && typeof p === 'object' && !Array.isArray(p)) return { ...p };
  if (typeof p === 'string') {
    try {
      const o = JSON.parse(p);
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Estado extra obrigatório no CRM (orçamento / cadastro interno). */
export function createCrmExtraInitial() {
  return {
    emite_nf_propria: true,
    origem_cadastro: 'interno',
    status_cadastro: 'aprovado',
    ativo_crm: true,
    responsavel_nome: '',
    responsavel_cpf: '',
    responsavel_telefone: '',
  };
}

export function crmRowToCrmExtra(row) {
  const base = createCrmExtraInitial();
  if (!row || typeof row !== 'object') return base;
  return {
    emite_nf_propria: Boolean(row.emite_nf_propria),
    origem_cadastro: row.origem_cadastro != null ? String(row.origem_cadastro) : 'interno',
    status_cadastro: row.status_cadastro != null ? String(row.status_cadastro) : 'aprovado',
    ativo_crm: row.ativo !== false && row.ativo !== '0' && row.ativo !== 0,
    responsavel_nome: row.responsavel_nome != null ? String(row.responsavel_nome) : '',
    responsavel_cpf: row.responsavel_cpf != null ? String(row.responsavel_cpf) : '',
    responsavel_telefone: row.responsavel_telefone != null ? String(row.responsavel_telefone) : '',
  };
}

/**
 * Converte linha `modelos` (API CRM) para o estado do formulário WebsiteModeloEditorPage.
 * `baseForm` = resultado de createInitialForm() do editor.
 */
export function mergeCrmRowIntoWebsiteForm(baseForm, row) {
  const perfil = parsePerfil(row);
  const sexo = String(row.sexo || '').toLowerCase();
  const feminino = sexo.includes('femin');
  const masculino = sexo.includes('mascul') || sexo === 'm' || sexo === 'homem';

  const telRaw = Array.isArray(row.telefones) ? row.telefones : [];
  const telList =
    telRaw.length > 0
      ? telRaw.map((x) => formatPhoneBRMask(onlyDigits(String(x || '')))).filter((x) => onlyDigits(x).length >= 8)
      : row.telefone
        ? [formatPhoneBRMask(onlyDigits(String(row.telefone)))]
        : [''];

  const emRaw = Array.isArray(row.emails) ? row.emails : [];
  const emList =
    emRaw.length > 0
      ? emRaw.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : row.email
        ? [String(row.email).trim().toLowerCase()]
        : [''];

  const nomeCompleto = String(row.nome || '').trim();
  const nomeSite = String(perfil.nome_site ?? row.nome ?? '').trim();

  return {
    ...baseForm,
    nome_completo: nomeCompleto,
    nome: nomeSite || nomeCompleto,
    data_nascimento: toDateInputValue(row.data_nascimento),
    bio: perfil.bio != null ? String(perfil.bio) : '',
    featured: Boolean(perfil.featured),
    ativo: row.ativo_site === true || row.ativo_site === '1' || row.ativo_site === 1,
    catFeminino:
      perfil.catFeminino !== undefined ? Boolean(perfil.catFeminino) : feminino || (!masculino && !sexo),
    catMasculino: perfil.catMasculino !== undefined ? Boolean(perfil.catMasculino) : Boolean(masculino),
    catCreators: Boolean(perfil.catCreators),
    medida_altura: row.medida_altura != null ? String(row.medida_altura) : '',
    medida_busto: row.medida_busto != null ? String(row.medida_busto) : '',
    medida_torax: row.medida_torax != null ? String(row.medida_torax) : '',
    medida_cintura: row.medida_cintura != null ? String(row.medida_cintura) : '',
    medida_quadril: row.medida_quadril != null ? String(row.medida_quadril) : '',
    medida_sapato: row.medida_sapato != null ? String(row.medida_sapato) : '',
    medida_cabelo: row.medida_cabelo != null ? String(row.medida_cabelo) : '',
    medida_olhos: row.medida_olhos != null ? String(row.medida_olhos) : '',
    telefones: telList.length ? telList : [''],
    emails: emList.length ? emList : [''],
    instagram: instagramFromRow(row, perfil),
    mostrar_instagram: perfil.mostrar_instagram !== undefined ? Boolean(perfil.mostrar_instagram) : true,
    tiktok: row.tiktok != null ? String(row.tiktok) : '',
    cpf: row.cpf != null ? formatCpfDisplay(onlyDigits(String(row.cpf))) : '',
    rg: row.rg != null ? String(row.rg) : '',
    passport: row.passaporte != null ? String(row.passaporte) : '',
    cep: row.cep != null ? String(row.cep) : '',
    logradouro: row.logradouro != null ? String(row.logradouro) : '',
    numero: row.numero != null ? String(row.numero) : '',
    complemento: row.complemento != null ? String(row.complemento) : '',
    bairro: row.bairro != null ? String(row.bairro) : '',
    cidade: row.cidade != null ? String(row.cidade) : '',
    uf: row.uf != null ? String(row.uf).toUpperCase().slice(0, 2) : '',
    formas_pagamento: Array.isArray(row.formas_pagamento) && row.formas_pagamento.length > 0 ? row.formas_pagamento : baseForm.formas_pagamento,
    observacoes: row.observacoes != null ? String(row.observacoes) : '',
    video_url: perfil.video_url != null ? String(perfil.video_url) : '',
    slug_site: perfil.slug_site != null ? String(perfil.slug_site) : '',
    public_info: perfil.public_info != null ? String(perfil.public_info) : '',
    /** URL ou data URL — mesmo nome da coluna na API (`mapModeloRowFotoForApi`). */
    foto_perfil_base64:
      row.foto_perfil_base64 != null && String(row.foto_perfil_base64).trim() !== ''
        ? String(row.foto_perfil_base64).trim()
        : '',
  };
}

function instagramFromRow(row, perfil) {
  const ig = perfil.instagram != null ? String(perfil.instagram) : row.instagram != null ? String(row.instagram) : '';
  return ig;
}

function firstPixChave(formas) {
  const arr = Array.isArray(formas) ? formas : [];
  const pix = arr.find((f) => f && f.tipo === 'PIX');
  if (pix && String(pix.chave_pix || '').trim()) return String(pix.chave_pix).trim();
  return '';
}

function bancoDadosResumo(formas) {
  const arr = Array.isArray(formas) ? formas : [];
  const b = arr.find((f) => f && f.tipo === 'Conta bancária');
  if (!b) return '';
  return [b.banco, b.agencia, b.conta].filter(Boolean).join(' | ');
}

/**
 * Monta corpo para POST/PUT /api/modelos (tabela `modelos`).
 * `crmExtra` = createCrmExtraInitial / crmRowToCrmExtra.
 */
export function buildCrmModeloApiBody(form, crmExtra, apiMediaSnapshot, _mergeFromRow) {
  const nomeCompleto = String(form.nome_completo || '').trim();
  const nomeSite = String(form.nome || '').trim();
  const nomeDb = nomeCompleto || nomeSite;
  const telDigits = (Array.isArray(form.telefones) ? form.telefones : [])
    .map((x) => onlyDigits(String(x || '')))
    .filter((d) => d.length >= 8);
  const emails = (Array.isArray(form.emails) ? form.emails : [])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);

  const sexoLabel = form.catMasculino ? 'Masculino' : 'Feminino';

  const perfil_site = {
    nome_site: nomeSite,
    bio: String(form.bio ?? ''),
    featured: Boolean(form.featured),
    catFeminino: Boolean(form.catFeminino),
    catMasculino: Boolean(form.catMasculino),
    catCreators: Boolean(form.catCreators),
    mostrar_instagram: Boolean(form.mostrar_instagram),
    video_url: String(form.video_url ?? ''),
    public_info: String(form.public_info ?? ''),
    slug_site: String(form.slug_site ?? ''),
    instagram: String(form.instagram ?? ''),
  };

  const cpfDigits = onlyDigits(form.cpf);

  const body = {
    nome: nomeDb,
    cpf: cpfDigits,
    telefone: telDigits[0] || '',
    email: emails[0] || '',
    telefones: telDigits,
    emails,
    data_nascimento: String(form.data_nascimento || '').trim() || null,
    emite_nf_propria: Boolean(crmExtra.emite_nf_propria),
    observacoes: String(form.observacoes ?? ''),
    chave_pix: firstPixChave(form.formas_pagamento),
    banco_dados: bancoDadosResumo(form.formas_pagamento),
    ativo: Boolean(crmExtra.ativo_crm),
    ativo_site: Boolean(form.ativo),
    origem_cadastro: String(crmExtra.origem_cadastro || 'interno'),
    status_cadastro: String(crmExtra.status_cadastro || 'aprovado'),
    sexo: sexoLabel,
    passaporte: String(form.passport ?? ''),
    rg: String(form.rg ?? ''),
    cep: onlyDigits(form.cep),
    logradouro: String(form.logradouro ?? ''),
    numero: String(form.numero ?? ''),
    complemento: String(form.complemento ?? ''),
    bairro: String(form.bairro ?? ''),
    cidade: String(form.cidade ?? ''),
    uf: String(form.uf ?? '')
      .toUpperCase()
      .slice(0, 2),
    instagram: String(form.instagram ?? ''),
    tiktok: String(form.tiktok ?? ''),
    formas_pagamento: Array.isArray(form.formas_pagamento) ? form.formas_pagamento : [],
    medida_altura: String(form.medida_altura ?? ''),
    medida_busto: String(form.medida_busto ?? ''),
    medida_torax: String(form.medida_torax ?? ''),
    medida_cintura: String(form.medida_cintura ?? ''),
    medida_quadril: String(form.medida_quadril ?? ''),
    medida_sapato: String(form.medida_sapato ?? ''),
    medida_cabelo: String(form.medida_cabelo ?? ''),
    medida_olhos: String(form.medida_olhos ?? ''),
    responsavel_nome: String(crmExtra.responsavel_nome ?? ''),
    responsavel_cpf: onlyDigits(crmExtra.responsavel_cpf || ''),
    responsavel_telefone: onlyDigits(crmExtra.responsavel_telefone || ''),
    perfil_site,
    foto_perfil_base64: String(form.foto_perfil_base64 ?? '').trim(),
  };
  return body;
}
