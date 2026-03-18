const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Meeting = require('../models/Meeting');
const { protect } = require('../middleware/auth');

// @route   GET /api/notifications
// @desc    Get user's notifications
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .populate('meeting', 'title startTime')
      .sort({ createdAt: -1 })
      .limit(20);

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      read: false
    });

    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// @route   GET /api/notifications/check-reminders
// @desc    Check for meeting reminders (called by frontend)
// @access  Private
router.get('/check-reminders', protect, async (req, res) => {
  try {
    const now = new Date();
    const thirtyMinutesLater = new Date(now.getTime() + 30 * 60000);
    
    // Find meetings starting in the next 30 minutes
    const upcomingMeetings = await Meeting.find({
      $or: [
        { organizer: req.user._id },
        { 'participants.user': req.user._id }
      ],
      startTime: {
        $gte: now,
        $lte: thirtyMinutesLater
      },
      status: 'scheduled'
    }).populate('organizer', 'name');

    const newNotifications = [];

    for (const meeting of upcomingMeetings) {
      // Check if reminder already exists
      const existingReminder = await Notification.findOne({
        user: req.user._id,
        meeting: meeting._id,
        type: 'reminder'
      });

      if (!existingReminder) {
        // Create new reminder notification
        const minutesUntil = Math.round((meeting.startTime - now) / 60000);
        const notification = await Notification.create({
          user: req.user._id,
          meeting: meeting._id,
          message: `Meeting "${meeting.title}" starts in ${minutesUntil} minutes`,
          type: 'reminder'
        });

        await notification.populate('meeting', 'title startTime');
        newNotifications.push(notification);
      }
    }

    res.json({
      success: true,
      notifications: newNotifications
    });
  } catch (error) {
    console.error('Check reminders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check reminders',
      error: error.message
    });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', protect, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.read = true;
    await notification.save();

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
});

module.exports = router;
