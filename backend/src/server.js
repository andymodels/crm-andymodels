require('dotenv').config();

const app = require('./app');

// Render (e outros PaaS) definhem PORT; localmente usa 3001. PORT vem como string no ambiente.
const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

function start() {
  try {
    app.listen(PORT, HOST, () => {
      console.log(`API running on http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start API:', error.message);
    process.exit(1);
  }
}

start();
