const express = require('express');
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');
const { validatePoll, validatePollCreation, validatePollUpdate } = require('../middleware/validation');
const { emitPollCreated, emitPollStatusChange, emitPollUpdate, emitDashboardStats } = require('../utils/websocket');
const mongoose = require('mongoose');
const { validateMongoId, validatePagination, validatePollFilters } = require('../middleware/validation');

const router = express.Router();

// Test route to check polls in database
router.get('/test-db', async (req, res) => {
  try {
    const pollCount = await Poll.countDocuments({});
    const polls = await Poll.find({}).select('title status isPublic createdAt createdBy').populate('createdBy', 'name');
    
    res.json({
      totalPolls: pollCount,
      polls: polls,
      message: pollCount === 0 ? 'No polls found in database' : `Found ${pollCount} polls`
    });
  } catch (error) {
    console.error('Test DB error:', error);
    res.status(500).json({ error: error.message });
  }
});

// @route   GET /api/polls
// @desc    Get all polls with filters and pagination
// @access  Public/Private (optional auth)
router.get('/', optionalAuth, validatePagination, validatePollFilters, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      category,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      featured
    } = req.query;

    // Debug logging removed for cleaner terminal output
    
    // First, let's see all polls in database
    const allPolls = await Poll.find({}).select('title status isPublic createdAt');

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (featured !== undefined) filter['metadata.featured'] = featured === 'true';
    
    // Add search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // If not admin, only show public polls
    if (!req.user || req.user.role !== 'admin') {
      filter.isPublic = true;
    }

    // Filter logging removed

    // Build sort object
    const sort = {};
    if (sortBy && sortOrder) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    const polls = await Poll.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email');

    const total = await Poll.countDocuments(filter);

    // Debug output removed for cleaner terminal

    // Add user voting status if authenticated
    const pollsWithVoteStatus = polls.map(poll => {
      const pollObj = poll.toObject();
      if (req.user) {
        pollObj.hasUserVoted = poll.votedUsers.includes(req.user._id);
        pollObj.canUserVote = poll.canUserVote(req.user._id);
      }
      return pollObj;
    });

    res.json({
      polls: pollsWithVoteStatus,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalPolls: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get polls error:', error);
    res.status(500).json({ message: 'Server error fetching polls' });
  }
});

// @route   GET /api/polls/active
// @desc    Get active polls
// @access  Public
router.get('/active', optionalAuth, async (req, res) => {
  try {
    // Build filter for active polls
    const filter = {
      status: 'active'
    };
    
    // If not admin, only show public polls
    if (!req.user || req.user.role !== 'admin') {
      filter.isPublic = true;
    }
    
    const activePolls = await Poll.find(filter).populate('createdBy', 'name email');
    
    const pollsWithVoteStatus = activePolls.map(poll => {
      const pollObj = poll.toObject();
      if (req.user) {
        pollObj.hasUserVoted = poll.votedUsers.includes(req.user._id);
        pollObj.canUserVote = poll.canUserVote(req.user._id);
      }
      return pollObj;
    });

    res.json({ polls: pollsWithVoteStatus });
  } catch (error) {
    console.error('Get active polls error:', error);
    res.status(500).json({ message: 'Server error fetching active polls' });
  }
});

// @route   GET /api/polls/trending
// @desc    Get trending polls
// @access  Public
router.get('/trending', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const trendingPolls = await Poll.getTrendingPolls(parseInt(limit));
    res.json({ polls: trendingPolls });
  } catch (error) {
    console.error('Get trending polls error:', error);
    res.status(500).json({ message: 'Server error fetching trending polls' });
  }
});

// @route   GET /api/polls/:id
// @desc    Get single poll by ID
// @access  Public/Private (optional auth)
router.get('/:id', validateMongoId('id'), optionalAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check if user can view this poll
    if (!poll.isPublic && (!req.user || req.user.role !== 'admin')) {
      return res.status(403).json({ message: 'Access denied to private poll' });
    }

    // Increment view count
    poll.metadata.views += 1;
    await poll.save();

    const pollObj = poll.toObject();
    
    // Add user-specific data if authenticated
    if (req.user) {
      pollObj.hasUserVoted = poll.votedUsers.includes(req.user._id);
      pollObj.canUserVote = poll.canUserVote(req.user._id);
    }

    res.json({ poll: pollObj });
  } catch (error) {
    console.error('Get poll error:', error);
    res.status(500).json({ message: 'Server error fetching poll' });
  }
});

