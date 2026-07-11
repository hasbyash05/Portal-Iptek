const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AttendanceSession = sequelize.define('AttendanceSession', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  activated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  activated_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'attendance_sessions',
  timestamps: false
});

module.exports = { AttendanceSession };
