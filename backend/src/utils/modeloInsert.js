const { stringifyJsonbColumns } = require('./jsonbBody');

/**
 * INSERT em `modelos` com o mesmo formato do CRUD interno (body já validado).
 */
async function insertModeloRow(pool, body) {
  stringifyJsonbColumns(body);
  const columns = Object.keys(body);
  const values = Object.values(body);
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
  const query = `
    INSERT INTO modelos (${columns.join(', ')})
    VALUES (${placeholders})
    RETURNING *
  `;
  const result = await pool.query(query, values);
  return result.rows[0];
}

module.exports = { insertModeloRow };
