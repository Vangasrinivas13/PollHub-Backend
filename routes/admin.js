const express = require('express');
const User = require('../models/User');
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateMongoId, validatePagination } = require('../middleware/validation');
const { emitPollDeleted, emitDashboardStats } = require('../utils/websocket');

const router = express.Router();

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin only)
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get user statistics
    const userStats = await User.getStatistics();
    
    // Get poll statistics
    const pollStats = await Poll.getStatistics();
    
    // Get recent activity
    const recentPolls = await Poll.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'name email');
    
    const recentVotes = await Vote.getRecentVotes(10);
    
    // Get trending polls
    const trendingPolls = await Poll.getTrendingPolls(5);
    
    // Calculate additional metrics
    const totalEngagement = pollStats.totalVotes;
    const averageVotesPerPoll = pollStats.totalPolls > 0 ? 
      (pollStats.totalVotes / pollStats.totalPolls).toFixed(2) : 0;
    
    res.json({
      statistics: {
        users: userStats,
        polls: pollStats,
        engagement: {
          totalVotes: totalEngagement,
          averageVotesPerPoll: parseFloat(averageVotesPerPoll),
          participationRate: userStats.totalUsers > 0 ? 
            ((pollStats.totalUniqueVoters / userStats.totalUsers) * 100).toFixed(2) : 0
        }
      },
      recentActivity: {
        polls: recentPolls.map(poll => ({
          id: poll._id,
          title: poll.title,
          status: poll.status,
          totalVotes: poll.totalVotes,
          createdBy: poll.createdBy.name,
          createdAt: poll.createdAt
        })),
        votes: recentVotes.map(vote => ({
          id: vote._id,
          pollTitle: vote.pollId.title,
          voterName: vote.userId.name,
          optionText: vote.optionText,
          votedAt: vote.createdAt
        }))
      },
      trending: trendingPolls.map(poll => ({
        id: poll._id,
        title: poll.title,
        totalVotes: poll.totalVotes,
        views: poll.metadata.views,
        createdBy: poll.createdBy.name
      }))
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination and filters
// @access  Private (Admin only)
router.get('/users', authenticateToken, requireAdmin, validatePagination, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (page - 1) * limit;

    const users = await User.find(filter)
      .select('-password')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    // Add user statistics
    const usersWithStats = users.map(user => ({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      totalVotes: user.votedPolls.length,
      isLocked: user.isLocked
    }));

    res.json({
      users: usersWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get user details
// @access  Private (Admin only)
router.get('/users/:id', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's voting history
    const votingHistory = await Vote.getUserVotingHistory(user._id, 50);
    
    const userDetails = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      profilePicture: user.profilePicture,
      phoneNumber: user.phoneNumber,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      loginAttempts: user.loginAttempts,
      isLocked: user.isLocked,
      stats: user.getStats(),
      recentVotes: votingHistory.slice(0, 10).map(vote => ({
        pollTitle: vote.pollId.title,
        optionText: vote.optionText,
        votedAt: vote.createdAt
      }))
    };

    res.json({ user: userDetails });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({ message: 'Server error fetching user details' });
  }
});

// @route   PUT /api/admin/users/:id/toggle-status
// @desc    Toggle user active status
// @access  Private (Admin only)
router.put('/users/:id/toggle-status', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deactivating themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ message: 'Server error toggling user status' });
  }
});

