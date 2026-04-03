require('dotenv').config();

const app = require('./app');
const { initDb } = require('./config/db');

const PORT = process.env.PORT || 3001;

const start = async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`API running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start API:', error.message);
    process.exit(1);
  }
};

start();
