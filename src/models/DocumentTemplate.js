const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentTemplate = sequelize.define('DocumentTemplate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  category: {
    type: DataTypes.STRING(100),
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
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'document_templates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = { DocumentTemplate };
