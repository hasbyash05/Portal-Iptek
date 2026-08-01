const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const KasExpense = sequelize.define('KasExpense', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'kas_expenses',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = { KasExpense };
