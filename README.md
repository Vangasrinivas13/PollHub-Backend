# PollHub Backend

A robust Node.js backend for the PollHub online voting system with comprehensive analytics, real-time features, and secure authentication.

## 🚀 Features

- **User Authentication & Authorization**
  - JWT-based authentication
  - Role-based access control (Admin/User)
  - Password encryption with bcrypt

- **Poll Management**
  - Create, update, delete polls
  - Multiple poll types (single choice, multiple choice)
  - Poll scheduling with start/end dates
  - Real-time vote counting
  - Anonymous voting support

- **Analytics Dashboard**
  - Comprehensive voting statistics
  - User engagement metrics
  - Poll performance analytics
  - Real-time data visualization
  - Export capabilities

- **Real-time Features**
  - Live vote updates via Socket.IO
  - Real-time poll results
  - Live user activity tracking

- **Security & Performance**
  - Rate limiting
  - Input validation
  - CORS protection
  - Helmet security headers
  - Request logging with Morgan

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT
- **Real-time**: Socket.IO
- **Security**: Helmet, bcryptjs, express-rate-limit
- **Validation**: express-validator

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn package manager

## ⚙️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd online-voting/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the backend root directory:
   ```env
   # Database
   MONGODB_URI=mongodb://localhost:27017/pollhub
   
   # JWT Secret
   JWT_SECRET=your_super_secure_jwt_secret_key_here
   JWT_EXPIRES_IN=7d
   
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   
   # CORS Origins
   FRONTEND_URL=http://localhost:3000
   ```

4. **Start MongoDB**
   ```bash
   # Using MongoDB service
   sudo systemctl start mongod
   
   # Or using MongoDB directly
   mongod --dbpath /path/to/your/db
   ```

5. **Run the application**
   ```bash
   # Development mode with auto-restart
   npm run dev
   
   # Production mode
   npm start
   ```

## 📁 Project Structure

```
backend/
├── config/
│   └── database.js          # MongoDB connection configuration
├── middleware/
│   ├── auth.js             # Authentication middleware
│   └── validation.js       # Input validation middleware
├── models/
│   ├── User.js             # User model schema
│   ├── Poll.js             # Poll model schema
│   └── Vote.js             # Vote model schema
├── routes/
│   ├── auth.js             # Authentication routes
│   ├── polls.js            # Poll management routes
│   ├── votes.js            # Voting routes
│   ├── users.js            # User management routes
│   ├── admin.js            # Admin-only routes
│   └── analytics.js        # Analytics & statistics routes
├── .env.example            # Environment variables template
├── .gitignore             # Git ignore rules
├── package.json           # Dependencies and scripts
├── server.js              # Main server file
└── README.md              # This file
```

## 🔗 API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /register` - User registration
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /profile` - Get user profile
- `PUT /profile` - Update user profile
- `GET /google` - Google OAuth login
- `GET /google/callback` - Google OAuth callback

### Poll Routes (`/api/polls`)
- `GET /` - Get all polls (with pagination)
- `GET /:id` - Get specific poll
- `POST /` - Create new poll (Auth required)
- `PUT /:id` - Update poll (Auth required)
- `DELETE /:id` - Delete poll (Auth required)
- `GET /:id/results` - Get poll results
- `POST /:id/vote` - Vote on poll (Auth required)

### Vote Routes (`/api/votes`)
- `GET /user/:userId` - Get user's voting history
- `GET /poll/:pollId` - Get votes for specific poll
- `DELETE /:id` - Delete vote (Auth required)

### User Routes (`/api/users`)
- `GET /` - Get all users (Admin only)
- `GET /:id` - Get specific user
- `PUT /:id` - Update user (Auth required)
- `DELETE /:id` - Delete user (Admin only)

### Admin Routes (`/api/admin`)
- `GET /dashboard` - Admin dashboard data
- `GET /users` - User management
- `PUT /users/:id/role` - Update user role
- `DELETE /polls/:id` - Force delete poll
- `GET /system-stats` - System statistics

### Analytics Routes (`/api/analytics`)
- `GET /dashboard` - Overview analytics
- `GET /poll-performance` - Poll performance metrics
- `GET /user-analytics` - User engagement data
- `GET /voting-trends` - Voting pattern analysis
- `GET /option-performance/:pollId` - Option-level analytics

## 🔒 Authentication & Authorization

### JWT Token Structure
```javascript
{
  "userId": "user_object_id",
  "email": "user@example.com",
  "role": "user|admin",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Protected Routes
- **User Authentication Required**: Most POST/PUT/DELETE operations
- **Admin Only**: User management, system analytics, force delete operations
- **Rate Limiting**: Applied to authentication and voting endpoints

## 📊 Database Models

### User Model
```javascript
{
  name: String,
  email: String (unique),
  password: String (hashed),
  role: String (enum: ['user', 'admin']),
  isActive: Boolean,
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Poll Model
```javascript
{
  title: String,
  description: String,
  options: [{ text: String, votes: Number }],
  createdBy: ObjectId (User),
  category: String,
  isActive: Boolean,
  allowMultipleVotes: Boolean,
  isAnonymous: Boolean,
  startDate: Date,
  endDate: Date,
  totalVotes: Number,
  uniqueVoters: Number,
  createdAt: Date,
  updatedAt: Date
}
```

### Vote Model
```javascript
{
  pollId: ObjectId (Poll),
  userId: ObjectId (User),
  optionIndex: Number,
  optionText: String,
  isAnonymous: Boolean,
  ipAddress: String,
  userAgent: String,
  metadata: {
    deviceType: String,
    browser: String,
    os: String,
    location: Object
  },
  createdAt: Date,
  updatedAt: Date
}
```

## 🔧 Configuration Options

### Environment Variables
| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/pollhub` | Yes |
| `JWT_SECRET` | JWT signing secret | - | Yes |
| `JWT_EXPIRES_IN` | JWT expiration time | `7d` | No |
| `PORT` | Server port | `5000` | No |
| `NODE_ENV` | Environment mode | `development` | No |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` | No |

## 🚀 Deployment

### Production Setup
1. **Environment Configuration**
   ```bash
   NODE_ENV=production
   MONGODB_URI=mongodb://your-production-db
   JWT_SECRET=your-production-jwt-secret
   ```

2. **Process Management**
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start server.js --name "pollhub-backend"
   
   # Using Docker
   docker build -t pollhub-backend .
   docker run -p 5000:5000 pollhub-backend
   ```

3. **Database Setup**
   - Ensure MongoDB is properly configured
   - Set up database indexes for performance
   - Configure backup strategies

### Performance Optimization
- Enable MongoDB indexing on frequently queried fields
- Implement Redis caching for analytics data
- Use compression middleware for API responses
- Set up CDN for static assets

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "auth"
```

## 📝 API Response Format

### Success Response
```javascript
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful"
}
```

### Error Response
```javascript
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

## 🔍 Monitoring & Logging

- **Request Logging**: Morgan middleware for HTTP request logging
- **Error Handling**: Centralized error handling with detailed logging
- **Performance Monitoring**: Built-in analytics for API performance
- **Health Checks**: `/health` endpoint for service monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the API endpoints above

## 🔄 Changelog

### v1.0.0
- Initial release with core voting functionality
- JWT authentication system
- Real-time voting with Socket.IO
- Comprehensive analytics dashboard
- Admin panel with user management
- Google OAuth integration
