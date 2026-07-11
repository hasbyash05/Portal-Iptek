const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserDevice = sequelize.define('UserDevice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  device_fingerprint: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  device_info: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  first_seen: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  last_seen: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'user_devices',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'device_fingerprint']
    },
    {
      fields: ['device_fingerprint']
    }
  ]
});

module.exports = { UserDevice };
