require('dotenv').config();
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'sqlite';

const config = {
  dialect: dialect,
  logging: process.env.NODE_ENV === 'development' ? console.log : false
};

if (dialect !== 'sqlite') {
  config.timezone = '+07:00'; // Asia/Jakarta (PostgreSQL/MySQL support)
}

if (dialect === 'sqlite') {
  config.storage = process.env.DB_STORAGE || './database.sqlite';
} else {
  config.host = process.env.DB_HOST || 'localhost';
  config.port = process.env.DB_PORT || 5432;
  config.username = process.env.DB_USER || 'postgres';
  config.password = process.env.DB_PASSWORD || 'rahasia';
  config.database = process.env.DB_NAME || 'db_iptek';
}

const sequelize = new Sequelize(config);

module.exports = { sequelize };
