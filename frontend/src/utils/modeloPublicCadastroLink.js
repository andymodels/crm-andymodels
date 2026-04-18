/**
 * Corpo JSON para POST /api/public/cadastro-modelo — mesmo contrato do fluxo antigo do link (token).
 * Usado pelo WebsiteModeloEditorPage em persistenceMode=cadastro_link.
 */

import { sanitizeAndValidateModelo, onlyDigits } from './brValidators';
import { sanitizeAndValidateFormasPagamentoArray } from './formasPagamento';

function trimStr(v) {
  return String(v ?? '').trim();
}

/** Valida medidas obrigatórias conforme sexo (Feminino/Masculino) a partir do formulário unificado. */
function validateMedidasWebsiteForm(form) {
  const fem = Boolean(form.catFeminino);
  const masc = Boolean(form.catMasculino);
  if (!fem && !masc) {
    return 'Indique Feminino ou Masculino na secção Identificação para validar as medidas.';
  }
  if (fem) {
    const need = [
      ['medida_altura', 'Altura'],
      ['medida_busto', 'Busto'],
      ['medida_cintura', 'Cintura'],
      ['medida_quadril', 'Quadril'],
      ['medida_sapato', 'Sapato'],
      ['medida_cabelo', 'Cabelo'],
      ['medida_olhos', 'Olhos'],
    ];
    for (const [key, label] of need) {
      if (!trimStr(form[key])) return `${label} é obrigatório.`;
    }
    return null;
  }
  const need = [
    ['medida_altura', 'Altura'],
    ['medida_torax', 'Tórax'],
    ['medida_cintura', 'Cintura'],
    ['medida_sapato', 'Sapato'],
    ['medida_cabelo', 'Cabelo'],
    ['medida_olhos', 'Olhos'],
  ];
  for (const [key, label] of need) {
    if (!trimStr(form[key])) return `${label} é obrigatório.`;
  }
  return null;
}

/**
 * @param {object} form — estado WebsiteModeloEditorPage (createInitialForm)
 * @param {object} crmExtra — responsável para menor (mesmo que CRM)
 * @param {{ senha_acesso: string, foto_perfil_base64: string, emite_nf_propria: boolean }} linkExtras
 * @param {string} token
 * @returns {{ ok: true, body: object } | { ok: false, message: string }}
 */
