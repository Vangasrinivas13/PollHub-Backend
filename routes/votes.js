const express = require('express');
const Vote = require('../models/Vote');
const Poll = require('../models/Poll');
const { authenticateToken, requireVoter } = require('../middleware/auth');
const { validateVote, validatePagination, validateMongoId } = require('../middleware/validation');
const { emitNewVote, emitPollUpdate } = require('../utils/websocket');
const mongoose = require('mongoose');

const router = express.Router();

// @route   POST /api/votes/:pollId
// @desc    Cast a vote for a poll
// @access  Private (Voters and Admins)
router.post('/:pollId', authenticateToken, requireVoter, validateVote, async (req, res) => {
  try {
    const { pollId } = req.params;
    const { optionIndex } = req.body;
    const userId = req.user._id;

    // Find the poll
    const poll = await Poll.findById(pollId);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check if user can vote
    const canVoteResult = poll.canUserVote(userId);
    if (!canVoteResult.canVote) {
      return res.status(400).json({ message: canVoteResult.reason });
    }

    // Validate option index
    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({ message: 'Invalid option selected' });
    }

    // Add vote to poll
    await poll.addVote(userId, optionIndex);

    // Create vote record with enhanced tracking
    const vote = new Vote({
      pollId,
      userId,
      optionIndex,
      optionText: poll.options[optionIndex].text,
      isAnonymous: poll.settings.anonymousVoting,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || '',
      metadata: {
        deviceType: req.get('User-Agent')?.includes('Mobile') ? 'mobile' : 'desktop',
        browser: req.get('User-Agent')?.split(' ')[0] || 'unknown',
        timestamp: new Date()
      }
    });

    await vote.save();

    // Add poll to user's voted polls
    await req.user.addVotedPoll(pollId);

    // Emit real-time vote update
    emitNewVote(pollId, {
      voterName: req.user.name,
      optionText: poll.options[optionIndex].text,
      optionIndex,
      totalVotes: poll.totalVotes + 1,
      isAnonymous: poll.settings.anonymousVoting
    });

    // Emit poll update with new vote counts
    emitPollUpdate(pollId, {
      totalVotes: poll.totalVotes + 1,
      options: poll.options
    });

    res.status(201).json({
      message: 'Vote cast successfully',
      vote: {
        pollId,
        optionIndex,
        optionText: poll.options[optionIndex].text,
        votedAt: vote.createdAt
      }
    });
  } catch (error) {
    console.error('Cast vote error:', error);
    res.status(500).json({ message: error.message || 'Server error casting vote' });
  }
});

// @route   GET /api/votes/user/history
// @desc    Get user's voting history
// @access  Private
router.get('/user/history', authenticateToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const votes = await Vote.getUserVotingHistory(req.user._id, parseInt(limit));
    
    // Skip pagination for now, implement if needed
    const votesWithPollInfo = votes.map(vote => ({
      id: vote._id,
      pollId: vote.pollId._id,
      pollTitle: vote.pollId.title,
      pollDescription: vote.pollId.description,
      pollStatus: vote.pollId.status,
      pollEndDate: vote.pollId.endDate,
      optionIndex: vote.optionIndex,
      optionText: vote.optionText,
      votedAt: vote.createdAt,
      isAnonymous: vote.isAnonymous
    }));

    res.json({
      votes: votesWithPollInfo,
      totalVotes: votesWithPollInfo.length
    });
  } catch (error) {
    console.error('Get voting history error:', error);
    res.status(500).json({ message: 'Server error fetching voting history' });
  }
});

