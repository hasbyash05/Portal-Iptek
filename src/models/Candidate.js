const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Candidate = sequelize.define('Candidate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  election_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  nomor_urut: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  nama_calon: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  nim: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  prodi: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  visi: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  misi: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  program_unggulan: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  foto_url: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'candidates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = { Candidate };
