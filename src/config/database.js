require('dotenv').config();
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'mysql';

const config = {
  dialect: dialect,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_iptek',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  timezone: '+07:00', // Asia/Jakarta
  dialectOptions: {
    charset: 'utf8mb4',
    connectTimeout: 10000
  },
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci'
  }
};

const sequelize = new Sequelize(config);

module.exports = { sequelize };
