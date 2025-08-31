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
    const existingAdmin = await User.findOne({ email: 'admin@pollhub.com' });
    if (existingAdmin) {
      console.log('Admin user already exists!');
      console.log('Email:', existingAdmin.email);
      console.log('Role:', existingAdmin.role);
      return;
    }

    // Create admin user
    const adminUser = new User({
      name: 'Admin User',
      email: 'admin@pollhub.com',
      password: 'admin123456', // Will be hashed automatically
      role: 'admin',
      isActive: true,
      emailVerified: true
    });

    await adminUser.save();
    
    console.log('\n✅ Admin user created successfully!');
    console.log('📧 Email: admin@pollhub.com');
    console.log('🔑 Password: admin123456');
    console.log('👤 Role: admin');
    console.log('\n🚀 You can now login to the admin dashboard!');
    
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  }
}

createAdmin();
