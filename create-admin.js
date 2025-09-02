const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'MENTION_YOUR_ADMIN_MAIL_HERE' });
    if (existingAdmin) {
      console.log('Admin user already exists!');
      console.log('Email:', existingAdmin.email);
      console.log('Role:', existingAdmin.role);
      return;
    }

    // Create admin user
    const adminUser = new User({
      name: 'Admin User',
      email: 'MENTION_YOUR_ADMIN_MAIL_HERE',
      password: 'MENTION_YOUR_ADMIN_PASSWORD_HERE', // Will be hashed automatically
      role: 'admin',
      isActive: true,
      emailVerified: true
    });

    await adminUser.save();
    
    console.log('\n✅ Admin user created successfully!');
    console.log('\n🚀 You can now login to the admin dashboard!');
    
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  }
}

createAdmin();
