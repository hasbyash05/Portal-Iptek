const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Certificate = sequelize.define('Certificate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  nama_sertifikat: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  file_path: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'certificates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = { Certificate };
