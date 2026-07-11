const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TeachingMaterial = sequelize.define('TeachingMaterial', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  file_path: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  week_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'teaching_materials',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = { TeachingMaterial };
