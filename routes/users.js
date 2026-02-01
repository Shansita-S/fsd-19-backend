const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

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

module.exports = router;
