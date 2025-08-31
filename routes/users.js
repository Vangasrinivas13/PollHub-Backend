const express = require('express');
const User = require('../models/User');
const Vote = require('../models/Vote');
const Poll = require('../models/Poll');
const { authenticateToken } = require('../middleware/auth');
const { validateMongoId, validatePagination } = require('../middleware/validation');

const router = express.Router();

// @route   GET /api/users/profile
// @desc    Get current user's detailed profile
// @access  Private
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    const userStats = user.getStats();

    // Get recent voting activity
    const recentVotes = await Vote.getUserVotingHistory(user._id, 10);

    res.json({
      profile: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        profilePicture: user.profilePicture,
        phoneNumber: user.phoneNumber,
        dateOfBirth: user.dateOfBirth,
        address: user.address,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      stats: userStats,
      recentActivity: recentVotes.map(vote => ({
        pollTitle: vote.pollId.title,
        optionText: vote.optionText,
        votedAt: vote.createdAt
      }))
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

// @route   GET /api/users/voting-history
// @desc    Get user's complete voting history with pagination
// @access  Private
router.get('/voting-history', authenticateToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const votes = await Vote.find({ userId: req.user._id })
      .populate('pollId', 'title description status endDate category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Vote.countDocuments({ userId: req.user._id });

    const votingHistory = votes.map(vote => ({
      id: vote._id,
      poll: {
        id: vote.pollId._id,
        title: vote.pollId.title,
        description: vote.pollId.description,
        status: vote.pollId.status,
        endDate: vote.pollId.endDate,
        category: vote.pollId.category
      },
      optionIndex: vote.optionIndex,
      optionText: vote.optionText,
      votedAt: vote.createdAt,
      isAnonymous: vote.isAnonymous
    }));

    res.json({
      votes: votingHistory,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalVotes: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get voting history error:', error);
    res.status(500).json({ message: 'Server error fetching voting history' });
  }
});

// @route   GET /api/users/stats
// @desc    Get user's voting statistics
// @access  Private
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const userStats = user.getStats();

    // Get voting patterns by category
    const categoryStats = await Vote.aggregate([
      { $match: { userId: user._id } },
      {
        $lookup: {
          from: 'polls',
          localField: 'pollId',
          foreignField: '_id',
          as: 'poll'
        }
      },
      { $unwind: '$poll' },
      {
        $group: {
          _id: '$poll.category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get monthly voting activity for the last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const monthlyActivity = await Vote.aggregate([
      {
        $match: {
          userId: user._id,
          createdAt: { $gte: twelveMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      overview: userStats,
      categoryBreakdown: categoryStats,
      monthlyActivity: monthlyActivity,
      achievements: {
        firstVote: user.votedPolls.length > 0 ? user.votedPolls[0].votedAt : null,
        totalPolls: user.votedPolls.length,
        streak: 0 // Could implement voting streak logic
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ message: 'Server error fetching user statistics' });
  }
});

// @route   GET /api/users/dashboard
// @desc    Get user dashboard data
// @access  Private
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Get all polls first to see what exists
    const allPolls = await Poll.find({}).populate('createdBy', 'name').sort({ createdAt: -1 });
    
    // Get active polls user hasn't voted on
    const activePolls = await Poll.find({
      status: 'active',
      isPublic: true,
      votedUsers: { $ne: user._id }
    })
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .limit(10);

    // Get recent polls user has voted on
    const recentVotedPolls = await Vote.find({ userId: user._id })
      .populate('pollId', 'title status endDate totalVotes')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get user stats
    const userStats = user.getStats();

    res.json({
      user: {
        name: user.name,
        role: user.role,
        joinDate: user.createdAt
      },
      stats: userStats,
      availablePolls: activePolls.map(poll => ({
        id: poll._id,
        title: poll.title,
        description: poll.description,
        endDate: poll.endDate,
        totalVotes: poll.totalVotes,
        createdBy: poll.createdBy.name,
        timeRemaining: poll.timeRemaining
      })),
      recentVotes: recentVotedPolls.map(vote => ({
        poll: {
          id: vote.pollId._id,
          title: vote.pollId.title,
          status: vote.pollId.status,
          endDate: vote.pollId.endDate,
          totalVotes: vote.pollId.totalVotes
        },
        optionText: vote.optionText,
        votedAt: vote.createdAt
      }))
    });
  } catch (error) {
    console.error('Get user dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
});

// @route   PUT /api/users/preferences
// @desc    Update user preferences
// @access  Private
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const { emailNotifications, pushNotifications, language, timezone } = req.body;

    const user = await User.findById(req.user._id);
    
    // Initialize preferences object if it doesn't exist
    if (!user.preferences) {
      user.preferences = {};
    }

    // Update preferences
    if (emailNotifications !== undefined) user.preferences.emailNotifications = emailNotifications;
    if (pushNotifications !== undefined) user.preferences.pushNotifications = pushNotifications;
    if (language !== undefined) user.preferences.language = language;
    if (timezone !== undefined) user.preferences.timezone = timezone;

    await user.save();

    res.json({
      message: 'Preferences updated successfully',
      preferences: user.preferences
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ message: 'Server error updating preferences' });
  }
});

// @route   GET /api/users/leaderboard
// @desc    Get voting leaderboard
// @access  Private
router.get('/leaderboard', authenticateToken, async (req, res) => {
  try {
    const { limit = 10, period = 'all' } = req.query;

    let matchStage = {};
    
    if (period !== 'all') {
      let startDate;
      switch (period) {
        case 'week':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
          break;
      }
      
      if (startDate) {
        matchStage.createdAt = { $gte: startDate };
      }
    }

    const leaderboard = await Vote.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$userId',
          voteCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          name: '$user.name',
          voteCount: 1,
          joinDate: '$user.createdAt'
        }
      },
      { $sort: { voteCount: -1 } },
      { $limit: parseInt(limit) }
    ]);

    // Add current user's rank if not in top list
    const currentUserRank = await Vote.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$userId',
          voteCount: { $sum: 1 }
        }
      },
      { $sort: { voteCount: -1 } },
      {
        $group: {
          _id: null,
          users: { $push: { userId: '$_id', voteCount: '$voteCount' } }
        }
      },
      {
        $project: {
          rank: {
            $indexOfArray: ['$users.userId', req.user._id]
          },
          userVotes: {
            $arrayElemAt: [
              '$users.voteCount',
              { $indexOfArray: ['$users.userId', req.user._id] }
            ]
          }
        }
      }
    ]);

    const userRank = currentUserRank.length > 0 ? {
      rank: currentUserRank[0].rank + 1,
      votes: currentUserRank[0].userVotes || 0
    } : { rank: null, votes: 0 };

    res.json({
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        name: entry.name,
        voteCount: entry.voteCount,
        joinDate: entry.joinDate
      })),
      currentUser: {
        ...userRank,
        name: req.user.name
      },
      period
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ message: 'Server error fetching leaderboard' });
  }
});

module.exports = router;
