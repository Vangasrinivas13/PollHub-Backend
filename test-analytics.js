const mongoose = require('mongoose');
const User = require('./models/User');
const Poll = require('./models/Poll');
const Vote = require('./models/Vote');
require('dotenv').config();

async function testAnalyticsData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Test basic counts
    const totalPolls = await Poll.countDocuments();
    const totalVotes = await Vote.countDocuments();
    const totalUsers = await User.countDocuments();
    const activePolls = await Poll.countDocuments({ endDate: { $gt: new Date() } });

    console.log('\n📊 Database Statistics:');
    console.log(`   👥 Total Users: ${totalUsers}`);
    console.log(`   📊 Total Polls: ${totalPolls}`);
    console.log(`   🗳️  Total Votes: ${totalVotes}`);
    console.log(`   ✅ Active Polls: ${activePolls}`);

    // Check if admin user exists
    const adminUser = await User.findOne({ role: 'admin' });
    console.log(`\n🔐 Admin User: ${adminUser ? `${adminUser.username} (${adminUser.email})` : 'Not found'}`);

    // Test votes by day aggregation
    const votesByDay = await Vote.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    console.log(`\n📈 Votes by Day (last 30 days): ${votesByDay.length} days with votes`);

    // Test polls by category
    const pollsByCategory = await Poll.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$category", "general"] },
          count: { $sum: 1 },
          totalVotes: { $sum: '$totalVotes' }
        }
      },
      { $sort: { count: -1 } }
    ]);
    console.log(`\n🏷️  Poll Categories: ${pollsByCategory.length} categories found`);
    pollsByCategory.forEach(cat => {
      console.log(`   - ${cat._id}: ${cat.count} polls, ${cat.totalVotes} votes`);
    });

    // Test user engagement
    const userEngagement = await User.aggregate([
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
    ]);
    console.log(`\n👥 User Engagement Levels:`);
    userEngagement.forEach(level => {
      console.log(`   - ${level._id}: ${level.count} users (avg: ${level.avgVotes.toFixed(1)} votes)`);
    });

  } catch (error) {
    console.error('❌ Error testing analytics data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

testAnalyticsData();
