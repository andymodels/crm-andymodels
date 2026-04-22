/**
 * Corpo JSON para POST /api/public/cadastro-modelo — mesmo contrato que POST /api/modelos (buildCrmModeloApiBody)
 * + token e senha_acesso para o fluxo do link.
 */

import { onlyDigits } from './brValidators';
import { sanitizeAndValidateFormasPagamentoArray } from './formasPagamento';
import { buildCrmModeloApiBody, createCrmExtraInitial } from './modeloCrmFormMap';

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
      ['medida_torax', 'Tamanho (SIZE)'],
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
    ['medida_busto', 'Terno (SUIT)'],
    ['medida_cintura', 'Camisa (SHIRT)'],
    ['medida_quadril', 'Tamanho (SIZE)'],
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

  const crmMerged = {
    ...createCrmExtraInitial(),
    ...(crmExtra && typeof crmExtra === 'object' ? crmExtra : {}),
    emite_nf_propria: Boolean(linkExtras?.emite_nf_propria),
    ativo_crm: false,
  };

  const built = buildCrmModeloApiBody(form, crmMerged, [], null);
  built.formas_pagamento = fr.formas;
  const linkFoto = trimStr(linkExtras?.foto_perfil_base64);
  if (linkFoto) built.foto_perfil_base64 = linkFoto;

  return {
    ok: true,
    body: {
      ...built,
      token: t,
      senha_acesso: senhaAcesso,
    },
  };
}
