const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ActionItem = require('../models/ActionItem');
const Meeting = require('../models/Meeting');
const Notification = require('../models/Notification');

// @route   GET /api/action-items
// @desc    Get all action items for the logged-in user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { status, priority, sortBy = 'dueDate', order = 'asc' } = req.query;
    
    const query = { assignedTo: req.user._id };
    
    if (status) {
      query.status = status;
    }
    
    if (priority) {
      query.priority = priority;
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = order === 'desc' ? -1 : 1;
    
    const actionItems = await ActionItem.find(query)
      .populate('meeting', 'title startTime')
      .populate('assignedBy', 'name email')
      .sort(sortOptions);
    
    res.json({
      success: true,
      count: actionItems.length,
      data: actionItems
    });
  } catch (error) {
    console.error('Get action items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch action items',
      error: error.message
    });
  }
});

// @route   GET /api/action-items/overdue
// @desc    Get overdue action items
// @access  Private
router.get('/overdue', protect, async (req, res) => {
  try {
    const actionItems = await ActionItem.find({
      assignedTo: req.user._id,
      status: { $nin: ['completed', 'cancelled'] },
      dueDate: { $lt: new Date() }
    })
      .populate('meeting', 'title startTime')
      .populate('assignedBy', 'name email')
      .sort({ dueDate: 1 });
    
    res.json({
      success: true,
      count: actionItems.length,
      data: actionItems
    });
  } catch (error) {
    console.error('Get overdue action items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue action items',
      error: error.message
    });
  }
});

// @route   POST /api/action-items
// @desc    Create a new action item
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const actionItem = await ActionItem.create({
      ...req.body,
      assignedBy: req.user._id
    });
    
    // Add action item to meeting
    if (req.body.meeting) {
      await Meeting.findByIdAndUpdate(
        req.body.meeting,
        { $push: { actionItems: actionItem._id } }
      );
    }
    
    // Create notification for assignee
    if (req.body.assignedTo && req.body.assignedTo.toString() !== req.user._id.toString()) {
      await Notification.create({
        recipient: req.body.assignedTo,
        type: 'action-item-assigned',
        title: 'New Action Item Assigned',
        message: `You have been assigned: "${actionItem.title}"`,
        priority: actionItem.priority === 'urgent' ? 'urgent' : 'medium',
        actionItem: actionItem._id
      });
    }
    
    const populatedItem = await ActionItem.findById(actionItem._id)
      .populate('meeting', 'title startTime')
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name email');
    
    res.status(201).json({
      success: true,
      message: 'Action item created successfully',
      data: populatedItem
    });
  } catch (error) {
    console.error('Create action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create action item',
      error: error.message
    });
  }
});

// @route   PUT /api/action-items/:id
// @desc    Update an action item
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    let actionItem = await ActionItem.findById(req.params.id);
    
    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }
    
    // Check if user is assigned to this action item or is the assigner
    if (
      actionItem.assignedTo.toString() !== req.user._id.toString() &&
      actionItem.assignedBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this action item'
      });
    }
    
    actionItem = await ActionItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('meeting', 'title startTime')
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name email');
    
    res.json({
      success: true,
      message: 'Action item updated successfully',
      data: actionItem
    });
  } catch (error) {
    console.error('Update action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update action item',
      error: error.message
    });
  }
});

// @route   PUT /api/action-items/:id/progress
// @desc    Update action item progress
// @access  Private
router.put('/:id/progress', protect, async (req, res) => {
  try {
    const { percentage, note } = req.body;
    
    const actionItem = await ActionItem.findById(req.params.id);
    
    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }
    
    actionItem.progress.percentage = percentage;
    actionItem.progress.updates.push({
      note,
      updatedBy: req.user._id,
      timestamp: new Date()
    });
    
    // Auto-complete if 100%
    if (percentage === 100 && actionItem.status !== 'completed') {
      actionItem.status = 'completed';
      actionItem.completedAt = new Date();
      
      // Notify assigner
      await Notification.create({
        recipient: actionItem.assignedBy,
        type: 'action-item-completed',
        title: 'Action Item Completed',
        message: `"${actionItem.title}" has been completed`,
        priority: 'low',
        actionItem: actionItem._id
      });
    }
    
    await actionItem.save();
    
    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: actionItem
    });
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update progress',
      error: error.message
    });
  }
});

// @route   DELETE /api/action-items/:id
// @desc    Delete an action item
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const actionItem = await ActionItem.findById(req.params.id);
    
    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }
    
    // Only assigner can delete
    if (actionItem.assignedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this action item'
      });
    }
    
    await actionItem.deleteOne();
    
    res.json({
      success: true,
      message: 'Action item deleted successfully'
    });
  } catch (error) {
    console.error('Delete action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete action item',
      error: error.message
    });
  }
});

// @route   GET /api/action-items/stats
// @desc    Get action items statistics
// @access  Private
router.get('/stats/summary', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const [total, completed, inProgress, overdue, byPriority] = await Promise.all([
      ActionItem.countDocuments({ assignedTo: userId }),
      ActionItem.countDocuments({ assignedTo: userId, status: 'completed' }),
      ActionItem.countDocuments({ assignedTo: userId, status: 'in-progress' }),
      ActionItem.countDocuments({
        assignedTo: userId,
        status: { $nin: ['completed', 'cancelled'] },
        dueDate: { $lt: new Date() }
      }),
      ActionItem.aggregate([
        { $match: { assignedTo: userId } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ])
    ]);
    
    res.json({
      success: true,
      data: {
        total,
        completed,
        inProgress,
        overdue,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        byPriority: byPriority.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Get action items stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
});

module.exports = router;