// @route   POST /api/polls
// @desc    Create a new poll
// @access  Private (Admin only)
router.post('/', authenticateToken, requireAdmin, validatePollCreation, async (req, res) => {
  try {
    const pollData = {
      ...req.body,
      createdBy: req.user._id
    };

    const poll = new Poll(pollData);
    await poll.save();

    const populatedPoll = await poll.populate('createdBy', 'name email');

    // Poll creation logging removed

    // Emit real-time poll creation notification
    emitPollCreated({
      id: poll._id,
      title: poll.title,
      description: poll.description,
      createdBy: req.user.name,
      status: poll.status,
      totalOptions: poll.options.length
    });

    res.status(201).json({
      message: 'Poll created successfully',
      poll: populatedPoll
    });
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ message: 'Server error creating poll' });
  }
});

// @route   PUT /api/polls/:id
// @desc    Update poll
// @access  Private (Admin or Poll Creator)
router.put('/:id', authenticateToken, validateMongoId('id'), validatePollUpdate, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Prevent updating certain fields if poll has votes
    if (poll.totalVotes > 0) {
      const restrictedFields = ['options'];
      const hasRestrictedUpdates = restrictedFields.some(field => req.body[field]);
      
      if (hasRestrictedUpdates) {
        return res.status(400).json({ 
          message: 'Cannot modify poll options after voting has started' 
        });
      }
    }

    const updatedPoll = await Poll.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    // Emit real-time poll update
    emitPollUpdate(updatedPoll._id.toString(), {
      title: updatedPoll.title,
      status: updatedPoll.status,
      updatedBy: req.user.name
    });

    // Update dashboard statistics if status changed
    if (req.body.status) {
      const updatedStats = await Poll.getStatistics();
      emitDashboardStats(updatedStats);
    }

    res.json({
      message: 'Poll updated successfully',
      poll: updatedPoll
    });
  } catch (error) {
    console.error('Update poll error:', error);
    res.status(500).json({ message: 'Server error updating poll' });
  }
});

// @route   DELETE /api/polls/:id
// @desc    Delete poll
// @access  Private (Admin or Poll Creator)
router.delete('/:id', authenticateToken, validateMongoId('id'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Prevent deletion if poll has votes (unless admin)
    if (poll.totalVotes > 0 && req.user.role !== 'admin') {
      return res.status(400).json({ 
        message: 'Cannot delete poll with existing votes' 
      });
    }

    // Store poll data for WebSocket notification before deletion
    const pollData = {
      id: poll._id,
      title: poll.title,
      totalVotes: poll.totalVotes
    };

    await Poll.findByIdAndDelete(req.params.id);
    
    // Also delete associated votes
    await Vote.deleteMany({ pollId: req.params.id });

    // Emit real-time notification about poll deletion
    const { emitPollDeleted } = require('../utils/websocket');
    emitPollDeleted(poll._id.toString(), pollData);

    // Update dashboard statistics
    const updatedStats = await Poll.getStatistics();
    emitDashboardStats(updatedStats);

    res.json({ message: 'Poll deleted successfully' });
  } catch (error) {
    console.error('Delete poll error:', error);
    res.status(500).json({ message: 'Server error deleting poll' });
  }
});

// @route   GET /api/polls/:id/results
// @desc    Get poll results
// @access  Public/Private (depends on poll settings)
router.get('/:id/results', validateMongoId('id'), optionalAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check if user can view results
    const canViewResults = 
      poll.hasEnded || 
      poll.showResultsBeforeEnd ||
      (req.user && poll.votedUsers.includes(req.user._id) && poll.showResultsAfterVoting) ||
      (req.user && req.user.role === 'admin');

    if (!canViewResults) {
      return res.status(403).json({ 
        message: 'Results not available yet' 
      });
    }

    const results = poll.getResults();
    res.json({ results });
  } catch (error) {
    console.error('Get poll results error:', error);
    res.status(500).json({ message: 'Server error fetching results' });
  }
});

// @route   POST /api/polls/:id/toggle-status
// @desc    Toggle poll status (activate/deactivate)
// @access  Private (Admin or Poll Creator)
router.post('/:id/toggle-status', authenticateToken, validateMongoId('id'), async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) {
      return res.status(404).json({ message: 'Poll not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && poll.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Toggle between active and inactive
    poll.status = poll.status === 'active' ? 'inactive' : 'active';
    await poll.save();

    // Emit real-time poll status change notification
    emitPollStatusChange(poll._id, poll.status, {
      title: poll.title,
      totalVotes: poll.totalVotes
    });

    res.json({
      message: 'Poll status updated successfully',
      poll: {
        id: poll._id,
        status: poll.status,
        title: poll.title
      }
    });
  } catch (error) {
    console.error('Toggle poll status error:', error);
    res.status(500).json({ message: 'Server error toggling poll status' });
  }
});

// @route   GET /api/polls/user/created
// @desc    Get polls created by current user
// @access  Private
router.get('/user/created', authenticateToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const polls = await Poll.find({ createdBy: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email');

    const total = await Poll.countDocuments({ createdBy: req.user._id });

    res.json({
      polls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalPolls: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get user polls error:', error);
    res.status(500).json({ message: 'Server error fetching user polls' });
  }
});

module.exports = router;
