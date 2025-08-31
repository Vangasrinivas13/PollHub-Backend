const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initializeWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"]
    }
  });

  // Authentication middleware for WebSocket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user._id.toString();
      socket.userRole = user.role;
      socket.userName = user.name;
      
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.userName} (${socket.userRole}) connected: ${socket.id}`);

    // Join role-based rooms
    socket.join(socket.userRole);
    socket.join(`user_${socket.userId}`);

    // Join admin-specific rooms if admin
    if (socket.userRole === 'admin') {
      socket.join('admin_dashboard');
      socket.join('admin_notifications');
    } else {
      socket.join('voter_dashboard');
    }

    // Handle poll subscription
    socket.on('subscribe_poll', (pollId) => {
      socket.join(`poll_${pollId}`);
      console.log(`User ${socket.userName} subscribed to poll ${pollId}`);
    });

    // Handle poll unsubscription
    socket.on('unsubscribe_poll', (pollId) => {
      socket.leave(`poll_${pollId}`);
      console.log(`User ${socket.userName} unsubscribed from poll ${pollId}`);
    });

    // Handle dashboard subscription
    socket.on('subscribe_dashboard', () => {
      if (socket.userRole === 'admin') {
        socket.join('admin_realtime');
      } else {
        socket.join('voter_realtime');
      }
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.userName} disconnected: ${socket.id}`);
    });
  });

  return io;
};

// Emit functions for real-time updates
const emitPollUpdate = (pollId, updateData) => {
  if (io) {
    io.to(`poll_${pollId}`).emit('poll_updated', {
      pollId,
      ...updateData,
      timestamp: new Date()
    });
  }
};

const emitNewVote = (pollId, voteData) => {
  if (io) {
    // Emit to poll subscribers
    io.to(`poll_${pollId}`).emit('new_vote', {
      pollId,
      ...voteData,
      timestamp: new Date()
    });

    // Emit to admin dashboard
    io.to('admin_realtime').emit('vote_activity', {
      pollId,
      ...voteData,
      timestamp: new Date()
    });
  }
};

const emitPollCreated = (pollData) => {
  if (io) {
    // Notify all voters about new poll
    io.to('voter').emit('new_poll', {
      ...pollData,
      timestamp: new Date()
    });

    // Update admin dashboard
    io.to('admin_realtime').emit('poll_created', {
      ...pollData,
      timestamp: new Date()
    });
  }
};

const emitPollStatusChange = (pollId, status, pollData) => {
  if (io) {
    // Notify poll subscribers
    io.to(`poll_${pollId}`).emit('poll_status_changed', {
      pollId,
      status,
      ...pollData,
      timestamp: new Date()
    });

    // Notify all users if poll becomes active
    if (status === 'active') {
      io.to('voter').emit('poll_activated', {
        pollId,
        ...pollData,
        timestamp: new Date()
      });
    }

    // Update admin dashboard
    io.to('admin_realtime').emit('poll_status_updated', {
      pollId,
      status,
      timestamp: new Date()
    });
  }
};

const emitDashboardStats = (stats) => {
  if (io) {
    io.to('admin_realtime').emit('dashboard_stats_updated', {
      ...stats,
      timestamp: new Date()
    });
  }
};

const emitUserActivity = (activityData) => {
  if (io) {
    io.to('admin_realtime').emit('user_activity', {
      ...activityData,
      timestamp: new Date()
    });
  }
};

const emitPollDeleted = (pollId, pollData) => {
  if (io) {
    // Notify all users about poll deletion
    io.to('voter').emit('poll_deleted', {
      pollId,
      ...pollData,
      timestamp: new Date()
    });

    // Notify poll subscribers
    io.to(`poll_${pollId}`).emit('poll_deleted', {
      pollId,
      ...pollData,
      timestamp: new Date()
    });

    // Update admin dashboard
    io.to('admin_realtime').emit('poll_deleted', {
      pollId,
      ...pollData,
      timestamp: new Date()
    });

    // Update voter dashboard
    io.to('voter_realtime').emit('poll_deleted', {
      pollId,
      timestamp: new Date()
    });
  }
};

module.exports = {
  initializeWebSocket,
  emitPollUpdate,
  emitNewVote,
  emitPollCreated,
  emitPollStatusChange,
  emitDashboardStats,
  emitUserActivity,
  emitPollDeleted,
  getIO: () => io
};
