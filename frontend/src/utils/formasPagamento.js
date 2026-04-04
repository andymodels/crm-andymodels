import {
  onlyDigits,
  isValidCPF,
  isValidCNPJ,
  isValidEmail,
  isValidPhoneBR,
} from './brValidators.js';

export const TIPOS_CHAVE_PIX = ['CPF', 'CNPJ', 'E-mail', 'Celular', 'Aleatória'];

export function validateChavePixValue(tipoChave, raw) {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: false, message: 'Informe a chave Pix.' };

  switch (tipoChave) {
    case 'CPF': {
      const d = onlyDigits(t);
      if (!isValidCPF(d)) return { ok: false, message: 'CPF da chave Pix invalido.' };
      return { ok: true, value: d };
    }
    case 'CNPJ': {
      const d = onlyDigits(t);
      if (!isValidCNPJ(d)) return { ok: false, message: 'CNPJ da chave Pix invalido.' };
      return { ok: true, value: d };
    }
    case 'E-mail': {
      const e = t.toLowerCase();
      if (!isValidEmail(e)) return { ok: false, message: 'E-mail da chave Pix invalido.' };
      return { ok: true, value: e };
    }
    case 'Celular': {
      const d = onlyDigits(t);
      if (!isValidPhoneBR(d)) return { ok: false, message: 'Telefone da chave Pix invalido (DDD + 8 ou 9 digitos).' };
      return { ok: true, value: d };
    }
    case 'Aleatória': {
      const s = t.replace(/\s/g, '');
      const hex32 = /^[0-9a-fA-F]{32}$/;
      const uuid =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
      if (!hex32.test(s) && !uuid.test(s)) {
        return {
          ok: false,
          message: 'Chave aleatoria invalida. Use 32 caracteres hexadecimais ou UUID.',
        };
      }
      return { ok: true, value: s.toLowerCase() };
    }
    default:
      return { ok: false, message: 'Tipo de chave Pix invalido.' };
  }
}

export function validateContaBancariaBr(item, indexLabel) {
  const banco = String(item.banco ?? '').trim();
  const agencia = onlyDigits(String(item.agencia ?? ''));
  const conta = onlyDigits(String(item.conta ?? ''));
  const tipoConta = item.tipo_conta === 'poupanca' ? 'poupanca' : 'corrente';

  if (banco.length < 2 || banco.length > 120) {
    return {
      ok: false,
      message: `${indexLabel}: informe o banco (nome ou codigo de 3 digitos).`,
    };
  }
  if (agencia.length < 4) {
    return { ok: false, message: `${indexLabel}: agencia invalida (minimo 4 digitos).` };
  }
  if (conta.length < 5) {
    return { ok: false, message: `${indexLabel}: conta invalida (minimo 5 digitos).` };
  }

  return {
    ok: true,
    value: {
      tipo: 'Conta bancária',
      banco,
      agencia,
      conta,
      tipo_conta: tipoConta,
    },
  };
}

export function sanitizeAndValidateFormasPagamentoArray(formas) {
  const arr = Array.isArray(formas) ? formas : [];
  if (arr.length === 0) {
    return { ok: false, message: 'Informe ao menos uma forma de recebimento.' };
  }

  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const idx = `Forma ${i + 1}`;
    if (!item || typeof item !== 'object') continue;

    const tipo = item.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX';

    if (tipo === 'PIX') {
      const tipoChave = item.tipo_chave_pix || 'CPF';
      if (!TIPOS_CHAVE_PIX.includes(tipoChave)) {
        return { ok: false, message: `${idx}: selecione o tipo de chave Pix.` };
      }
      const raw =
        item.chave_pix != null && String(item.chave_pix).trim() !== ''
          ? String(item.chave_pix).trim()
          : String(item.valor || '').trim();
      const ch = validateChavePixValue(tipoChave, raw);
      if (!ch.ok) return { ok: false, message: `${idx} (Pix): ${ch.message}` };
      out.push({
        tipo: 'PIX',
        tipo_chave_pix: tipoChave,
        chave_pix: ch.value,
      });
    } else {
      const legacyValor = String(item.valor || '').trim();
      const merged = {
        banco: item.banco != null ? item.banco : '',
        agencia: item.agencia != null ? item.agencia : '',
        conta: item.conta != null ? item.conta : '',
        tipo_conta: item.tipo_conta,
      };
      if (!String(merged.banco).trim() && !String(merged.agencia).trim() && !String(merged.conta).trim() && legacyValor) {
        merged.conta = legacyValor;
      }
      const bc = validateContaBancariaBr(merged, idx);
      if (!bc.ok) return { ok: false, message: bc.message };
      out.push(bc.value);
    }
  }

  if (out.length === 0) {
    return { ok: false, message: 'Informe ao menos uma forma de recebimento valida.' };
  }

  return { ok: true, formas: out };
}
