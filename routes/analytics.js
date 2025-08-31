const express = require('express');
const router = express.Router();
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get comprehensive analytics data
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [
      totalPolls,
      totalVotes,
      totalUsers,
      activePolls,
      recentPolls,
      topPolls,
      votesByDay,
      pollsByCategory,
      userEngagement,
      votingPatterns
    ] = await Promise.all([
      // Basic counts
      Poll.countDocuments(),
      Vote.countDocuments(),
      User.countDocuments(),
      Poll.countDocuments({ endDate: { $gt: new Date() } }),
      
      // Recent polls with vote counts
      Poll.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $addFields: { 
          voteCount: '$totalVotes',
          status: {
            $cond: {
              if: { $gt: ['$endDate', new Date()] },
              then: 'Active',
              else: 'Completed'
            }
          }
        }},
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
        { $project: {
          title: 1,
          description: 1,
          voteCount: 1,
          status: 1,
          createdAt: 1,
          endDate: 1,
          category: 1,
          options: { $size: '$options' }
        }}
      ]),
      
      // Top polls by vote count
      Poll.aggregate([
        { $addFields: { voteCount: '$totalVotes' } },
        { $match: { voteCount: { $gt: 0 } } },
        { $sort: { voteCount: -1 } },
        { $limit: 10 },
        { $project: {
          title: 1,
          description: 1,
          voteCount: 1,
          createdAt: 1,
          endDate: 1,
          category: 1,
          options: { $size: '$options' }
        }}
      ]),
      
      // Votes by day (last 30 days)
      Vote.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Polls by category/type
      Poll.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$category", "general"] },
            count: { $sum: 1 },
            totalVotes: { $sum: '$totalVotes' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // User engagement metrics
      User.aggregate([
        {
          $lookup: {
            from: 'votes',
            localField: '_id',
            foreignField: 'userId',
            as: 'votes'
          }
        },
        {
          $addFields: {
            voteCount: { $size: '$votes' },
            engagementLevel: {
              $switch: {
                branches: [
                  { case: { $gte: [{ $size: '$votes' }, 10] }, then: 'High' },
                  { case: { $gte: [{ $size: '$votes' }, 5] }, then: 'Medium' },
                  { case: { $gt: [{ $size: '$votes' }, 0] }, then: 'Low' }
                ],
                default: 'None'
              }
            }
          }
        },
        {
          $group: {
            _id: '$engagementLevel',
            count: { $sum: 1 },
            avgVotes: { $avg: '$voteCount' }
          }
        }
      ]),
      
      // Voting patterns by hour
      Vote.aggregate([
        {
          $group: {
            _id: { $hour: '$createdAt' },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    res.json({
      overview: {
        totalPolls,
        totalVotes,
        totalUsers,
        activePolls,
        completionRate: totalPolls > 0 ? ((totalPolls - activePolls) / totalPolls * 100).toFixed(1) : 0
      },
      recentPolls,
      topPolls,
      votesByDay,
      pollsByCategory,
      userEngagement,
      votingPatterns
    });
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch analytics data' });
  }
});

// Get poll performance metrics
router.get('/poll-performance', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pollPerformance = await Poll.aggregate([
      {
        $addFields: {
          voteCount: '$totalVotes',
          participationRate: {
            $multiply: [
              { $divide: ['$totalVotes', { $ifNull: ['$uniqueVoters', { $max: ['$totalVotes', 1] }] }] },
              100
            ]
          },
          daysActive: {
            $divide: [
              { $subtract: [{ $min: ['$endDate', new Date()] }, '$createdAt'] },
              86400000
            ]
          }
        }
      },
      {
        $project: {
          title: 1,
          voteCount: 1,
          participationRate: { $round: ['$participationRate', 1] },
          daysActive: { $round: ['$daysActive', 1] },
          status: {
            $cond: {
              if: { $gt: ['$endDate', new Date()] },
              then: 'Active',
              else: 'Completed'
            }
          },
          votesPerDay: {
            $round: [
              { $divide: ['$voteCount', { $max: ['$daysActive', 1] }] },
              2
            ]
          }
        }
      },
      { $sort: { voteCount: -1 } }
    ]);

    res.json(pollPerformance);
  } catch (error) {
    console.error('Poll performance error:', error);
    res.status(500).json({ message: 'Failed to fetch poll performance data' });
  }
});

// Get voting trends over time
router.get('/voting-trends', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const votingTrends = await Vote.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            hour: { $hour: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: "$_id.date",
          hourlyData: {
            $push: {
              hour: "$_id.hour",
              count: "$count"
            }
          },
          dailyTotal: { $sum: "$count" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(votingTrends);
  } catch (error) {
    console.error('Voting trends error:', error);
    res.status(500).json({ message: 'Failed to fetch voting trends' });
  }
});

// Get user demographics and engagement
router.get('/user-analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [
      usersByRole,
      usersByRegistrationDate,
      engagementMetrics,
      topVoters
    ] = await Promise.all([
      // Users by role
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // User registrations over time
      User.aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Engagement metrics
      User.aggregate([
        {
          $lookup: {
            from: 'votes',
            localField: '_id',
            foreignField: 'userId',
            as: 'votes'
          }
        },
        {
          $addFields: {
            voteCount: { $size: '$votes' },
            lastVoteDate: { $max: '$votes.createdAt' }
          }
        },
        {
          $group: {
            _id: null,
            avgVotesPerUser: { $avg: '$voteCount' },
            activeUsers: {
              $sum: {
                $cond: [
                  { $gte: ['$lastVoteDate', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                  1,
                  0
                ]
              }
            },
            totalUsers: { $sum: 1 }
          }
        }
      ]),
      
      // Top voters
      User.aggregate([
        {
          $lookup: {
            from: 'votes',
            localField: '_id',
            foreignField: 'userId',
            as: 'votes'
          }
        },
        {
          $addFields: {
            voteCount: { $size: '$votes' }
          }
        },
        { $match: { voteCount: { $gt: 0 } } },
        { $sort: { voteCount: -1 } },
        { $limit: 10 },
        {
          $project: {
            username: 1,
            email: 1,
            voteCount: 1,
            createdAt: 1
          }
        }
      ])
    ]);

    res.json({
      usersByRole,
      usersByRegistrationDate,
      engagementMetrics: engagementMetrics[0] || { avgVotesPerUser: 0, activeUsers: 0, totalUsers: 0 },
      topVoters
    });
  } catch (error) {
    console.error('User analytics error:', error);
    res.status(500).json({ message: 'Failed to fetch user analytics' });
  }
});

// Get poll option performance
router.get('/option-performance/:pollId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { pollId } = req.params;
    
    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Get option performance from poll's options array
    const totalVotes = poll.totalVotes || 0;
    const optionPerformance = poll.options.map((option, index) => ({
      option: option.text,
      voteCount: option.votes || 0,
      percentage: totalVotes > 0 ? ((option.votes || 0) / totalVotes * 100).toFixed(2) : 0,
      voters: option.voters?.map(voter => ({
        userId: voter.userId,
        votedAt: voter.votedAt
      })) || []
    })).sort((a, b) => b.voteCount - a.voteCount);

    res.json({
      poll: {
        title: poll.title,
        description: poll.description,
        options: poll.options
      },
      optionPerformance
    });
  } catch (error) {
    console.error('Option performance error:', error);
    res.status(500).json({ message: 'Failed to fetch option performance data' });
  }
});

module.exports = router;