// @route   PUT /api/admin/users/:id/role
// @desc    Update user role
// @access  Private (Admin only)
router.put('/users/:id/role', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['voter', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from changing their own role
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot change your own role' });
    }

    user.role = role;
    await user.save();

    res.json({
      message: `User role updated to ${role} successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ message: 'Server error updating user role' });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete user (soft delete by deactivating)
// @access  Private (Admin only)
router.delete('/users/:id', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Soft delete by deactivating
    user.isActive = false;
    await user.save();

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

// @route   GET /api/admin/polls
// @desc    Get all polls for admin management
// @access  Private (Admin only)
router.get('/polls', authenticateToken, requireAdmin, validatePagination, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (page - 1) * limit;

    const polls = await Poll.find(filter)
      .populate('createdBy', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Poll.countDocuments(filter);

    const pollsWithDetails = polls.map(poll => ({
      id: poll._id,
      title: poll.title,
      description: poll.description,
      status: poll.status,
      category: poll.category,
      totalVotes: poll.totalVotes,
      uniqueVoters: poll.uniqueVoters,
      views: poll.metadata.views,
      createdBy: poll.createdBy.name,
      createdAt: poll.createdAt,
      startDate: poll.startDate,
      endDate: poll.endDate,
      isActive: poll.isActive,
      hasEnded: poll.hasEnded
    }));

    res.json({
      polls: pollsWithDetails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalPolls: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get admin polls error:', error);
    res.status(500).json({ message: 'Server error fetching polls' });
  }
});

// @route   PUT /api/admin/polls/:id/feature
// @desc    Toggle poll featured status
// @access  Private (Admin only)
router.put('/polls/:id/feature', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    poll.metadata.featured = !poll.metadata.featured;
    await poll.save();

    res.json({
      message: `Poll ${poll.metadata.featured ? 'featured' : 'unfeatured'} successfully`,
      poll: {
        id: poll._id,
        title: poll.title,
        featured: poll.metadata.featured
      }
    });
  } catch (error) {
    console.error('Toggle poll feature error:', error);
    res.status(500).json({ message: 'Server error toggling poll feature status' });
  }
});

// @route   DELETE /api/admin/polls/:id
// @desc    Delete poll and all associated votes
// @access  Private (Admin only)
router.delete('/polls/:id', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).populate('createdBy', 'name');
    
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Store poll data for WebSocket notification before deletion
    const pollData = {
      id: poll._id,
      title: poll.title,
      createdBy: poll.createdBy.name,
      totalVotes: poll.totalVotes
    };

    // Delete all votes associated with this poll
    await Vote.deleteMany({ pollId: poll._id });

    // Remove poll from users' votedPolls arrays
    await User.updateMany(
      { votedPolls: poll._id },
      { $pull: { votedPolls: poll._id } }
    );

    // Delete the poll
    await Poll.findByIdAndDelete(poll._id);

    // Emit real-time notification about poll deletion
    emitPollDeleted(poll._id.toString(), pollData);

    // Update dashboard statistics
    const updatedStats = await Poll.getStatistics();
    emitDashboardStats(updatedStats);

    res.json({ 
      message: 'Poll and all associated data deleted successfully',
      deletedPoll: pollData
    });
  } catch (error) {
    console.error('Delete poll error:', error);
    res.status(500).json({ message: 'Server error deleting poll' });
  }
});

// @route   GET /api/admin/analytics
// @desc    Get detailed analytics
// @access  Private (Admin only)
router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    // Calculate date range
    let startDate;
    switch (period) {
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    // User registration trends
    const userRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Poll creation trends
    const pollCreations = await Poll.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Voting activity trends
    const votingActivity = await Vote.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Category distribution
    const categoryDistribution = await Poll.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalVotes: { $sum: '$totalVotes' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Most active users
    const mostActiveUsers = await User.aggregate([
      {
        $project: {
          name: 1,
          email: 1,
          votedPollsCount: { $size: '$votedPolls' }
        }
      },
      { $sort: { votedPollsCount: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      period,
      trends: {
        userRegistrations,
        pollCreations,
        votingActivity
      },
      distributions: {
        categories: categoryDistribution
      },
      topUsers: mostActiveUsers
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ message: 'Server error fetching analytics' });
  }
});

// @route   GET /api/admin/polls/:id/voters
// @desc    Get detailed voter information for a specific poll
// @access  Private (Admin only)
router.get('/polls/:id/voters', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Get all votes for this poll with detailed user information
    const votes = await Vote.find({ pollId: req.params.id })
      .populate('userId', 'name email profilePicture createdAt lastLogin')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalVotes = await Vote.countDocuments({ pollId: req.params.id });

    // Group votes by option for detailed breakdown
    const votesByOption = {};
    poll.options.forEach((option, index) => {
      votesByOption[index] = {
        optionText: option.text,
        votes: [],
        count: 0
      };
    });

    votes.forEach(vote => {
      if (votesByOption[vote.optionIndex]) {
        votesByOption[vote.optionIndex].votes.push({
          voter: {
            id: vote.userId._id,
            name: vote.userId.name,
            email: vote.userId.email,
            profilePicture: vote.userId.profilePicture,
            memberSince: vote.userId.createdAt,
            lastLogin: vote.userId.lastLogin
          },
          votedAt: vote.createdAt,
          ipAddress: vote.ipAddress || 'N/A'
        });
        votesByOption[vote.optionIndex].count++;
      }
    });

    // Get unique voters count and demographics
    const uniqueVoters = await Vote.aggregate([
      { $match: { pollId: poll._id } },
      { $group: { _id: '$userId' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { 
        name: '$user.name', 
        email: '$user.email',
        createdAt: '$user.createdAt'
      }}
    ]);

    res.json({
      poll: {
        id: poll._id,
        title: poll.title,
        totalVotes: poll.totalVotes,
        uniqueVoters: poll.uniqueVoters
      },
      voterDetails: {
        byOption: votesByOption,
        uniqueVoters: uniqueVoters,
        totalUniqueVoters: uniqueVoters.length
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalVotes / limit),
        totalVotes,
        hasNext: page * limit < totalVotes,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get poll voters error:', error);
    res.status(500).json({ message: 'Server error fetching poll voters' });
  }
});

// @route   GET /api/admin/polls/:id/analytics
// @desc    Get detailed analytics for a specific poll
// @access  Private (Admin only)
router.get('/polls/:id/analytics', authenticateToken, requireAdmin, validateMongoId('id'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).populate('createdBy', 'name email');
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Get voting timeline
    const votingTimeline = await Vote.aggregate([
      { $match: { pollId: poll._id } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get voter demographics
    const voterDemographics = await Vote.aggregate([
      { $match: { pollId: poll._id } },
      { $group: { _id: '$userId' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $group: {
          _id: {
            month: { $month: '$user.createdAt' },
            year: { $year: '$user.createdAt' }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Calculate engagement metrics
    const engagementMetrics = {
      viewToVoteRatio: poll.metadata.views > 0 ? (poll.totalVotes / poll.metadata.views * 100).toFixed(2) : 0,
      averageTimeToVote: 0, // Could be calculated if we track view timestamps
      completionRate: poll.totalVotes > 0 ? ((poll.uniqueVoters / poll.totalVotes) * 100).toFixed(2) : 0
    };

    res.json({
      poll: {
        id: poll._id,
        title: poll.title,
        description: poll.description,
        createdBy: poll.createdBy,
        createdAt: poll.createdAt,
        status: poll.status,
        category: poll.category
      },
      metrics: {
        totalVotes: poll.totalVotes,
        uniqueVoters: poll.uniqueVoters,
        views: poll.metadata.views,
        engagement: engagementMetrics
      },
      timeline: votingTimeline,
      demographics: voterDemographics,
      results: poll.getResults()
    });
  } catch (error) {
    console.error('Get poll analytics error:', error);
    res.status(500).json({ message: 'Server error fetching poll analytics' });
  }
});

// @route   GET /api/admin/real-time-stats
// @desc    Get real-time dashboard statistics
// @access  Private (Admin only)
router.get('/real-time-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Real-time counters
    const stats = await Promise.all([
      User.countDocuments({ isActive: true }),
      Poll.countDocuments({ status: 'active' }),
      Vote.countDocuments({ createdAt: { $gte: last24Hours } }),
      Poll.countDocuments({ createdAt: { $gte: last24Hours } })
    ]);

    // Recent activity (last 10 actions)
    const recentVotes = await Vote.find()
      .populate('userId', 'name')
      .populate('pollId', 'title')
      .sort({ createdAt: -1 })
      .limit(10);

    const recentPolls = await Poll.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      counters: {
        activeUsers: stats[0],
        activePolls: stats[1],
        votesLast24h: stats[2],
        pollsLast24h: stats[3]
      },
      recentActivity: {
        votes: recentVotes.map(vote => ({
          id: vote._id,
          voter: vote.userId.name,
          poll: vote.pollId.title,
          option: vote.optionText,
          timestamp: vote.createdAt
        })),
        polls: recentPolls.map(poll => ({
          id: poll._id,
          title: poll.title,
          creator: poll.createdBy.name,
          votes: poll.totalVotes,
          timestamp: poll.createdAt
        }))
      },
      timestamp: now
    });
  } catch (error) {
    console.error('Get real-time stats error:', error);
    res.status(500).json({ message: 'Server error fetching real-time stats' });
  }
});

module.exports = router;