export function validateAndBuildPublicCadastroBody(form, crmExtra, linkExtras, token) {
  const t = trimStr(token);
  if (!t) return { ok: false, message: 'Token em falta.' };

  const nomeCompleto = trimStr(form.nome_completo);
  const nomeSite = trimStr(form.nome);
  const nomePrincipal = nomeCompleto || nomeSite;
  if (!nomePrincipal) {
    return { ok: false, message: 'Preencha «Nome completo».' };
  }

  const telefones = (Array.isArray(form.telefones) ? form.telefones : [])
    .map((v) => onlyDigits(String(v || '')))
    .filter(Boolean);
  const emails = (Array.isArray(form.emails) ? form.emails : [])
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);

  if (telefones.length === 0 || emails.length === 0) {
    return { ok: false, message: 'Informe ao menos um telefone e um e-mail válidos.' };
  }

  if (
    !trimStr(form.cep) ||
    !trimStr(form.logradouro) ||
    !trimStr(form.numero) ||
    !trimStr(form.bairro) ||
    !trimStr(form.cidade) ||
    !trimStr(form.uf)
  ) {
    return { ok: false, message: 'Preencha CEP, logradouro, número, bairro, cidade e UF.' };
  }

  const senhaAcesso = String(linkExtras?.senha_acesso || '').trim();
  if (!senhaAcesso || senhaAcesso.length < 8) {
    return { ok: false, message: 'Defina uma senha de acesso com no mínimo 8 caracteres.' };
  }

  const idade = (() => {
    const ymd = trimStr(form.data_nascimento);
    if (!ymd) return null;
    const p = ymd.split('-').map((x) => parseInt(x, 10));
    if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
    const nasc = new Date(p[0], p[1] - 1, p[2]);
    if (Number.isNaN(nasc.getTime())) return null;
    const hoje = new Date();
    let id = hoje.getFullYear() - nasc.getFullYear();
    const dm = hoje.getMonth() - nasc.getMonth();
    if (dm < 0 || (dm === 0 && hoje.getDate() < nasc.getDate())) id -= 1;
    return id;
  })();

  const isMinor = idade !== null && idade < 18;
  if (
    isMinor &&
    (!trimStr(crmExtra?.responsavel_nome) ||
      !trimStr(crmExtra?.responsavel_cpf) ||
      !trimStr(crmExtra?.responsavel_telefone))
  ) {
    return {
      ok: false,
      message: 'Modelo menor de idade: preencha nome, CPF e telefone do responsável.',
    };
  }

  const medErr = validateMedidasWebsiteForm(form);
  if (medErr) return { ok: false, message: medErr };

  const fr = sanitizeAndValidateFormasPagamentoArray(form.formas_pagamento);
  if (!fr.ok) return { ok: false, message: fr.message };

  const sexoStr = form.catMasculino ? 'Masculino' : 'Feminino';

  const payload = {
    nome: nomePrincipal,
    cpf: form.cpf,
    data_nascimento: form.data_nascimento,
    telefones,
    emails,
    telefone: telefones[0],
    email: emails[0],
    emite_nf_propria: Boolean(linkExtras?.emite_nf_propria),
    responsavel_nome: trimStr(crmExtra?.responsavel_nome),
    responsavel_cpf: crmExtra?.responsavel_cpf,
    responsavel_telefone: crmExtra?.responsavel_telefone,
    observacoes: trimStr(form.observacoes),
    sexo: sexoStr,
    medida_altura: form.medida_altura,
    medida_busto: form.medida_busto,
    medida_torax: form.medida_torax,
    medida_cintura: form.medida_cintura,
    medida_quadril: form.medida_quadril,
    medida_sapato: form.medida_sapato,
    medida_cabelo: form.medida_cabelo,
    medida_olhos: form.medida_olhos,
    formas_pagamento: fr.formas,
    ativo: false,
  };

  const sv = sanitizeAndValidateModelo(payload, false);
  if (!sv.ok) return { ok: false, message: sv.message };

  const body = {
    nome: sv.body.nome,
    cpf: sv.body.cpf,
    passaporte: trimStr(form.passport),
    rg: trimStr(form.rg),
    data_nascimento: sv.body.data_nascimento,
    telefones: sv.body.telefones,
    emails: sv.body.emails,
    emite_nf_propria: sv.body.emite_nf_propria,
    observacoes: sv.body.observacoes,
    sexo: sexoStr,
    cep: trimStr(form.cep),
    logradouro: trimStr(form.logradouro),
    numero: trimStr(form.numero),
    complemento: trimStr(form.complemento),
    bairro: trimStr(form.bairro),
    cidade: trimStr(form.cidade),
    uf: trimStr(form.uf).toUpperCase().slice(0, 2),
    formas_pagamento: fr.formas,
    medida_altura: trimStr(form.medida_altura),
    medida_busto: trimStr(form.medida_busto),
    medida_torax: trimStr(form.medida_torax),
    medida_cintura: trimStr(form.medida_cintura),
    medida_quadril: trimStr(form.medida_quadril),
    medida_sapato: trimStr(form.medida_sapato),
    medida_cabelo: trimStr(form.medida_cabelo),
    medida_olhos: trimStr(form.medida_olhos),
    foto_perfil_base64: trimStr(linkExtras?.foto_perfil_base64),
    senha_acesso: senhaAcesso,
    token: t,
  };

  if (isMinor) {
    body.responsavel_nome = sv.body.responsavel_nome;
    body.responsavel_cpf = sv.body.responsavel_cpf;
    body.responsavel_telefone = sv.body.responsavel_telefone;
  }

  return { ok: true, body };
}
