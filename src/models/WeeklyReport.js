const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WeeklyReport = sequelize.define('WeeklyReport', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  week_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  activity: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  attachment_path: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'weekly_reports',
  timestamps: true,
  createdAt: 'submitted_at',
  updatedAt: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'week_number', 'year']
    }
  ]
});

module.exports = { WeeklyReport };
