const storage = require('./storage');

/**
 * Remove arquivos de os_documentos antes de apagar a O.S. (CASCADE não apaga storage).
 */
async function unlinkDocumentoPaths(rows) {
  for (const r of rows) {
    const sp = r && r.storage_path != null ? String(r.storage_path) : '';
    if (!sp) continue;
    try {
      await storage.removeFile(sp);
    } catch (e) {
      console.warn('[excluirOrcamentoDefinitivo] storage:', e.message);
    }
  }
}

/**
 * Apaga O.S. vinculada (job, contratos em documentos, recebimentos, pagamentos a modelos, etc.) e o orçamento.
 * Uso: administrador / testes — irreversível.
 */
async function excluirOrcamentoDefinitivo(pool, orcamentoId) {
  const id = Number(orcamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, message: 'ID de orcamento invalido.' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exist = await client.query('SELECT id FROM orcamentos WHERE id = $1', [id]);
    if (exist.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Orcamento nao encontrado.' };
    }

    const { rows: osRows } = await client.query(
      `SELECT id FROM ordens_servico WHERE orcamento_id = $1`,
      [id],
    );
    const osIds = osRows.map((r) => r.id);

    if (osIds.length > 0) {
      const { rows: docRows } = await client.query(
        `SELECT storage_path FROM os_documentos WHERE os_id = ANY($1::int[])`,
        [osIds],
      );
      await unlinkDocumentoPaths(docRows);
    }

    await client.query(`DELETE FROM ordens_servico WHERE orcamento_id = $1`, [id]);
    await client.query(`DELETE FROM orcamentos WHERE id = $1`, [id]);

    await client.query('COMMIT');
    return {
      ok: true,
      message: 'Orçamento removido. Job (O.S.), contratos em documentos e lançamentos financeiros vinculados a essa O.S. foram excluídos.',
      os_ids_removidos: osIds,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  excluirOrcamentoDefinitivo,
};
