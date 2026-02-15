const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// @route   GET /api/users
// @desc    Get all users
// @access  Private (ORGANIZER only)
router.get('/', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const users = await User.find()
      .select('name email role department avatar')
      .sort('name');

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/users/participants
// @desc    Get all participants (for organizer to add to meetings)
// @access  Private (ORGANIZER only)
router.get('/participants', protect, authorize('ORGANIZER'), async (req, res) => {
  try {
    const participants = await User.find({ role: 'PARTICIPANT' })
      .select('name email')
      .sort('name');

    res.status(200).json({
      success: true,
      count: participants.length,
      participants
    });
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const allowedFields = ['name', 'email', 'department', 'avatar'];
    const updates = {};
    
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/users/preferences
// @desc    Update user preferences
// @access  Private
router.put('/preferences', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update preferences
    if (req.body.focusTimeBlocks) {
      user.preferences.focusTimeBlocks = req.body.focusTimeBlocks;
    }
    
    if (req.body.workingHours) {
      user.preferences.workingHours = req.body.workingHours;
    }
    
    if (req.body.maxMeetingsPerDay !== undefined) {
      user.preferences.maxMeetingsPerDay = req.body.maxMeetingsPerDay;
    }

    await user.save();

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;

