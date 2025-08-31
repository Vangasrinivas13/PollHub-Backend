const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
// const rateLimit = require('express-rate-limit'); // Removed to allow unlimited requests
const http = require('http');
const { initializeWebSocket } = require('./utils/websocket');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const pollRoutes = require('./routes/polls');
const voteRoutes = require('./routes/votes');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'your-frontend-domain.com' : 'http://localhost:3000',
  credentials: true
}));

// Rate limiting removed to allow unlimited requests for development

// Logging - disabled to reduce terminal output
// app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/votes', voteRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'PollHub API is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint with welcome message
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PollHub Backend Server</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                color: white;
            }
            .container {
                text-align: center;
                background: rgba(255, 255, 255, 0.1);
                padding: 3rem;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
                border: 1px solid rgba(255, 255, 255, 0.18);
                max-width: 600px;
            }
            .logo {
                font-size: 3rem;
                margin-bottom: 1rem;
            }
            h1 {
                font-size: 2.5rem;
                margin-bottom: 1rem;
                font-weight: 700;
            }
            .status {
                font-size: 1.2rem;
                margin-bottom: 2rem;
                opacity: 0.9;
            }
            .endpoints {
                background: rgba(255, 255, 255, 0.1);
                padding: 1.5rem;
                border-radius: 10px;
                margin: 2rem 0;
                text-align: left;
            }
            .endpoint {
                margin: 0.5rem 0;
                font-family: 'Courier New', monospace;
                font-size: 0.9rem;
            }
            .btn {
                display: inline-block;
                padding: 12px 24px;
                background: rgba(255, 255, 255, 0.2);
                color: white;
                text-decoration: none;
                border-radius: 8px;
                margin: 0.5rem;
                transition: all 0.3s ease;
                border: 1px solid rgba(255, 255, 255, 0.3);
            }
            .btn:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: translateY(-2px);
            }
            .footer {
                margin-top: 2rem;
                opacity: 0.7;
                font-size: 0.9rem;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">🗳️</div>
            <h1>PollHub Backend</h1>
            <div class="status">
                ✅ Server is running successfully!<br>
            </div>
            
            <div class="footer">
                PollHub Online Voting System<br>
                Backend API Server v1.0.0
            </div>
        </div>
    </body>
    </html>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Initialize WebSocket
const io = initializeWebSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('\n🚀 PollHub Backend Server Started Successfully!');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log('🔄 WebSocket: ✅ Enabled for real-time updates');
});
