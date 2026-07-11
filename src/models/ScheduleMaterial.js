const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ScheduleMaterial = sequelize.define('ScheduleMaterial', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schedule_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  material_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'schedule_materials',
  timestamps: false
});

module.exports = { ScheduleMaterial };
