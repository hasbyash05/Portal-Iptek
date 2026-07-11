const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Attendance = sequelize.define('Attendance', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('hadir', 'izin', 'sakit', 'alpa'),
    allowNull: false
  },
  device_fingerprint: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
}, {
  tableName: 'attendances',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'date']
    }
  ]
});

module.exports = { Attendance };
