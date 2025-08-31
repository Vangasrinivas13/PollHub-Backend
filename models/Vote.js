const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  pollId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  optionIndex: {
    type: Number,
    required: true,
    min: 0
  },
  optionText: {
    type: String,
    required: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  metadata: {
    deviceType: String,
    browser: String,
    os: String,
    location: {
      country: String,
      city: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    }
  }
}, {
  timestamps: true
});

// Compound index to ensure one vote per user per poll (unless multiple votes allowed)
voteSchema.index({ pollId: 1, userId: 1 });
voteSchema.index({ pollId: 1, createdAt: -1 });
voteSchema.index({ userId: 1, createdAt: -1 });

// Static method to get vote statistics for a poll
voteSchema.statics.getPollVoteStats = async function(pollId) {
  const stats = await this.aggregate([
    { $match: { pollId: mongoose.Types.ObjectId(pollId) } },
    {
      $group: {
        _id: '$optionIndex',
        count: { $sum: 1 },
        optionText: { $first: '$optionText' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  
  return stats;
};

// Static method to get user's voting history
voteSchema.statics.getUserVotingHistory = function(userId, limit = 50) {
  return this.find({ userId })
    .populate('pollId', 'title description status endDate')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get recent votes for admin dashboard
voteSchema.statics.getRecentVotes = function(limit = 20) {
  return this.find()
    .populate('userId', 'name email')
    .populate('pollId', 'title')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get detailed vote analytics
voteSchema.statics.getVoteAnalytics = async function(pollId) {
  const analytics = await this.aggregate([
    { $match: { pollId: mongoose.Types.ObjectId(pollId) } },
    {
      $group: {
        _id: {
          option: '$optionIndex',
          hour: { $hour: '$createdAt' },
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
        },
        count: { $sum: 1 },
        optionText: { $first: '$optionText' }
      }
    },
    { $sort: { '_id.date': 1, '_id.hour': 1 } }
  ]);
  
  return analytics;
};

// Static method to get voter demographics for a poll
voteSchema.statics.getVoterDemographics = async function(pollId) {
  const demographics = await this.aggregate([
    { $match: { pollId: mongoose.Types.ObjectId(pollId) } },
    { $group: { _id: '$userId' } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    {
      $group: {
        _id: {
          registrationMonth: { $month: '$user.createdAt' },
          registrationYear: { $year: '$user.createdAt' }
        },
        count: { $sum: 1 },
        users: { $push: { name: '$user.name', email: '$user.email' } }
      }
    },
    { $sort: { '_id.registrationYear': -1, '_id.registrationMonth': -1 } }
  ]);
  
  return demographics;
};

module.exports = mongoose.model('Vote', voteSchema);
