const { sequelize } = require('../config/database');
const { User } = require('./User');
const { WeeklyReport } = require('./WeeklyReport');
const { TeachingMaterial } = require('./TeachingMaterial');
const { Attendance } = require('./Attendance');
const { Payment } = require('./Payment');
const { AttendanceSession } = require('./AttendanceSession');
const { UserDevice } = require('./UserDevice');
const { TeachingSchedule } = require('./TeachingSchedule');
const { KasExpense } = require('./KasExpense');

// Associations
User.hasMany(WeeklyReport, { foreignKey: 'user_id', as: 'reports' });
WeeklyReport.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(TeachingMaterial, { foreignKey: 'user_id', as: 'materials' });
TeachingMaterial.belongsTo(User, { foreignKey: 'user_id', as: 'uploader' });

User.hasMany(Attendance, { foreignKey: 'user_id', as: 'attendances' });
Attendance.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Payment, { foreignKey: 'user_id', as: 'payments' });
Payment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Confirmed_by association for payments
User.hasMany(Payment, { foreignKey: 'confirmed_by', as: 'confirmedPayments' });
Payment.belongsTo(User, { foreignKey: 'confirmed_by', as: 'verifier' });

// AttendanceSession - activated_by association
AttendanceSession.belongsTo(User, { foreignKey: 'activated_by', as: 'activator' });

// KasExpense - created_by association
User.hasMany(KasExpense, { foreignKey: 'created_by', as: 'expenses' });
KasExpense.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

// UserDevice - user association
User.hasMany(UserDevice, { foreignKey: 'user_id', as: 'devices' });
UserDevice.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// TeachingSchedule associations
TeachingSchedule.belongsTo(User, { foreignKey: 'instructor_id', as: 'instructor' });
TeachingSchedule.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
TeachingSchedule.belongsTo(TeachingMaterial, { foreignKey: 'material_id', as: 'material' });

const { ScheduleMaterial } = require('./ScheduleMaterial');
TeachingSchedule.belongsToMany(TeachingMaterial, {
  through: ScheduleMaterial,
  foreignKey: 'schedule_id',
  otherKey: 'material_id',
  as: 'materials'
});
TeachingMaterial.belongsToMany(TeachingSchedule, {
  through: ScheduleMaterial,
  foreignKey: 'material_id',
  otherKey: 'schedule_id',
  as: 'schedules'
});

const { DocumentTemplate } = require('./DocumentTemplate');
User.hasMany(DocumentTemplate, { foreignKey: 'uploaded_by', as: 'templates' });
DocumentTemplate.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

const { Certificate } = require('./Certificate');
User.hasMany(Certificate, { foreignKey: 'user_id', as: 'certificates' });
Certificate.belongsTo(User, { foreignKey: 'user_id', as: 'owner' });
User.hasMany(Certificate, { foreignKey: 'uploaded_by', as: 'uploadedCertificates' });
Certificate.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// Election, Candidate, and Vote associations
const { Election } = require('./Election');
const { Candidate } = require('./Candidate');
const { Vote } = require('./Vote');

Election.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Election.hasMany(Candidate, { foreignKey: 'election_id', as: 'candidates', onDelete: 'CASCADE' });
Candidate.belongsTo(Election, { foreignKey: 'election_id', as: 'election' });

Election.hasMany(Vote, { foreignKey: 'election_id', as: 'votes', onDelete: 'CASCADE' });
Vote.belongsTo(Election, { foreignKey: 'election_id', as: 'election' });

Candidate.hasMany(Vote, { foreignKey: 'candidate_id', as: 'votes', onDelete: 'CASCADE' });
Vote.belongsTo(Candidate, { foreignKey: 'candidate_id', as: 'candidate' });

User.hasMany(Vote, { foreignKey: 'user_id', as: 'votes' });
Vote.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

module.exports = {
  sequelize,
  User,
  WeeklyReport,
  TeachingMaterial,
  Attendance,
  Payment,
  AttendanceSession,
  UserDevice,
  TeachingSchedule,
  ScheduleMaterial,
  DocumentTemplate,
  KasExpense,
  Certificate,
  Election,
  Candidate,
  Vote
};

