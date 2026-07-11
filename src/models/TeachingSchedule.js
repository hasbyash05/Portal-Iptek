const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TeachingSchedule = sequelize.define('TeachingSchedule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  topic: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  instructor_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  instructor_name: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  material_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'teaching_schedules',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = { TeachingSchedule };
