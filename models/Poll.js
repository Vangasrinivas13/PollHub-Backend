const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, 'Option text is required'],
    trim: true,
    maxlength: [200, 'Option text cannot exceed 200 characters']
  },
  votes: {
    type: Number,
    default: 0,
    min: 0
  },
  voters: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    votedAt: {
      type: Date,
      default: Date.now
    }
  }]
});

const pollSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Poll title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Poll description is required'],
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  options: {
    type: [optionSchema],
    validate: {
      validator: function(options) {
        return options.length >= 2 && options.length <= 10;
      },
      message: 'Poll must have between 2 and 10 options'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required'],
    default: Date.now
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required'],
    validate: {
      validator: function(endDate) {
        return endDate > this.startDate;
      },
      message: 'End date must be after start date'
    }
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'completed', 'cancelled'],
    default: 'active'
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  allowMultipleVotes: {
    type: Boolean,
    default: false
  },
  showResultsBeforeEnd: {
    type: Boolean,
    default: false
  },
  showResultsAfterVoting: {
    type: Boolean,
    default: true
  },
  requireAuth: {
    type: Boolean,
    default: true
  },
  category: {
    type: String,
    enum: ['general', 'political', 'entertainment', 'sports', 'technology', 'education', 'business', 'other'],
    default: 'general'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  totalVotes: {
    type: Number,
    default: 0,
    min: 0
  },
  uniqueVoters: {
    type: Number,
    default: 0,
    min: 0
  },
  votedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  settings: {
    anonymousVoting: {
      type: Boolean,
      default: false
    },
    allowComments: {
      type: Boolean,
      default: false
    },
    maxVotesPerUser: {
      type: Number,
      default: 1,
      min: 1
    },
    shuffleOptions: {
      type: Boolean,
      default: false
    }
  },
  metadata: {
    views: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    },
    featured: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
});

// Indexes for better query performance
pollSchema.index({ status: 1, startDate: 1, endDate: 1 });
pollSchema.index({ createdBy: 1 });
pollSchema.index({ category: 1 });
pollSchema.index({ tags: 1 });
pollSchema.index({ 'metadata.featured': 1 });

// Virtual for checking if poll is currently active
pollSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         this.startDate <= now && 
         this.endDate > now;
});

// Virtual for checking if poll has ended
pollSchema.virtual('hasEnded').get(function() {
  return new Date() > this.endDate;
});

// Virtual for getting poll duration in days
pollSchema.virtual('durationInDays').get(function() {
  const diffTime = Math.abs(this.endDate - this.startDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for getting time remaining
pollSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  if (now > this.endDate) return 0;
  return this.endDate - now;
});

// Pre-save middleware to update poll status based on dates
pollSchema.pre('save', function(next) {
  const now = new Date();
  
  if (this.status === 'active') {
    if (now < this.startDate) {
      this.status = 'draft';
    } else if (now > this.endDate) {
      this.status = 'completed';
    }
  }
  
  next();
});

// Method to check if user can vote
pollSchema.methods.canUserVote = function(userId) {
  if (!this.isActive) return { canVote: false, reason: 'Poll is not active' };
  
  const maxVotesAllowed = this.settings.maxVotesPerUser || 1;
  
  // Count how many times this user has voted
  const userVoteCount = this.options.reduce((count, option) => {
    return count + option.voters.filter(voter => voter.userId.toString() === userId.toString()).length;
  }, 0);
  
  if (userVoteCount >= maxVotesAllowed) {
    return { canVote: false, reason: `Maximum votes per user reached (${maxVotesAllowed})` };
  }
  
  return { canVote: true };
};

// Method to add vote
pollSchema.methods.addVote = async function(userId, optionIndex) {
  const canVoteResult = this.canUserVote(userId);
  if (!canVoteResult.canVote) {
    throw new Error(canVoteResult.reason);
  }
  
  if (optionIndex < 0 || optionIndex >= this.options.length) {
    throw new Error('Invalid option index');
  }
  
  // Add vote to option
  this.options[optionIndex].votes += 1;
  this.options[optionIndex].voters.push({ userId });
  
  // Update poll totals
  this.totalVotes += 1;
  
  // Add user to voted users if not already present
  if (!this.votedUsers.includes(userId)) {
    this.votedUsers.push(userId);
    this.uniqueVoters += 1;
  }
  
  return this.save();
};

// Method to get poll results
pollSchema.methods.getResults = function() {
  const results = this.options.map(option => ({
    text: option.text,
    votes: option.votes,
    percentage: this.totalVotes > 0 ? ((option.votes / this.totalVotes) * 100).toFixed(2) : 0
  }));
  
  return {
    pollId: this._id,
    title: this.title,
    totalVotes: this.totalVotes,
    uniqueVoters: this.uniqueVoters,
    results,
    status: this.status,
    endDate: this.endDate,
    hasEnded: this.hasEnded
  };
};

// Method to get poll summary for admin
pollSchema.methods.getAdminSummary = function() {
  return {
    ...this.getResults(),
    createdBy: this.createdBy,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    views: this.metadata.views,
    category: this.category,
    tags: this.tags
  };
};

// Static method to get active polls
pollSchema.statics.getActivePolls = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gt: now }
  }).populate('createdBy', 'name email');
};

// Static method to get poll statistics
pollSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalPolls: { $sum: 1 },
        activePolls: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        completedPolls: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalVotes: { $sum: '$totalVotes' },
        totalUniqueVoters: { $sum: '$uniqueVoters' }
      }
    }
  ]);
  
  return stats[0] || {
    totalPolls: 0,
    activePolls: 0,
    completedPolls: 0,
    totalVotes: 0,
    totalUniqueVoters: 0
  };
};

// Static method to get trending polls
pollSchema.statics.getTrendingPolls = function(limit = 10) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  return this.find({
    status: 'active',
    createdAt: { $gte: oneDayAgo }
  })
  .sort({ totalVotes: -1, 'metadata.views': -1 })
  .limit(limit)
  .populate('createdBy', 'name');
};

module.exports = mongoose.model('Poll', pollSchema);
