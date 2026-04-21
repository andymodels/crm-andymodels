/**
 * Mesmos campos obrigatórios de POST /api/modelos (makeCrudRoutes modelos em cadastros.js).
 */

/** Campos obrigatorios: strings vazias e arrays vazios contam como faltando (backend nao confia no frontend). */
function missingRequiredFields(body, requiredFields) {
  return requiredFields.filter((field) => {
    const v = body[field];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}

const MODEL_POST_REQUIRED_FIELDS = [
  'nome',
  'cpf',
  'telefone',
  'email',
  'emite_nf_propria',
  'data_nascimento',
  'telefones',
  'emails',
  'formas_pagamento',
  'ativo',
];

module.exports = {
  missingRequiredFields,
  MODEL_POST_REQUIRED_FIELDS,
};