// @route   GET /api/votes/poll/:pollId
// @desc    Get votes for a specific poll (Admin only)
// @access  Private (Admin only)
router.get('/poll/:pollId', authenticateToken, validateMongoId('pollId'), async (req, res) => {
  try {
    // Check if user is admin or poll creator
    const poll = await Poll.findById(req.params.pollId);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    if (req.user.role !== 'admin' && poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const votes = await Vote.find({ pollId: req.params.pollId })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    const voteDetails = votes.map(vote => ({
      id: vote._id,
      voter: vote.isAnonymous ? 'Anonymous' : {
        id: vote.userId._id,
        name: vote.userId.name,
        email: vote.userId.email
      },
      optionIndex: vote.optionIndex,
      optionText: vote.optionText,
      votedAt: vote.createdAt,
      isAnonymous: vote.isAnonymous
    }));

    res.json({
      pollId: req.params.pollId,
      pollTitle: poll.title,
      votes: voteDetails,
      totalVotes: votes.length
    });
  } catch (error) {
    console.error('Get poll votes error:', error);
    res.status(500).json({ message: 'Server error fetching poll votes' });
  }
});

// @route   GET /api/votes/stats/:pollId
// @desc    Get voting statistics for a poll
// @access  Private (Admin or Poll Creator)
router.get('/stats/:pollId', authenticateToken, validateMongoId('pollId'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.pollId);
    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const voteStats = await Vote.getPollVoteStats(req.params.pollId);
    
    // Get hourly voting pattern for the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourlyVotes = await Vote.aggregate([
      {
        $match: {
          pollId: poll._id,
          createdAt: { $gte: oneDayAgo }
        }
      },
      {
        $group: {
          _id: {
            hour: { $hour: '$createdAt' },
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1, '_id.hour': 1 } }
    ]);

    res.json({
      pollId: req.params.pollId,
      pollTitle: poll.title,
      totalVotes: poll.totalVotes,
      uniqueVoters: poll.uniqueVoters,
      optionStats: voteStats,
      hourlyPattern: hourlyVotes,
      pollDuration: poll.durationInDays,
      timeRemaining: poll.timeRemaining
    });
  } catch (error) {
    console.error('Get vote stats error:', error);
    res.status(500).json({ message: 'Server error fetching vote statistics' });
  }
});

// @route   DELETE /api/votes/:voteId
// @desc    Delete a vote (Admin only, for moderation)
// @access  Private (Admin only)
router.delete('/:voteId', authenticateToken, validateMongoId('voteId'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const vote = await Vote.findById(req.params.voteId);
    if (!vote) {
      return res.status(404).json({ message: 'Vote not found' });
    }

    // Find the poll and update vote counts
    const poll = await Poll.findById(vote.pollId);
    if (poll) {
      // Decrease vote count for the option
      if (poll.options[vote.optionIndex]) {
        poll.options[vote.optionIndex].votes = Math.max(0, poll.options[vote.optionIndex].votes - 1);
        
        // Remove voter from option voters list
        poll.options[vote.optionIndex].voters = poll.options[vote.optionIndex].voters.filter(
          voter => voter.userId.toString() !== vote.userId.toString()
        );
      }

      // Decrease total votes
      poll.totalVotes = Math.max(0, poll.totalVotes - 1);

      // Check if user has any other votes for this poll
      const userOtherVotes = await Vote.countDocuments({
        pollId: vote.pollId,
        userId: vote.userId,
        _id: { $ne: vote._id }
      });

      // If no other votes, remove from voted users and decrease unique voters
      if (userOtherVotes === 0) {
        poll.votedUsers = poll.votedUsers.filter(
          userId => userId.toString() !== vote.userId.toString()
        );
        poll.uniqueVoters = Math.max(0, poll.uniqueVoters - 1);
      }

      await poll.save();
    }

    // Remove vote from user's voted polls if no other votes exist
    const userOtherVotes = await Vote.countDocuments({
      pollId: vote.pollId,
      userId: vote.userId,
      _id: { $ne: vote._id }
    });

    if (userOtherVotes === 0) {
      await User.findByIdAndUpdate(vote.userId, {
        $pull: { votedPolls: { pollId: vote.pollId } }
      });
    }

    // Delete the vote
    await Vote.findByIdAndDelete(req.params.voteId);

    res.json({ message: 'Vote deleted successfully' });
  } catch (error) {
    console.error('Delete vote error:', error);
    res.status(500).json({ message: 'Server error deleting vote' });
  }
});

// @route   GET /api/votes/recent
// @desc    Get recent votes (Admin only)
// @access  Private (Admin only)
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { limit = 20 } = req.query;
    const recentVotes = await Vote.getRecentVotes(parseInt(limit));

    const votesWithDetails = recentVotes.map(vote => ({
      id: vote._id,
      voter: {
        id: vote.userId._id,
        name: vote.userId.name,
        email: vote.userId.email
      },
      poll: {
        id: vote.pollId._id,
        title: vote.pollId.title
      },
      optionText: vote.optionText,
      votedAt: vote.createdAt,
      isAnonymous: vote.isAnonymous
    }));

    res.json({
      votes: votesWithDetails,
      totalShown: votesWithDetails.length
    });
  } catch (error) {
    console.error('Get recent votes error:', error);
    res.status(500).json({ message: 'Server error fetching recent votes' });
  }
});

module.exports = router;
